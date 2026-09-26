import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  DELIVERY_CONTRACT,
  DELIVERY_LIMITS,
  DELIVERY_SPEC_REF,
  DEALER_CENTER_SLOT_META,
  DEALER_CENTER_SPEC_REF,
  HANDCARD_SECTION_META,
  HOST_CENTER_SLOT_META,
  HOST_CENTER_SPEC_REF
} from "@ldj/schemas";
import {
  SIX_STAR_PEACOCK_FIXTURE,
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

/**
 * Phase 15（规格 §31 一级导航 / §32 产品详情 Tabs / §51 主播中心 / §52 经销商中心 /
 * §53 / §57 / §60 导出 / §62-14 / §62-15）。
 *
 * 本文件锁定六件事：
 * - **交付层是派生视图**：两个中心与导出都只读某一版成稿，不新增表、不改写正文（§62-15）；
 * - **发布闸门只有一条口径**：主播中心 / 经销商中心 / 跨产品列表 / 导出四条链路读同一个 `ready`；
 * - **闸门未通过时一格正文都不给**：页面只留「要什么 + 去哪里解决」，导出一律 409（§53 / §57）；
 * - **假绿灯防线**：上一版审批通过、当前版刚生成还没审 → 仍然不可交付（§53 / §62-14）；
 * - **RED 阻断句原样回给运营**：409 的 `details.blocking_sentences` 让运营直接看到是哪几句；
 * - **权限与边界**：读需登录、导出与角色无关（闸门说了算），strict 校验不给后门。
 */

interface SlotView {
  key: string;
  label: string;
  requirement: string;
  source: string;
  spec_ref: string;
  tone: string;
  text: string | null;
  lines: string[];
  items: { index: number; label: string | null; text: string; detail: string | null }[];
  chars: number;
  present: boolean;
}

interface GateView {
  product_id: string;
  product_name: string | null;
  copy_record_id: string | null;
  copy_version: number | null;
  review_version: number | null;
  approval_status: "PENDING" | "APPROVED" | "REJECTED";
  approved: boolean;
  publishable: boolean;
  ready: boolean;
  red_count: number;
  blocking_sentences: string[];
  reason: string | null;
  next_action: string | null;
  spec_ref: string;
}

interface CenterView {
  product_id: string;
  product_name: string;
  copy_record_id: string | null;
  copy_version: number | null;
  copy_created_at: string | null;
  intensity: number | null;
  impact_score: number | null;
  impact_band: string | null;
  impact_band_label: string | null;
  level5_passed: boolean;
  compliance_risk: string | null;
  gate: GateView;
  ready: boolean;
  slots: SlotView[];
  spec_ref: string;
}

interface ExportView {
  product_id: string;
  product_name: string;
  format: "MARKDOWN" | "TEXT" | "HANDCARD";
  scope: "HOST" | "DEALER" | "ALL";
  filename: string;
  content_type: string;
  content: string;
  chars: number;
  copy_record_id: string | null;
  copy_version: number | null;
  review_version: number | null;
  gate: GateView;
  generated_at: string;
  spec_ref: string;
}

interface HostCenterList {
  items: {
    product_id: string;
    product_name: string;
    copy_version: number | null;
    one_liner: string | null;
    review_version: number | null;
    approval_status: string;
    red_count: number;
    ready: boolean;
    gate_reason: string | null;
  }[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

/** 经销商中心与主播中心形状相同，只有十项的 key 与 spec_ref 不同。 */
interface DealerCenterView extends CenterView {}

type ErrorEnvelope = ErrorBody["error"];

let context: TestContext;
let admin: BootstrapResult;

beforeAll(async () => {
  context = await createTestContext();
});

beforeEach(async () => {
  await context.reset();
  admin = await bootstrapAdmin(context.app, {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  });
});

afterAll(async () => {
  await context.close();
});

/** 事实齐备的产品：多数句子能逐字回查到出处，用来验证正常交付链路。 */
async function createFullProduct(name = "龙德记六星孔雀"): Promise<string> {
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: {
      ...SIX_STAR_PEACOCK_FIXTURE,
      product_name: name,
      tree_type: "大树",
      grade: "特级",
      kill_green_method: "铁锅杀青",
      rolling_method: "手工揉捻",
      drying_method: "日光晒干",
      hot_cup_aroma: "蜜香",
      thickness: "厚",
      middle_stage: "中段稳定",
      late_stage: "尾水甜",
      endurance: "12 泡以上",
      brand_id: null
    }
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { id: string }).id;
}

/** 几乎没有事实的产品：用来验证「缺出处写缺口，不写弱化版故事」。 */
async function createThinProduct(name = "龙德记试样茶"): Promise<string> {
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: {
      product_name: name,
      year: 2026,
      tea_type: "普洱生茶",
      weight_g: 357,
      benchmark_mode_preference: "AUTO",
      copy_intensity_default: 4,
      brand_id: null
    }
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { id: string }).id;
}

/** 生成一版强成交话术：事实审核与交付层的唯一入口都是一版已落库的成稿（§53）。 */
async function generateCopy(productId: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/copy/generate`,
    headers: authHeader(admin.accessToken),
    payload: body
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string; version: number }).id;
}

async function runReview(productId: string): Promise<{ version: number; publishable: boolean; red: number }> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/fact-review/generate`,
    headers: authHeader(admin.accessToken),
    payload: {}
  });
  expect(response.statusCode).toBe(201);
  const body = response.json() as {
    review: { version: number; publishable: boolean; summary: { red: number } };
  };
  return { version: body.review.version, publishable: body.review.publishable, red: body.review.summary.red };
}

