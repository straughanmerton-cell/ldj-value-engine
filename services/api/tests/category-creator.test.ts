import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SIX_STAR_PEACOCK_FIXTURE,
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

/**
 * Phase 8（规格 §4.2 自建高端标准模式 / §17 无锚点强制逻辑 / §29 成交表达口径 / §24 三层标记）。
 *
 * 本文件锁定四件事：
 * - **模式判定复用 Phase 7**：没有达标锚点 → `mode = CATEGORY_CREATOR` + `NO_RELIABLE_ANCHOR`；
 * - **没有对标不等于没有内容**（§4.2）：必须输出六轴标准、风格身份证与价值逻辑；
 * - **事实不够就写缺口**（§11 / §62-7）：UNKNOWN 轴不写文案，事实不足时不输出成交表达；
 * - **版本只增不删**（§62-15）：重新生成派生新版本，人工确认只改确认状态。
 */

interface StandardItem {
  axis: string;
  label: string;
  status: "SUPPORTED" | "PARTIAL" | "UNKNOWN";
  evidence_refs: string[];
  statement: string | null;
  gap: string | null;
  layer: string;
}

interface ProfileBody {
  id: string;
  product_id: string;
  version: number;
  trigger: string;
  mode_at_generation: string;
  readiness: "READY" | "PARTIAL" | "INSUFFICIENT";
  supported_axes: number;
  total_axes: number;
  standard: { items: StandardItem[]; supported_count: number; unknown_count: number; summary: string };
  style_identity: { identity_name: string; not_claiming: string[]; time_story: string | null };
  value_logic: { items: { stage: string; layer: string; text: string }[]; sales_line_ready: boolean };
  evidence_gaps: string[];
  fact_refs: string[];
  downstream: { phase: number; status: string }[];
  is_confirmed: boolean;
  confirmed_at: string | null;
  spec_ref: string;
}

interface OverviewBody {
  product_id: string;
  preference: string;
  mode: string;
  resolved_by: string;
  mode_reason: string;
  can_generate: boolean;
  suggested_trigger: string;
  profile: ProfileBody | null;
  versions: { id: string; version: number; readiness: string; is_confirmed: boolean }[];
  spec_ref: string;
}

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

/** 事实齐备的产品：六轴全部有 ≥2 条事实支撑，自建标准可以成立。 */
async function createFullProduct(
  name = "龙德记六星孔雀",
  preference: "AUTO" | "BENCHMARK" | "CATEGORY_CREATOR" = "AUTO"
): Promise<string> {
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: {
      ...SIX_STAR_PEACOCK_FIXTURE,
      product_name: name,
      benchmark_mode_preference: preference,
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

/** 几乎没有事实的产品：六轴全部 UNKNOWN，用来验证「事实不足就写缺口」。 */
async function createThinProduct(name = "龙德记试样茶", preference: "AUTO" | "CATEGORY_CREATOR" = "AUTO"): Promise<string> {
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: {
      product_name: name,
      year: 2026,
      tea_type: "普洱生茶",
      weight_g: 357,
      benchmark_mode_preference: preference,
      copy_intensity_default: 4,
      brand_id: null
    }
  });
  expect(created.statusCode).toBe(201);
  return (created.json() as { id: string }).id;
}

async function readOverview(productId: string, token = admin.accessToken): Promise<OverviewBody> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/category-creator`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as OverviewBody;
}

async function generate(
  productId: string,
  payload: Record<string, unknown> = {},
  token = admin.accessToken
): Promise<ProfileBody> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/category-creator/generate`,
    headers: authHeader(token),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as ProfileBody;
}