async function decide(
  action: "approve" | "reject",
  productId: string,
  payload: Record<string, unknown> = {}
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/fact-review/${action}`,
    headers: authHeader(admin.accessToken),
    payload
  });
  return { statusCode: response.statusCode, body: response.json() as Record<string, unknown> };
}

async function createUserToken(role: "VIEWER" | "RESEARCHER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: `${role.toLowerCase()}-phase15@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

interface CopyRecordShape {
  headline: { opening_hook: string };
  [key: string]: unknown;
}

/**
 * 直接把一句红线写进**已落库的成稿**。
 *
 * 真实产品不会写出「全国第一」，但审核器必须在有人写出来时抓住它，并让它一路阻断到交付层（§49 / §53）。
 */
async function injectRedSentence(recordId: string, sentence: string): Promise<void> {
  const rows = await context.dbHandle.db.execute(
    sql`select record from copy_outputs where id = ${recordId}`
  );
  const items = (rows as unknown as { rows: { record: CopyRecordShape }[] }).rows;
  const record = items[0]?.record;
  if (!record) {
    throw new Error("成稿不存在，无法注入红线句");
  }
  record.headline.opening_hook = `${record.headline.opening_hook}${sentence}`;
  await context.dbHandle.db.execute(
    sql`update copy_outputs set record = ${JSON.stringify(record)}::jsonb where id = ${recordId}`
  );
}

/** 走到「审核通过 + 人工审批通过」：交付层唯一可交付的起点。 */
async function approvedProduct(name?: string): Promise<string> {
  const productId = await createFullProduct(name);
  await generateCopy(productId);
  const review = await runReview(productId);
  expect(review.publishable).toBe(true);
  const approved = await decide("approve", productId, { note: "逐句核对完成" });
  expect(approved.statusCode).toBe(200);
  return productId;
}

/**
 * 读一次交付视图。200 时 `body` 是视图，409 时 `error` 是 `{ code, message, details }`——
 * 两条链路共用同一个助手，是因为「闸门未通过」必须同时验证状态码与 `details` 里的口径。
 */
async function readCenter(
  path: string
): Promise<{ statusCode: number; body: CenterView; error: ErrorEnvelope | null }> {
  const response = await context.app.inject({
    method: "GET",
    url: path,
    headers: authHeader(admin.accessToken)
  });
  const body = response.json() as CenterView & Partial<{ error: ErrorEnvelope }>;
  return { statusCode: response.statusCode, body, error: body.error ?? null };
}

async function readExport(
  productId: string,
  query = ""
): Promise<{ statusCode: number; body: ExportView; error: ErrorEnvelope | null }> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/delivery/export${query}`,
    headers: authHeader(admin.accessToken)
  });
  const body = response.json() as ExportView & Partial<{ error: ErrorEnvelope }>;
  return { statusCode: response.statusCode, body, error: body.error ?? null };
}

async function readList(
  query = "",
  token?: string
): Promise<{ statusCode: number; body: HostCenterList; error: ErrorEnvelope | null }> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/host-center${query}`,
    headers: authHeader(token ?? admin.accessToken)
  });
  const body = response.json() as HostCenterList & Partial<{ error: ErrorEnvelope }>;
  return { statusCode: response.statusCode, body, error: body.error ?? null };
}

async function readDealerCenter(
  productId: string
): Promise<{ statusCode: number; body: DealerCenterView; error: ErrorEnvelope | null }> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/dealer-center`,
    headers: authHeader(admin.accessToken)
  });
  const body = response.json() as DealerCenterView & Partial<{ error: ErrorEnvelope }>;
  return { statusCode: response.statusCode, body, error: body.error ?? null };
}

/**
 * 导出被闸门拒绝时的 `details`。
 *
 * 导出是**唯一**会 409 的交付接口：两个中心返回 200 + `ready=false` + 十格全空，
 * 好让页面渲染「卡在哪一步 + 去哪里解决」；导出必须产出文件，所以只能硬拒绝（§53 / §57）。
 */
async function blockedExport(productId: string, query = ""): Promise<Record<string, unknown>> {
  const response = await readExport(productId, query);
  expect(response.statusCode).toBe(409);
  if (!response.error) {
    throw new Error("导出本该被发布闸门拒绝，却返回了文件");
  }
  return response.error.details;
}

describe("Phase 15 交付层：合同与标签（§51 / §52 / §53 / §57 / §60 / §62-14）", () => {
  it("六条交付接口未登录一律 401（交付层只读，但仍然要登录）", async () => {
    const targets = [
      "/api/delivery/contract",
      "/api/delivery/labels",
      "/api/host-center",
      "/api/products/00000000-0000-0000-0000-000000000000/host-center",
      "/api/products/00000000-0000-0000-0000-000000000000/dealer-center",
      "/api/products/00000000-0000-0000-0000-000000000000/delivery/export"
    ];
    const codes: number[] = [];
    for (const url of targets) {
      const response = await context.app.inject({ method: "GET", url });
      codes.push(response.statusCode);
    }
    expect(codes).toEqual(targets.map(() => 401));
  });

  it("合同自检：十项 × 2 / 导出 / 发布闸门四 flag / 五条阻断态 / 七条铁律", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/delivery/contract",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      contract: typeof DELIVERY_CONTRACT;
      downstream: readonly unknown[];
      limits: typeof DELIVERY_LIMITS;
    };

    // §51 / §52 十项：顺序即页面顺序与导出顺序，少一项就说明交付物不完整
    expect(body.contract.spec_ref).toBe(DELIVERY_SPEC_REF);
    expect(body.contract.host_center.slot_count).toBe(10);
    expect(body.contract.host_center.slots.map((slot) => slot.key)).toEqual([
      "product_identity",
      "one_liner",
      "must_say_three",
      "value_track",
      "product_structure",
      "formula_philosophy",
      "core_quotes",
      "sec60",
      "min3",
      "objections"
    ]);
    expect(body.contract.dealer_center.slot_count).toBe(10);
    expect(body.contract.dealer_center.slots.map((slot) => slot.key)).toEqual([
      "positioning",
      "selling_points",
      "why_this_price",
      "market_cognition",
      "primary_anchor",
      "product_structure",
      "formula_philosophy",
      "consumer",
      "how_to_introduce",
      "faq"
    ]);
    expect(body.contract.host_center.spec_ref).toBe(HOST_CENTER_SPEC_REF);
    expect(body.contract.dealer_center.spec_ref).toBe(DEALER_CENTER_SPEC_REF);

    // §60 导出：两种可编辑产物 + 一种只读卖点一页纸（一页纸只是重排，不产生第二事实源）
    expect(body.contract.export.formats.map((item) => item.key)).toEqual(["MARKDOWN", "TEXT", "HANDCARD"]);
    expect(body.contract.export.scopes.map((item) => item.key)).toEqual(["HOST", "DEALER", "ALL"]);
    expect(body.contract.export.spec_ref).toBe("§60");

    // §53 / §57 发布闸门：四个 flag 一个都不能少
    expect(body.contract.publish_gate.requires_approved).toBe(true);
    expect(body.contract.publish_gate.requires_latest_copy).toBe(true);
    expect(body.contract.publish_gate.red_blocks_publish).toBe(true);
    expect(body.contract.publish_gate.no_copy_no_material).toBe(true);
    expect(body.contract.publish_gate.blocking_states).toHaveLength(5);

    // §62-15 派生视图：两个中心与导出都不落库、不改正文，所有版本都要保留
    expect(body.contract.derived_view).toBe(true);
    expect(body.contract.keep_all_versions).toBe(true);
    expect(body.contract.limits).toEqual(DELIVERY_LIMITS);
    expect(body.contract.rules).toHaveLength(8);
    // Phase 15 是最后一个阶段：下游交接清单必须显式为「空」，不能留 PENDING 占位
    expect(body.downstream).toHaveLength(0);
    expect(body.limits).toEqual(DELIVERY_LIMITS);
  });

  it("标签：十项 × 2 / 导出格式与范围 / 六种闸门状态只有「可交付」是 ready", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/delivery/labels",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      host_center_slots: { key: string; label: string; requirement: string }[];
      dealer_center_slots: { key: string; label: string; requirement: string }[];
      export_formats: { key: string; extension: string; content_type: string }[];
      export_scopes: { key: string; label: string }[];
      gate_states: {
        label: string;
        tone: string;
        ready: boolean;
        reason: string | null;
        next_action: string | null;
      }[];
      limits: Record<string, number>;
      rules: string[];
    };

    expect(body.host_center_slots.map((slot) => slot.label)).toEqual([
      "产品身份",
      "一句话定位",
      "今天必讲 3 点",
      "价值赛道 / 产品标准",
      "产品结构",
      "配方哲学",
      "5 句金句",
      "60 秒稿",
      "3 分钟稿",
      "异议回答"
    ]);
    expect(body.dealer_center_slots.map((slot) => slot.label)).toEqual([
      "产品定位",
      "核心卖点",
      "为什么值这个价",
      "同赛道市场认知",
      "主要锚点",
      "产品结构",
      "配方哲学",
      "消费人群",
      "如何介绍",
      "常见问题"
    ]);
    expect(body.host_center_slots.every((slot) => slot.requirement.length > 0)).toBe(true);
    expect(body.dealer_center_slots.every((slot) => slot.requirement.length > 0)).toBe(true);

    expect(body.export_formats.map((item) => item.key)).toEqual(["MARKDOWN", "TEXT", "HANDCARD"]);
    expect(body.export_formats.map((item) => item.extension)).toEqual([".md", ".txt", ".html"]);
    expect(body.export_scopes.map((item) => item.key)).toEqual(["HOST", "DEALER", "ALL"]);

    // 六种闸门状态：前五种一律不可交付且必须带下一步，只有「可交付」不带原因
    expect(body.gate_states.map((state) => state.label)).toEqual([
      "还没有成稿",
      "待事实审核",
      "被 RED 阻断",
      "已被否决",
      "待人工审批",
      "可交付"
    ]);
    expect(body.gate_states.map((state) => state.tone)).toEqual([
      "outline",
      "info",
      "danger",
      "danger",
      "warn",
      "ok"
    ]);
    expect(body.gate_states.map((state) => state.ready)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true
    ]);
    expect(body.gate_states.every((state) => (state.ready ? state.next_action === null : state.next_action !== null))).toBe(
      true
    );
    expect(body.gate_states[5]?.reason ?? null).toBeNull();
    expect(body.gate_states[0]?.next_action).toBe("去生成强成交话术");
    expect(body.gate_states[1]?.next_action).toBe("去事实审核");
    expect(body.gate_states[2]?.next_action).toBe("去事实审核改稿");
    expect(body.rules).toHaveLength(8);
    expect(body.limits).toEqual(DELIVERY_LIMITS);
  });
});

describe("Phase 15 发布闸门：一条口径贯通两个中心 / 列表 / 导出（§53 / §57 / §62-14）", () => {
  it("还没有成稿：两个中心 200 但十格全空，导出 409 并指路「去生成强成交话术」", async () => {
    const productId = await createFullProduct();

    for (const path of [`/api/products/${productId}/host-center`, `/api/products/${productId}/dealer-center`]) {
      const center = await readCenter(path);
      expect(center.statusCode).toBe(200);
      expect(center.error).toBeNull();
      expect(center.body.ready).toBe(false);
      expect(center.body.gate.next_action).toBe("去生成强成交话术");
      expect(center.body.gate.copy_record_id).toBeNull();
      expect(center.body.gate.copy_version).toBeNull();
      expect(center.body.gate.review_version).toBeNull();
      expect(center.body.copy_version).toBeNull();
      expect(center.body.slots).toHaveLength(10);
      expect(
        center.body.slots.every(
          (slot) => slot.present === false && slot.text === null && slot.items.length === 0 && slot.chars === 0
        )
      ).toBe(true);
      expect(center.body.slots.every((slot) => slot.tone === "outline")).toBe(true);
      // 还没成稿时连「这一格要什么」都要给到，页面才能引导运营去上游（§64）
      expect(center.body.slots.every((slot) => slot.label.length > 0 && slot.requirement.length > 0)).toBe(true);
    }

    const details = await blockedExport(productId);
    expect(details.gate_label).toBe("还没有成稿");
    expect(details.next_action).toBe("去生成强成交话术");
    expect(details.blocking_sentences).toEqual([]);
    expect((details.gate as GateView).ready).toBe(false);
  });

  it("有成稿还没审：中心仍不展示正文，导出 409 并指路「去事实审核」", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);

    const host = await readCenter(`/api/products/${productId}/host-center`);
    expect(host.statusCode).toBe(200);
    expect(host.body.ready).toBe(false);
    expect(host.body.copy_version).toBe(1);
    expect(host.body.gate.review_version).toBeNull();
    expect(host.body.gate.next_action).toBe("去事实审核");
    expect(host.body.slots.every((slot) => !slot.present)).toBe(true);

    const dealer = await readDealerCenter(productId);
    expect(dealer.statusCode).toBe(200);
    expect(dealer.body.ready).toBe(false);
    expect(dealer.body.slots.every((slot) => !slot.present)).toBe(true);

    const details = await blockedExport(productId);
    expect(details.gate_label).toBe("待事实审核");
    expect(details.next_action).toBe("去事实审核");
    expect((details.gate as GateView).copy_version).toBe(1);
  });

  it("审核出现 RED：导出 409 并把阻断句原样摆给运营（§49 / §53）", async () => {
    const productId = await createFullProduct();
    const recordId = await generateCopy(productId);
    await injectRedSentence(recordId, "\n这款茶是全国第一。");

    const review = await runReview(productId);
    expect(review.publishable).toBe(false);
    expect(review.red).toBeGreaterThanOrEqual(1);

    const details = await blockedExport(productId);
    expect(details.gate_label).toBe("被 RED 阻断");
    expect(details.next_action).toBe("去事实审核改稿");
    const blockers = details.blocking_sentences as string[];
    expect(blockers.join("|")).toContain("全国第一");
    expect(blockers).toHaveLength((details.gate as GateView).red_count);

    const host = await readCenter(`/api/products/${productId}/host-center`);
    expect(host.statusCode).toBe(200);
    expect(host.body.ready).toBe(false);
    expect(host.body.slots.every((slot) => !slot.present)).toBe(true);
    expect(host.body.gate.blocking_sentences.join("|")).toContain("全国第一");
  });

  it("一条审核里有两条 RED 时，阻断句清单与 RED 计数一一对应（§53）", async () => {
    const productId = await createFullProduct();
    const recordId = await generateCopy(productId);
    await injectRedSentence(recordId, "\n这款茶是全国第一。");
    await injectRedSentence(recordId, "\n它在同价位绝无仅有。");

    const review = await runReview(productId);
    expect(review.publishable).toBe(false);
    expect(review.red).toBeGreaterThanOrEqual(2);

    const details = await blockedExport(productId);
    const gate = details.gate as GateView;
    const blockers = details.blocking_sentences as string[];
    expect(gate.red_count).toBeGreaterThanOrEqual(2);
    expect(blockers).toHaveLength(gate.red_count);
    expect(blockers.join("|")).toContain("全国第一");
    expect(blockers.join("|")).toContain("绝无仅有");
  });

  it("审核通过但没有人工审批：导出 409「待人工审批」（§53 / §57）", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const review = await runReview(productId);
    expect(review.publishable).toBe(true);

    const details = await blockedExport(productId);
    expect(details.gate_label).toBe("待人工审批");
    expect(details.next_action).toBe("去事实审核");
    const gate = details.gate as GateView;
    expect(gate.publishable).toBe(true);
    expect(gate.approved).toBe(false);
    expect(gate.review_version).toBe(1);
  });

  it("人工否决：导出 409「已被否决」，且不改任何逐句判定（§53 / §62-15）", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    await runReview(productId);
    const rejected = await decide("reject", productId, { note: "证据不足，先别对外讲" });
    expect(rejected.statusCode).toBe(200);

    const details = await blockedExport(productId);
    expect(details.gate_label).toBe("已被否决");
    expect((details.gate as GateView).approval_status).toBe("REJECTED");
    expect((details.gate as GateView).publishable).toBe(true);
  });

  it("审核通过 + 人工审批通过：两个中心十格全部有正文，导出放行（§51 / §52 / §57）", async () => {
    const productId = await approvedProduct();

    const host = await readCenter(`/api/products/${productId}/host-center`);
    expect(host.statusCode).toBe(200);
    expect(host.error).toBeNull();
    expect(host.body.ready).toBe(true);
    expect(host.body.gate.ready).toBe(true);
    expect(host.body.gate.reason).toBeNull();
    expect(host.body.gate.next_action).toBeNull();
    expect(host.body.gate.approval_status).toBe("APPROVED");
    expect(host.body.gate.blocking_sentences).toEqual([]);
    expect(host.body.slots).toHaveLength(10);
    expect(host.body.slots.every((slot) => slot.present && slot.tone === "ok")).toBe(true);
    expect(host.body.slots.map((slot) => slot.key)).toEqual([
      "product_identity",
      "one_liner",
      "must_say_three",
      "value_track",
      "product_structure",
      "formula_philosophy",
      "core_quotes",
      "sec60",
      "min3",
      "objections"
    ]);
    // 「今天必讲 3 点」逐字取成稿前三条卖点；「5 句金句」逐字是五条
    expect(host.body.slots[2]?.items).toHaveLength(3);
    expect(host.body.slots[6]?.items).toHaveLength(5);
    // §27 三分钟稿按八段时序展开
    expect(host.body.slots[8]?.items).toHaveLength(8);
    expect(host.body.copy_record_id).toBe(host.body.gate.copy_record_id);

    const dealer = await readDealerCenter(productId);
    expect(dealer.statusCode).toBe(200);
    expect(dealer.body.ready).toBe(true);
    expect(dealer.body.slots).toHaveLength(10);
    expect(dealer.body.slots.every((slot) => slot.present && slot.tone === "ok")).toBe(true);
    expect(dealer.body.slots.map((slot) => slot.key)).toEqual([
      "positioning",
      "selling_points",
      "why_this_price",
      "market_cognition",
      "primary_anchor",
      "product_structure",
      "formula_philosophy",
      "consumer",
      "how_to_introduce",
      "faq"
    ]);
    // §52 核心卖点讲全七条；常见问题逐条对应成稿的异议回答
    expect(dealer.body.slots[1]?.items).toHaveLength(7);
    expect(dealer.body.slots[9]?.items.length).toBeGreaterThan(0);
    // §62-5 市场认知只讲价格高度标准，不搬运竞品事实
    expect(dealer.body.slots[3]?.lines.join("|") ?? "").toContain("不搬运对标产品");
    expect(dealer.body.slots[4]?.text ?? "").toContain("主要价格高度参照");

    const exported = await readExport(productId);
    expect(exported.statusCode).toBe(200);
    expect(exported.body.gate.ready).toBe(true);
    expect(exported.body.chars).toBe(exported.body.content.length);
  });

  it("假绿灯防线：上一版审批通过后新生成一版，两个中心与导出立刻回到「待事实审核」", async () => {
    const productId = await approvedProduct();
    expect((await readExport(productId)).statusCode).toBe(200);

    // 新生成一版成稿：这一版还没有任何事实审核，历史审批不得给它当绿灯（§53 / §62-14）
    // 单产品 20 版上限内的第二次生成 → v2
    await generateCopy(productId);

    const host = await readCenter(`/api/products/${productId}/host-center`);
    expect(host.statusCode).toBe(200);
    expect(host.body.ready).toBe(false);
    expect(host.body.copy_version).toBe(2);
    expect(host.body.gate.copy_version).toBe(2);
    expect(host.body.gate.review_version).toBeNull();
    expect(host.body.gate.next_action).toBe("去事实审核");
    expect(host.body.slots.every((slot) => !slot.present)).toBe(true);

    const dealer = await readDealerCenter(productId);
    expect(dealer.statusCode).toBe(200);
    expect(dealer.body.ready).toBe(false);
    expect(dealer.body.copy_version).toBe(2);
    expect(dealer.body.slots.every((slot) => !slot.present)).toBe(true);

    const details = await blockedExport(productId);
    expect(details.gate_label).toBe("待事实审核");

    const list = await readList(`?q=${encodeURIComponent("六星孔雀")}`);
    expect(list.statusCode).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]?.ready).toBe(false);
    expect(list.body.items[0]?.copy_version).toBe(2);
    expect(list.body.items[0]?.gate_reason ?? "").toContain("事实审核");
  });
});

describe("Phase 15 导出：Markdown / 纯文本 × 主播 / 经销商 / 完整（§60 / §62-15）", () => {
  it("markdown + all：两个分区都在这份文件里，文件名带成稿版本", async () => {
    const productId = await approvedProduct();
    const exported = await readExport(productId, "?format=markdown&scope=all");
    expect(exported.statusCode).toBe(200);
    expect(exported.error).toBeNull();
    const view = exported.body;

    expect(view.format).toBe("MARKDOWN");
    expect(view.scope).toBe("ALL");
    expect(view.content_type).toBe("text/markdown; charset=utf-8");
    expect(view.filename).toBe("龙德记六星孔雀_最终资料包_v1.md");
    expect(view.spec_ref).toBe(DELIVERY_SPEC_REF);

    expect(view.content.startsWith("# 龙德记六星孔雀 · 最终资料包")).toBe(true);
    expect(view.content).toContain("成稿版本：v1");
    expect(view.content).toContain("## 主播中心（§51 十项）");
    expect(view.content).toContain("## 经销商中心（§52 十项）");
    expect(view.content).toContain("### 产品身份");
    expect(view.content).toContain("### 产品定位");
    expect(view.content).toContain("本文件由系统按上述成稿重排生成");
    expect(view.chars).toBe(view.content.length);
    expect(view.chars).toBeGreaterThan(0);

    // 导出是派生视图：它必须指向与页面完全相同的那一版成稿与那一次审核（§57 / §62-15）
    const host = await readCenter(`/api/products/${productId}/host-center`);
    expect(view.copy_record_id).toBe(host.body.copy_record_id);
    expect(view.copy_version).toBe(host.body.copy_version);
    expect(view.review_version).toBe(host.body.gate.review_version);
    expect(view.gate.ready).toBe(true);
  });

  it("text + host：去掉全部符号，只剩主播那一份，直接进提词器", async () => {
    const productId = await approvedProduct();
    const exported = await readExport(productId, "?format=text&scope=host");
    expect(exported.statusCode).toBe(200);
    const view = exported.body;

    expect(view.format).toBe("TEXT");
    expect(view.scope).toBe("HOST");
    expect(view.content_type).toBe("text/plain; charset=utf-8");
    expect(view.filename).toBe("龙德记六星孔雀_主播中心_v1.txt");
    expect(view.content.startsWith("龙德记六星孔雀 · 主播中心")).toBe(true);
    expect(view.content).toContain("【主播中心（§51 十项）】");
    expect(view.content).not.toContain("经销商中心（§52 十项）");
    expect(view.content.includes("#")).toBe(false);
    expect(view.content.includes("**")).toBe(false);
    expect(view.content.includes("###")).toBe(false);
    expect(view.chars).toBe(view.content.length);
  });

  it("scope=dealer 只出经销商中心那一份（两份文件不会互相串内容）", async () => {
    const productId = await approvedProduct();
    const exported = await readExport(productId, "?format=markdown&scope=dealer");
    expect(exported.statusCode).toBe(200);
    const view = exported.body;

    expect(view.scope).toBe("DEALER");
    expect(view.filename).toBe("龙德记六星孔雀_经销商中心_v1.md");
    expect(view.content).toContain("## 经销商中心（§52 十项）");
    expect(view.content).not.toContain("主播中心（§51 十项）");
    expect(view.content).toContain("### 同赛道市场认知");
    expect(view.chars).toBe(view.content.length);
  });

  it("format=handcard 出「卖点一页纸」：单文件 HTML，四段齐全、只读重排、无外链", async () => {
    const productId = await approvedProduct();
    const exported = await readExport(productId, "?format=handcard");
    expect(exported.statusCode).toBe(200);
    const view = exported.body;

    expect(view.format).toBe("HANDCARD");
    expect(view.scope).toBe("ALL");
    expect(view.content_type).toBe("text/html; charset=utf-8");
    expect(view.filename).toBe("龙德记六星孔雀_卖点一页纸_v1.html");
    expect(view.content.startsWith("<!DOCTYPE html>")).toBe(true);
    for (const section of HANDCARD_SECTION_META) {
      expect(view.content).toContain(section.label);
    }
    // 一页纸只是把同一版成稿重排：不带脚本、不引外部资源，打印即用。
    expect(view.content).not.toContain("<script");
    expect(view.content).not.toContain("http://");
    expect(view.content).not.toContain("https://");
    expect(view.chars).toBe(view.content.length);
  });

  it("非法的 format / scope / 多余字段一律 400（strict 不给后门）", async () => {
    const productId = await approvedProduct();
    for (const query of [
      "?format=pdf",
      "?format=Markdown",
      "?scope=team",
      "?scope=HOST",
      "?format=markdown&scope=all&force=true"
    ]) {
      const response = await readExport(productId, query);
      expect(response.statusCode).toBe(400);
    }
  });

  it("没有成稿的产品也 404 得清清楚楚，导出不猜产品", async () => {
    const missing = await readExport("00000000-0000-0000-0000-000000000000");
    expect(missing.statusCode).toBe(404);
    expect(missing.error?.message).toContain("产品不存在");

    const malformed = await readExport("not-a-uuid");
    expect(malformed.statusCode).toBe(404);
  });
});

describe("Phase 15 跨产品列表：主播每天要问的「今天哪几款能上播」（§31）", () => {
  it("分页 / 总数 / 可交付优先 / 一行即一版成稿", async () => {
    await approvedProduct("龙德记六星孔雀");
    const pendingId = await createThinProduct("龙德记试样茶");
    await generateCopy(pendingId);

    const list = await readList();
    expect(list.statusCode).toBe(200);
    expect(list.error).toBeNull();
    expect(list.body.total).toBe(2);
    expect(list.body.page).toBe(1);
    expect(list.body.pageSize).toBe(DELIVERY_LIMITS.defaultPageSize);
    expect(list.body.totalPages).toBe(1);
    expect(list.body.items).toHaveLength(2);
    // 可交付的排在前：主播先看到能上播的
    expect(list.body.items[0]?.ready).toBe(true);
    expect(list.body.items[0]?.product_name).toBe("龙德记六星孔雀");
    expect(list.body.items[0]?.one_liner ?? "").not.toHaveLength(0);
    expect(list.body.items[0]?.approval_status).toBe("APPROVED");
    expect(list.body.items[1]?.ready).toBe(false);
    expect(list.body.items[1]?.gate_reason ?? "").not.toHaveLength(0);

    const paged = await readList("?page=2&pageSize=1");
    expect(paged.statusCode).toBe(200);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.totalPages).toBe(2);
    expect(paged.body.items[0]?.ready).toBe(false);
  });

  it("ready 三态筛选：不传 = 全部，true = 只看能上播，false = 只看还不能上播", async () => {
    await approvedProduct("龙德记六星孔雀");
    const pendingId = await createThinProduct("龙德记试样茶");
    await generateCopy(pendingId);

    const all = await readList();
    expect(all.body.total).toBe(2);

    const ready = await readList("?ready=true");
    expect(ready.statusCode).toBe(200);
    expect(ready.body.total).toBe(1);
    expect(ready.body.items.every((item) => item.ready)).toBe(true);
    expect(ready.body.items[0]?.product_name).toBe("龙德记六星孔雀");

    // `false` 必须真的反过来筛（`z.coerce.boolean()` 会把它当 true，见 agent_memory/bugs.md）
    const blocked = await readList("?ready=false");
    expect(blocked.statusCode).toBe(200);
    expect(blocked.body.total).toBe(1);
    expect(blocked.body.items.every((item) => !item.ready)).toBe(true);
    expect(blocked.body.items[0]?.product_name).toBe("龙德记试样茶");
  });

  it("q 按产品名搜索；pageSize 超上限与 ready 非法值一律 400", async () => {
    await approvedProduct("龙德记六星孔雀");
    const pendingId = await createThinProduct("龙德记试样茶");
    await generateCopy(pendingId);

    const searched = await readList(`?q=${encodeURIComponent("孔雀")}`);
    expect(searched.statusCode).toBe(200);
    expect(searched.body.total).toBe(1);
    expect(searched.body.items.map((item) => item.product_name)).toEqual(["龙德记六星孔雀"]);

    const tooBig = await readList(`?pageSize=${DELIVERY_LIMITS.maxPageSize + 1}`);
    expect(tooBig.statusCode).toBe(400);

    const badReady = await readList("?ready=maybe");
    expect(badReady.statusCode).toBe(400);

    const extra = await readList("?ready=true&sort=price");
    expect(extra.statusCode).toBe(400);
  });
});

describe("Phase 15 边界与权限：交付层只读、与角色无关（§53）", () => {
  it("VIEWER 也能读两个中心、列表与导出——能不能交付由闸门说了算，不由角色说了算", async () => {
    const productId = await approvedProduct();
    const viewerToken = await createUserToken("VIEWER");
    const researcherToken = await createUserToken("RESEARCHER");

    for (const token of [viewerToken, researcherToken]) {
      const host = await context.app.inject({
        method: "GET",
        url: `/api/products/${productId}/host-center`,
        headers: authHeader(token)
      });
      expect(host.statusCode).toBe(200);
      expect((host.json() as CenterView).ready).toBe(true);

      const dealer = await context.app.inject({
        method: "GET",
        url: `/api/products/${productId}/dealer-center`,
        headers: authHeader(token)
      });
      expect(dealer.statusCode).toBe(200);

      const exported = await context.app.inject({
        method: "GET",
        url: `/api/products/${productId}/delivery/export?format=markdown&scope=all`,
        headers: authHeader(token)
      });
      expect(exported.statusCode).toBe(200);

      const list = await readList("", token);
      expect(list.statusCode).toBe(200);
      expect(list.body.total).toBeGreaterThanOrEqual(1);

      const contract = await context.app.inject({
        method: "GET",
        url: "/api/delivery/contract",
        headers: authHeader(token)
      });
      expect(contract.statusCode).toBe(200);
    }
  });

  it("路径参数不是 UUID / 产品不存在：一律 404，不返回半截资料", async () => {
    const productId = await approvedProduct();
    const cases = [
      "/api/products/not-a-uuid/host-center",
      "/api/products/not-a-uuid/dealer-center",
      "/api/products/not-a-uuid/delivery/export",
      "/api/products/00000000-0000-0000-0000-000000000000/host-center",
      "/api/products/00000000-0000-0000-0000-000000000000/dealer-center"
    ];
    const codes: number[] = [];
    for (const url of cases) {
      const response = await context.app.inject({
        method: "GET",
        url,
        headers: authHeader(admin.accessToken)
      });
      codes.push(response.statusCode);
    }
    expect(codes).toEqual(cases.map(() => 404));

    const missing = await context.app.inject({
      method: "GET",
      url: "/api/products/00000000-0000-0000-0000-000000000000/host-center",
      headers: authHeader(admin.accessToken)
    });
    expect((missing.json() as ErrorBody).error.message).toContain("产品不存在");

    // 顺带确认原有产品没有被打扰
    expect((await readCenter(`/api/products/${productId}/host-center`)).statusCode).toBe(200);
  });
});