async function createUserToken(role: "VIEWER" | "RESEARCHER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: `${role.toLowerCase()}-phase8@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

describe("§4.2 合同自检：两触发条件 + 六标准轴 + 六条红线", () => {
  it("合同与文案标签可读，且未登录不可读", async () => {
    const unauthorized = await context.app.inject({ method: "GET", url: "/api/category-creator/contract" });
    expect(unauthorized.statusCode).toBe(401);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/category-creator/contract",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      contract: {
        spec_ref: string;
        triggers: { trigger: string; condition: string }[];
        axes: { axis: string }[];
        min_supported_axes: number;
        layers: string[];
        not_weak_copy: boolean;
        no_fake_benchmark: boolean;
        unknown_is_written_as_unknown: boolean;
        rules: string[];
      };
      engine: { mode: string; note: string };
      downstream: { phase: number; status: string }[];
    };

    expect(body.contract.spec_ref).toBe("§4.2 / §17 / §29");
    expect(body.contract.triggers.map((item) => item.trigger)).toEqual([
      "NO_RELIABLE_ANCHOR",
      "USER_OPT_OUT"
    ]);
    expect(body.contract.axes).toHaveLength(6);
    expect(body.contract.min_supported_axes).toBe(2);
    expect(body.contract.layers).toEqual(["FACT", "INTERPRETATION", "RHETORIC"]);
    expect(body.contract.not_weak_copy).toBe(true);
    expect(body.contract.no_fake_benchmark).toBe(true);
    expect(body.contract.unknown_is_written_as_unknown).toBe(true);
    expect(body.contract.rules).toHaveLength(6);
    expect(body.contract.rules.join("丨")).toContain("不得硬凑竞品");
    expect(body.engine.mode).toBe("CATEGORY_CREATOR");
    expect(body.downstream.map((item) => item.phase)).toEqual([]);
    expect(body.downstream.every((item) => item.status === "PENDING")).toBe(true);
  });

  it("前端文案标签（轴名 / 状态 / readiness / 规则）由后端统一提供", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/category-creator/labels",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      axis_labels: Record<string, string>;
      axis_status_labels: Record<string, string>;
      readiness_labels: Record<string, string>;
      rules: string[];
    };
    expect(Object.keys(body.axis_labels)).toHaveLength(6);
    expect(body.axis_labels.FRAME).toContain("骨架");
    expect(body.axis_status_labels.UNKNOWN).toContain("不得书写");
    expect(body.readiness_labels.INSUFFICIENT).toContain("不得输出成交表达");
    expect(body.rules).toHaveLength(6);
  });
});

describe("§17 无可靠锚点：总览直接落到 Category Creator Mode", () => {
  it("产品没有锚点时 mode = CATEGORY_CREATOR、触发条件为 NO_RELIABLE_ANCHOR、尚无版本", async () => {
    const productId = await createThinProduct();
    const overview = await readOverview(productId);

    expect(overview.mode).toBe("CATEGORY_CREATOR");
    expect(overview.resolved_by).toBe("NO_RELIABLE_ANCHOR");
    expect(overview.mode_reason).toContain("不得硬凑竞品或降低阈值");
    expect(overview.suggested_trigger).toBe("NO_RELIABLE_ANCHOR");
    expect(overview.can_generate).toBe(true);
    expect(overview.profile).toBeNull();
    expect(overview.versions).toEqual([]);
    expect(overview.spec_ref).toBe("§4.2 / §17 / §29");
  });

  it("读取其他不存在的产品返回 404", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/products/00000000-0000-4000-8000-000000000000/category-creator",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("§4.2 生成自建标准：六轴 + 风格身份证 + 价值逻辑", () => {
  it("事实齐备的产品可以生成 READY 版标准，六个轴都有事实与文案", async () => {
    const productId = await createFullProduct();
    const profile = await generate(productId);

    expect(profile.version).toBe(1);
    expect(profile.trigger).toBe("NO_RELIABLE_ANCHOR");
    expect(profile.mode_at_generation).toBe("CATEGORY_CREATOR");
    expect(profile.total_axes).toBe(6);
    expect(profile.supported_axes).toBeGreaterThanOrEqual(4);
    expect(profile.readiness).toBe("READY");
    expect(profile.standard.items.map((item) => item.axis)).toEqual([
      "FRAME",
      "DEPTH",
      "IDENTITY",
      "FIRST_IMPRESSION",
      "FINISH",
      "CRAFT"
    ]);
    expect(profile.standard.items.every((item) => item.status !== "UNKNOWN")).toBe(true);
    expect(profile.standard.items.every((item) => item.statement !== null)).toBe(true);
    expect(profile.standard.items.every((item) => item.layer === "INTERPRETATION")).toBe(true);
    expect(profile.standard.items.every((item) => item.evidence_refs.length > 0)).toBe(true);
    expect(profile.fact_refs).toContain("product.mountain");
    expect(profile.style_identity.identity_name).toContain("布朗山");
    expect(profile.style_identity.not_claiming).toHaveLength(3);
    // §19 TIME_DEPENDENT 属于 Phase 9 Value Codes，本阶段必须留空。
    expect(profile.style_identity.time_story).toBeNull();
    expect(profile.spec_ref).toBe("§4.2 / §17 / §29");
  });

  it("没有对标不等于文案变弱：价值逻辑四段齐全，成交表达直接说出「找不到完全一样的对标」", async () => {
    const productId = await createFullProduct();
    const profile = await generate(productId);

    expect(profile.value_logic.sales_line_ready).toBe(true);
    expect(profile.value_logic.items.map((item) => item.stage)).toEqual([
      "FACT",
      "INTERPRETATION",
      "VALUE",
      "SALES_LINE"
    ]);
    expect(profile.value_logic.items.map((item) => item.layer)).toEqual([
      "FACT",
      "INTERPRETATION",
      "INTERPRETATION",
      "RHETORIC"
    ]);
    const salesLine = profile.value_logic.items.find((item) => item.stage === "SALES_LINE");
    expect(salesLine?.text).toContain("市面上找不到完全一样的对标");
    expect(salesLine?.text).toContain("先定的是标准，不是故事");
    // 未录入的树龄不得出现在成交表达里（§62-7）。
    expect(salesLine?.text).not.toContain("树龄");
    // 六轴都有支撑、Value DNA 已生成，因此没有缺口。
    expect(profile.standard.unknown_count).toBe(0);
    expect(profile.evidence_gaps).toEqual([]);
  });

  it("事实不足时输出缺口清单而不是弱化文案：UNKNOWN 轴无文案、无成交段", async () => {
    const productId = await createThinProduct();
    const profile = await generate(productId);

    expect(profile.readiness).toBe("INSUFFICIENT");
    expect(profile.supported_axes).toBe(0);
    expect(profile.standard.unknown_count).toBeGreaterThanOrEqual(4);
    // 未录入的轴一律不写文案（宁可少讲，不得编）。
    const unknowns = profile.standard.items.filter((item) => item.status === "UNKNOWN");
    expect(unknowns.length).toBeGreaterThanOrEqual(4);
    expect(unknowns.every((item) => item.statement === null)).toBe(true);
    expect(unknowns.every((item) => item.gap !== null)).toBe(true);
    expect(profile.standard.summary).toContain("自建标准尚未成立");
    expect(profile.value_logic.sales_line_ready).toBe(false);
    expect(profile.value_logic.items.some((item) => item.stage === "SALES_LINE")).toBe(false);
    expect(profile.value_logic.items.some((item) => item.layer === "RHETORIC")).toBe(false);
    expect(profile.evidence_gaps.length).toBeGreaterThanOrEqual(6);
  });

  it("补事实后重新生成：版本号 +1、readiness 提升、旧版本仍可查（§62-15）", async () => {
    const productId = await createThinProduct();
    const first = await generate(productId);
    expect(first.version).toBe(1);
    expect(first.readiness).toBe("INSUFFICIENT");

    const patched = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}`,
      headers: authHeader(admin.accessToken),
      payload: {
        mountain: "布朗山",
        origin_region: "勐海",
        raw_material: "大树春茶",
        season: "春茶",
        dry_leaf_aroma: "烟香明显",
        hot_cup_aroma: "蜜香",
        entry_taste: "浓强",
        thickness: "厚",
        huigan: "快",
        salivation: "强",
        cha_qi: "明显",
        kill_green_method: "铁锅杀青",
        rolling_method: "手工揉捻"
      }
    });
    expect(patched.statusCode).toBe(200);

    const second = await generate(productId);
    expect(second.version).toBe(2);
    expect(["READY", "PARTIAL"]).toContain(second.readiness);
    expect(second.supported_axes).toBeGreaterThan(first.supported_axes);

    const versions = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/category-creator/versions`,
      headers: authHeader(admin.accessToken)
    });
    expect(versions.statusCode).toBe(200);
    const versionBody = versions.json() as { items: { id: string; version: number; readiness: string }[] };
    expect(versionBody.items.map((item) => item.version)).toEqual([2, 1]);
    expect(versionBody.items[1]?.readiness).toBe("INSUFFICIENT");

    const old = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/category-creator/${first.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(old.statusCode).toBe(200);
    expect((old.json() as ProfileBody).readiness).toBe("INSUFFICIENT");

    // 总览默认返回最新一版，且版本列表完整。
    const overview = await readOverview(productId);
    expect(overview.profile?.version).toBe(2);
    expect(overview.versions.map((item) => item.version)).toEqual([2, 1]);
  });

  it("产品负责人指定 CATEGORY_CREATOR：触发条件记为 USER_OPT_OUT，模式来源为人工偏好", async () => {
    const productId = await createFullProduct("龙德记六星孔雀（人工指定）", "CATEGORY_CREATOR");
    const overview = await readOverview(productId);

    expect(overview.preference).toBe("CATEGORY_CREATOR");
    expect(overview.mode).toBe("CATEGORY_CREATOR");
    expect(overview.resolved_by).toBe("MANUAL_PREFERENCE");
    expect(overview.suggested_trigger).toBe("USER_OPT_OUT");

    const profile = await generate(productId);
    expect(profile.trigger).toBe("USER_OPT_OUT");
    expect(profile.readiness).toBe("READY");
  });

  it("生成入参可以显式覆盖触发条件，非法触发条件被拒", async () => {
    const productId = await createFullProduct();
    const profile = await generate(productId, { trigger: "USER_OPT_OUT", notes: "人工选择不使用对标" });
    expect(profile.trigger).toBe("USER_OPT_OUT");
    expect((profile as unknown as { notes: string }).notes).toBe("人工选择不使用对标");

    const invalid = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/category-creator/generate`,
      headers: authHeader(admin.accessToken),
      payload: { trigger: "MAGIC" }
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("人工确认只改确认状态，不新增版本，也不会删掉历史版本", async () => {
    const productId = await createFullProduct();
    const first = await generate(productId);
    const second = await generate(productId, { notes: "第二轮" });
    expect(second.version).toBe(2);

    const confirmed = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/category-creator/${first.id}`,
      headers: authHeader(admin.accessToken),
      payload: { is_confirmed: true, notes: "研究员已确认六轴口径" }
    });
    expect(confirmed.statusCode).toBe(200);
    const body = confirmed.json() as ProfileBody;
    expect(body.is_confirmed).toBe(true);
    expect(body.confirmed_at).not.toBeNull();
    expect(body.version).toBe(1);

    const versions = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/category-creator/versions`,
      headers: authHeader(admin.accessToken)
    });
    const versionBody = versions.json() as { items: { version: number; is_confirmed: boolean }[] };
    expect(versionBody.items.map((item) => item.version)).toEqual([2, 1]);
    expect(versionBody.items[1]?.is_confirmed).toBe(true);

    const unconfirmed = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/category-creator/${first.id}`,
      headers: authHeader(admin.accessToken),
      payload: { is_confirmed: false }
    });
    const unconfirmedBody = unconfirmed.json() as ProfileBody;
    expect(unconfirmedBody.is_confirmed).toBe(false);
    expect(unconfirmedBody.confirmed_at).toBeNull();
  });

  it("跨产品的版本不会串号：另一个产品只有自己的版本", async () => {
    const productA = await createFullProduct("龙德记六星孔雀A");
    const productB = await createFullProduct("龙德记六星孔雀B");
    await generate(productA);
    await generate(productB);
    await generate(productB);

    const versionsA = await context.app.inject({
      method: "GET",
      url: `/api/products/${productA}/category-creator/versions`,
      headers: authHeader(admin.accessToken)
    });
    const versionsB = await context.app.inject({
      method: "GET",
      url: `/api/products/${productB}/category-creator/versions`,
      headers: authHeader(admin.accessToken)
    });
    expect((versionsA.json() as { items: unknown[] }).items).toHaveLength(1);
    expect((versionsB.json() as { items: unknown[] }).items).toHaveLength(2);
  });
});

describe("§4.2 权限边界：读需登录，写限 ADMIN / RESEARCHER", () => {
  it("未登录读不到总览与合同，VIEWER 不能生成或确认标准", async () => {
    const productId = await createFullProduct();

    const anonymous = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/category-creator`
    });
    expect(anonymous.statusCode).toBe(401);

    const viewerToken = await createUserToken("VIEWER");
    const viewerRead = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/category-creator`,
      headers: authHeader(viewerToken)
    });
    expect(viewerRead.statusCode).toBe(200);

    const viewerWrite = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/category-creator/generate`,
      headers: authHeader(viewerToken),
      payload: {}
    });
    expect(viewerWrite.statusCode).toBe(403);

    const researcherToken = await createUserToken("RESEARCHER");
    const profile = await generate(productId, {}, researcherToken);
    expect(profile.version).toBe(1);

    const viewerPatch = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/category-creator/${profile.id}`,
      headers: authHeader(viewerToken),
      payload: { is_confirmed: true }
    });
    expect(viewerPatch.statusCode).toBe(403);
  });

  it("写入不存在的产品返回 404，而不是凭空建版本", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: "/api/products/00000000-0000-4000-8000-000000000000/category-creator/generate",
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(response.statusCode).toBe(404);
  });
});
