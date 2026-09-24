import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CLAIM_TYPE_LABELS,
  FACT_EVIDENCE_KIND_LABELS,
  FACT_REVIEW_CONTRACT,
  FACT_REVIEW_DOWNSTREAM,
  FACT_REVIEW_FOCUS_LABELS,
  FACT_REVIEW_LIMITS,
  FACT_REVIEW_SENTENCE_COLUMNS,
  FACT_REVIEW_SPEC_REF,
  FACT_REVIEW_STATUS_LABELS,
  RISK_LEVEL_LABELS
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
 * Phase 14（规格 §24 三层标记 / §25 研发证据 / §36 工作台 / §49 十三项审核焦点 /
 * §53 逐句标注页 / §57 版本冻结 / §62-14 AI 只加严 / §62-15 版本只增不删）。
 *
 * 本文件锁定六件事：
 * - **三层标记不是三分类工单**：每句都必须给 Claim Type + Risk + Evidence + 修改建议，
 *   修辞按 RHETORIC / GREEN 处理，不能因为「不是字面事实」就判 RED（§24 / §57）；
 * - **红线只能由机械判定产生**：编配方 / 无据研发关系 / 必涨稳赚 / 绝对化断言 / 凭空价格 → RED（§25 / §49）；
 * - **RED 阻断审批**：存在阻断句时审批接口 400 并把阻断句回给前端（§53 / §57）；
 * - **落库即冻结**：回看一次审核只读落库行，今天补录事实也不会悄悄改写三个月前的结论（§57 / §62-15）；
 * - **AI 只能加严**：Mock / 失败时整份回落纯规则引擎，并留下可读的 warning（§62-14）；
 * - **权限与边界**：读需登录、写限 ADMIN / RESEARCHER，strict 校验不给后门。
 */

interface SentenceItem {
  index: number;
  text: string;
  claim_type: "FACT" | "INTERPRETATION" | "RHETORIC";
  risk: "GREEN" | "YELLOW" | "RED";
  evidence_refs: string[];
  issue: string | null;
  suggestion: string | null;
  is_blocking: boolean;
}

interface ReviewBody {
  id: string;
  product_id: string;
  product_name: string | null;
  copy_output_id: string;
  copy_version: number;
  version: number;
  engine: "RULE" | "RULE_AI";
  sentences: SentenceItem[];
  claim_counts: { FACT: number; INTERPRETATION: number; RHETORIC: number };
  summary: { green: number; yellow: number; red: number };
  overall_risk: "GREEN" | "YELLOW" | "RED";
  publishable: boolean;
  blocking_sentences: string[];
  evidence_gaps: string[];
  facts_used: number;
  compliance: { risk: string; note: string };
  warnings: string[];
  rnd_confirmed: boolean;
  has_reliable_price_anchor: boolean;
  price_high_story_ready: boolean;
  created_at: string;
  spec_ref: string;
}

interface EvidenceItem {
  id: string;
  claim_id: string;
  source_ref: string;
  source_id: string | null;
  excerpt: string;
  evidence_kind: "PRODUCT_FACT" | "VALUE_DNA" | "UPSTREAM_COPY" | "RND_REFERENCE";
  traceable: boolean;
  created_at: string;
}

interface ReviewView {
  review: ReviewBody;
  evidence: EvidenceItem[];
}

interface VersionSummary {
  id: string;
  version: number;
  copy_version: number;
  engine: string;
  overall_risk: string;
  publishable: boolean;
  green: number;
  yellow: number;
  red: number;
  facts_used: number;
  created_at: string;
}

interface ApprovalBody {
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewed_version: number | null;
  note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface OverviewBody {
  product_id: string;
  product_name: string | null;
  copy_record_id: string | null;
  copy_version: number | null;
  can_review: boolean;
  block_reason: string | null;
  review: ReviewBody | null;
  versions: VersionSummary[];
  approval: ApprovalBody;
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

/** 事实齐备的产品：多数句子能逐字回查到出处，用来验证正常链路。 */
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

/** 先生成一版强成交话术（事实审核的唯一入口是一版已落库的成稿，§53）。 */
async function generateCopy(productId: string, body: Record<string, unknown> = {}): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/copy/generate`,
    headers: authHeader(admin.accessToken),
    payload: body
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { id: string }).id;
}

async function readOverview(productId: string, token = admin.accessToken): Promise<OverviewBody> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/fact-review`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as OverviewBody;
}

async function runReview(
  productId: string,
  payload: Record<string, unknown> = {},
  token = admin.accessToken
): Promise<ReviewView> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/fact-review/generate`,
    headers: authHeader(token),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as ReviewView;
}

async function readReview(productId: string, reviewId: string, token = admin.accessToken): Promise<ReviewView> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/fact-review/${reviewId}`,
    headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as ReviewView;
}

async function decide(
  action: "approve" | "reject",
  productId: string,
  payload: Record<string, unknown> = {},
  token = admin.accessToken
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await context.app.inject({
    method: "POST",
    url: `/api/products/${productId}/fact-review/${action}`,
    headers: authHeader(token),
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
      email: `${role.toLowerCase()}-phase14@longdeji.local`,
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
 * 目的不是伪造数据，而是让「审核对象是一版冻结的成稿」这条链路可被验证：
 * 真实产品不会写出「全国第一」，但审核器必须在有人写出来时抓住它（§49）。
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

describe("§24 / §49 / §53 合同与标签：口径只有一份，前端不自造", () => {
  it("未登录不能读合同 / 标签 / 总览（401）", async () => {
    const productId = await createFullProduct();
    const unauth = await context.app.inject({ method: "GET", url: "/api/fact-review/contract" });
    expect(unauth.statusCode).toBe(401);
    expect(
      (await context.app.inject({ method: "GET", url: "/api/fact-review/labels" })).statusCode
    ).toBe(401);
    expect(
      (await context.app.inject({ method: "GET", url: `/api/products/${productId}/fact-review` }))
        .statusCode
    ).toBe(401);
  });

  it("合同锁定三层标记 / 三档风险 / 五种证据 / §53 五列 / 十三项焦点与全部红线", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/fact-review/contract",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      contract: typeof FACT_REVIEW_CONTRACT;
      engine: { prompt_key: string; ai_wired: boolean; rule_engine_authoritative: boolean };
      downstream: { phase: number; status: string }[];
      limits: { maxVersionsPerCopy: number };
    };
    const { contract } = body;

    expect(contract.spec_ref).toBe(FACT_REVIEW_SPEC_REF);
    expect(contract.claim_types.map((item) => item.key)).toEqual(["FACT", "INTERPRETATION", "RHETORIC"]);
    expect(contract.claim_types.map((item) => item.label)).toEqual([
      CLAIM_TYPE_LABELS.FACT,
      CLAIM_TYPE_LABELS.INTERPRETATION,
      CLAIM_TYPE_LABELS.RHETORIC
    ]);
    expect(contract.claim_types.every((item) => item.hint.length > 0)).toBe(true);

    expect(contract.risk_levels.map((item) => item.key)).toEqual(["GREEN", "YELLOW", "RED"]);
    expect(contract.risk_levels.map((item) => item.label)).toEqual([
      RISK_LEVEL_LABELS.GREEN,
      RISK_LEVEL_LABELS.YELLOW,
      RISK_LEVEL_LABELS.RED
    ]);
    expect(contract.risk_levels.every((item) => item.hint.length > 0)).toBe(true);

    expect(contract.statuses.map((item) => item.key)).toEqual(["PENDING", "APPROVED", "REJECTED"]);
    expect(contract.statuses.map((item) => item.label)).toEqual([
      FACT_REVIEW_STATUS_LABELS.PENDING,
      FACT_REVIEW_STATUS_LABELS.APPROVED,
      FACT_REVIEW_STATUS_LABELS.REJECTED
    ]);

    expect(Object.keys(FACT_EVIDENCE_KIND_LABELS)).toEqual([
      "PRODUCT_FACT",
      "VALUE_DNA",
      "UPSTREAM_COPY",
      "RND_REFERENCE"
    ]);
    expect(contract.evidence_kinds.map((item) => item.key)).toEqual([
      "PRODUCT_FACT",
      "VALUE_DNA",
      "UPSTREAM_COPY",
      "RND_REFERENCE"
    ]);

    expect(contract.focus_items).toEqual([...FACT_REVIEW_FOCUS_LABELS]);
    expect(contract.focus_items).toHaveLength(13);
    expect(contract.sentence_columns).toEqual([...FACT_REVIEW_SENTENCE_COLUMNS]);
    expect(contract.sentence_columns).toHaveLength(5);

    expect(contract.rhetoric_not_fraud).toBe(true);
    expect(contract.red_blocks_approval).toBe(true);
    expect(contract.rhetoric_kept).toBe(true);
    expect(contract.keep_all_versions).toBe(true);
    expect(contract.rnd_requires_confirmation).toBe(true);
    expect(contract.ai_can_only_tighten).toBe(true);
    expect(contract.rules.length).toBe(10);
    const rules = contract.rules.join("丨");
    expect(rules).toContain("三层标记 FACT / INTERPRETATION / RHETORIC");
    expect(rules).toContain("这就是按照 X 配方做出来的");
    expect(contract.focus_items).toContain("市场第一");
    expect(rules).toContain("所有版本必须保留");

    expect(body.engine.prompt_key).toBe("FACT_REVIEWER");
    expect(body.engine.ai_wired).toBe(true);
    expect(body.engine.rule_engine_authoritative).toBe(true);
    expect(body.limits.maxVersionsPerCopy).toBe(FACT_REVIEW_LIMITS.maxVersionsPerCopy);

    expect(body.downstream.map((item) => item.phase)).toEqual(FACT_REVIEW_DOWNSTREAM.map((item) => item.phase));
    // Phase 15（主播中心 / 经销商中心 / 导出）交付后不再登记下游阶段：空数组就是正确口径。
    expect(body.downstream).toHaveLength(0);
  });

  it("标签接口下发三层 / 三档 / 审批状态 / 证据类型与规则，前端不再自造一套文案", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/fact-review/labels",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      claim_type_labels: Record<string, string>;
      claim_type_hints: Record<string, string>;
      risk_level_labels: Record<string, string>;
      risk_level_hints: Record<string, string>;
      status_labels: Record<string, string>;
      evidence_kind_labels: Record<string, string>;
      focus_items: string[];
      sentence_columns: string[];
      limits: { maxVersionsPerCopy: number };
      rules: string[];
    };
    expect(body.claim_type_labels).toEqual({ ...CLAIM_TYPE_LABELS });
    expect(body.risk_level_labels).toEqual({ ...RISK_LEVEL_LABELS });
    expect(body.status_labels).toEqual({ ...FACT_REVIEW_STATUS_LABELS });
    expect(body.evidence_kind_labels).toEqual({ ...FACT_EVIDENCE_KIND_LABELS });
    expect(Object.keys(body.claim_type_hints)).toEqual(["FACT", "INTERPRETATION", "RHETORIC"]);
    expect(Object.keys(body.risk_level_hints)).toEqual(["GREEN", "YELLOW", "RED"]);
    expect(body.focus_items).toHaveLength(13);
    expect(body.sentence_columns).toHaveLength(5);
    expect(body.limits.maxVersionsPerCopy).toBe(20);
    expect(body.rules).toHaveLength(10);
  });
});

describe("§53 权限：读需登录，写限 ADMIN / RESEARCHER", () => {
  it("VIEWER 可以看总览，但不能送审 / 审批 / 否决（403）", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const viewerToken = await createUserToken("VIEWER");

    const overview = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/fact-review`,
      headers: authHeader(viewerToken)
    });
    expect(overview.statusCode).toBe(200);

    for (const url of [
      `/api/products/${productId}/fact-review/generate`,
      `/api/products/${productId}/fact-review/approve`,
      `/api/products/${productId}/fact-review/reject`
    ]) {
      const response = await context.app.inject({
        method: "POST",
        url,
        headers: authHeader(viewerToken),
        payload: {}
      });
      expect(response.statusCode, url).toBe(403);
    }
  });

  it("RESEARCHER 可以送审与审批（§36 分工不限死在一人身上）", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const researcherToken = await createUserToken("RESEARCHER");

    const reviewed = await runReview(productId, {}, researcherToken);
    expect(reviewed.review.sentences.length).toBeGreaterThan(0);
    const decided = await decide("approve", productId, {}, researcherToken);
    expect(decided.statusCode).toBe(200);
  });
});

describe("§53 总览与送审入口", () => {
  it("没有成稿时不允许审核，并给出中文阻断原因而不是空页面", async () => {
    const productId = await createThinProduct();
    const overview = await readOverview(productId);
    expect(overview.can_review).toBe(false);
    expect(overview.copy_record_id).toBeNull();
    expect(overview.block_reason).toContain("先生成一版主播稿");
    expect(overview.review).toBeNull();
    expect(overview.versions).toEqual([]);
    expect(overview.approval.status).toBe("PENDING");
    expect(overview.spec_ref).toBe("§24 / §49 / §53");

    const rejected = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/fact-review/generate`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("生成成稿后总览可审核，审核版本只增不删（§62-15）", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);

    const pending = await readOverview(productId);
    expect(pending.can_review).toBe(true);
    expect(pending.review).toBeNull();
    expect(pending.versions).toEqual([]);
    expect(pending.approval.status).toBe("PENDING");

    const first = await runReview(productId);
    expect(first.review.version).toBe(1);
    expect(first.review.copy_version).toBe(1);

    const second = await runReview(productId);
    expect(second.review.version).toBe(2);

    const versions = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/fact-review/versions`,
      headers: authHeader(admin.accessToken)
    });
    expect(versions.statusCode).toBe(200);
    const items = (versions.json() as { items: VersionSummary[] }).items;
    expect(items.map((item) => item.version)).toEqual([2, 1]);

    const after = await readOverview(productId);
    expect(after.versions).toHaveLength(2);
    expect(after.review?.version).toBe(2);

    /** 新版成稿 = 新的审核对象：审核对象永远是最新一版（§57）。 */
    await generateCopy(productId);
    const newestCopy = await readOverview(productId);
    expect(newestCopy.copy_version).toBe(2);
    expect(newestCopy.review).toBeNull();
    /** 总览只谈当前审核对象（最新一版成稿）；历史审核在版本列表里全都在（§62-15）。 */
    expect(newestCopy.versions).toEqual([]);
    const history = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/fact-review/versions`,
      headers: authHeader(admin.accessToken)
    });
    const historyItems = (history.json() as { items: VersionSummary[] }).items;
    expect(historyItems.map((item) => item.copy_version)).toEqual([1, 1]);
    expect(historyItems.map((item) => item.version)).toEqual([2, 1]);
  });
});

describe("§24 / §49 逐句判定：三层标记 / 三档风险 / 五列证据", () => {
  it("事实齐备的产品：无 RED、可发布，每句都有 Claim Type 与 Risk，五列齐全", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const { review, evidence } = await runReview(productId);

    expect(review.engine).toBe("RULE");
    expect(review.warnings).toEqual([]);
    expect(review.sentences.length).toBeGreaterThan(20);
    expect(review.summary.red).toBe(0);
    expect(review.blocking_sentences).toEqual([]);
    expect(review.publishable).toBe(true);
    expect(review.compliance.risk).not.toBe("RED");
    expect(review.spec_ref).toBe(FACT_REVIEW_SPEC_REF);

    expect(
      review.claim_counts.FACT + review.claim_counts.INTERPRETATION + review.claim_counts.RHETORIC
    ).toBe(review.sentences.length);
    expect(review.claim_counts.RHETORIC).toBeGreaterThan(0);
    expect(review.summary.green + review.summary.yellow + review.summary.red).toBe(
      review.sentences.length
    );
    expect(review.sentences.every((sentence) => sentence.text.length > 0)).toBe(true);
    expect(review.sentences.map((sentence) => sentence.index)).toEqual(
      review.sentences.map((_, position) => position + 1)
    );

    /** Evidence 是机械逐字回查结果：有出处的句子必须能落到具体来源。 */
    expect(review.facts_used).toBeGreaterThan(0);
    expect(evidence.length).toBeGreaterThan(0);
    const sentenceIds = new Set(evidence.map((item) => item.claim_id));
    expect(sentenceIds.size).toBeGreaterThan(0);
    expect(
      evidence.every((item) => item.excerpt.trim().length > 0 && item.traceable === true)
    ).toBe(true);
    expect(
      evidence.every((item) =>
        ["PRODUCT_FACT", "VALUE_DNA", "UPSTREAM_COPY", "RND_REFERENCE"].includes(item.evidence_kind)
      )
    ).toBe(true);

    /** YELLOW 不是红线：缺出处的句子进证据缺口清单，仍可发布（§49）。 */
    const yellow = review.sentences.filter((sentence) => sentence.risk === "YELLOW");
    expect(yellow.every((sentence) => sentence.issue !== null && sentence.suggestion !== null)).toBe(
      true
    );
    const red = review.sentences.filter((sentence) => sentence.risk === "RED");
    expect(red).toEqual([]);
  });

  it("修辞按 RHETORIC / GREEN 处理，不因「不是字面事实」被判 RED（§24 / §57）", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const { review } = await runReview(productId);

    const rhetoric = review.sentences.filter((sentence) => sentence.claim_type === "RHETORIC");
    expect(rhetoric.length).toBeGreaterThan(0);
    expect(rhetoric.every((sentence) => sentence.is_blocking === false)).toBe(true);
    const fact = review.sentences.filter((sentence) => sentence.claim_type === "FACT");
    expect(fact.some((sentence) => sentence.evidence_refs.length > 0)).toBe(true);
  });

  it("红线句逐条判 RED 并阻断发布：绝对化断言 / 收益承诺 / 凭空价格 / 编配方", async () => {
    const productId = await createThinProduct();
    const recordId = await generateCopy(productId);
    await injectRedSentence(recordId, "这款茶是全国第一。这饼茶必涨，买了就是稳赚。它已经卖到 8888 元。我们就是按 2003 六星孔雀的配方做的。");

    const { review } = await runReview(productId);
    expect(review.overall_risk).toBe("RED");
    expect(review.publishable).toBe(false);
    expect(review.summary.red).toBeGreaterThanOrEqual(4);
    expect(review.blocking_sentences).toHaveLength(review.summary.red);
    expect(review.blocking_sentences).toEqual(
      review.sentences.filter((sentence) => sentence.risk === "RED").map((sentence) => sentence.text)
    );

    const issues = review.sentences
      .filter((sentence) => sentence.risk === "RED")
      .map((sentence) => sentence.issue ?? "");
    expect(issues.some((issue) => issue.includes("绝对化断言"))).toBe(true);
    expect(issues.some((issue) => issue.includes("禁止承诺"))).toBe(true);
    expect(issues.some((issue) => issue.includes("价格数字"))).toBe(true);
    expect(
      review.sentences
        .filter((sentence) => sentence.risk === "RED")
        .every((sentence) => sentence.is_blocking && sentence.suggestion !== null)
    ).toBe(true);
  });
});

describe("§53 / §57 人工审批：RED 禁止通过", () => {
  it("存在阻断句时审批 400，并把阻断句与结论回给前端", async () => {
    const productId = await createThinProduct();
    const recordId = await generateCopy(productId);
    await injectRedSentence(recordId, "这款茶是全国第一。");

    const { review } = await runReview(productId);
    const denied = await decide("approve", productId, { note: "想直接过" });
    expect(denied.statusCode).toBe(400);
    const error = denied.body.error as {
      code: string;
      details: { reviewed_version: number; blocking_sentences: string[]; publishable: boolean };
    };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.details.reviewed_version).toBe(review.version);
    expect(error.details.publishable).toBe(false);
    expect(error.details.blocking_sentences).toEqual(review.blocking_sentences);

    /** 被拒之后仍然没有审批结论：未通过就是未通过（§62-15）。 */
    expect((await readOverview(productId)).approval.status).toBe("PENDING");

    /** 否决永远可用：它记录的就是「这一版没通过」。 */
    const rejectedDecision = await decide("reject", productId, { note: "红线句要先改写" });
    expect(rejectedDecision.statusCode).toBe(200);
    const rejectedView = rejectedDecision.body as unknown as ReviewView;
    expect(rejectedView.review.blocking_sentences).toEqual(review.blocking_sentences);
    const overview = await readOverview(productId);
    expect(overview.approval.status).toBe("REJECTED");
    expect(overview.approval.note).toBe("红线句要先改写");
    expect(overview.approval.reviewed_version).toBe(review.version);
    expect(overview.approval.reviewed_at).not.toBeNull();
  });

  it("无阻断句时审批通过，并把审批记在被审批的那一版上", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const first = await runReview(productId);
    const second = await runReview(productId);

    const approved = await decide("approve", productId, { version: second.review.version, note: "逐句核对完成" });
    expect(approved.statusCode).toBe(200);
    const view = approved.body as unknown as ReviewView;
    expect(view.review.version).toBe(second.review.version);

    const overview = await readOverview(productId);
    expect(overview.approval.status).toBe("APPROVED");
    expect(overview.approval.reviewed_version).toBe(2);
    expect(overview.approval.note).toBe("逐句核对完成");
    expect(overview.approval.reviewed_by).toBe(admin.userId);

    /** 被审批的是「那一次审核」，v1 的结论不会跟着变成已通过（§57 / §62-15）。 */
    expect((await readReview(productId, first.review.id)).review.version).toBe(1);
    expect((await readReview(productId, second.review.id)).review.version).toBe(2);
  });

  it("审批不存在的版本 / 不存在的产品一律 404，不静默通过", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    await runReview(productId);

    expect((await decide("approve", productId, { version: 99 })).statusCode).toBe(404);
    const unknown = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/fact-review/00000000-0000-4000-8000-000000000000`,
      headers: authHeader(admin.accessToken)
    });
    expect(unknown.statusCode).toBe(404);
    const otherProduct = await createThinProduct("龙德记另一个试样");
    expect(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/products/${otherProduct}/fact-review`,
          headers: authHeader(admin.accessToken)
        })
      ).statusCode
    ).toBe(200);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/products/not-a-uuid/fact-review/generate",
          headers: authHeader(admin.accessToken),
          payload: {}
        })
      ).statusCode
    ).toBe(404);
  });
});

describe("§57 / §62-15 落库即冻结：回看历史审核不重算", () => {
  it("今天补录产品事实，不会改写三个月前那一次审核的逐句结论", async () => {
    const productId = await createThinProduct();
    await generateCopy(productId);
    const first = await runReview(productId);
    expect(first.review.sentences.some((sentence) => sentence.evidence_refs.length === 0)).toBe(true);

    /** 补录一批事实之后再回看同一份审核。 */
    for (const fact of [
      { fact_key: "mountain", fact_value: "布朗山" },
      { fact_key: "tree_type", fact_value: "大树" },
      { fact_key: "raw_material", fact_value: "大树春茶" }
    ]) {
      const created = await context.app.inject({
        method: "POST",
        url: `/api/products/${productId}/facts`,
        headers: authHeader(admin.accessToken),
        payload: fact
      });
      expect(created.statusCode).toBe(201);
    }

    const reread = await readReview(productId, first.review.id);
    expect(reread.review.sentences).toEqual(first.review.sentences);
    expect(reread.review.summary).toEqual(first.review.summary);
    expect(reread.review.claim_counts).toEqual(first.review.claim_counts);
    expect(reread.evidence).toEqual(first.evidence);

    /** 重新送审才会用上今天的事实：旧审核原封不动，新审核是新增版本（§62-15）。 */
    const second = await runReview(productId);
    expect(second.review.version).toBe(2);
    expect((await readReview(productId, first.review.id)).review.sentences).toEqual(
      first.review.sentences
    );
  });

  it("冻结锚点与研发证据：审核取的是成稿落库那一版的值，不随今日数据漂移", async () => {
    const productId = await createFullProduct();
    const recordId = await generateCopy(productId);
    const copy = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/copy/${recordId}`,
      headers: authHeader(admin.accessToken)
    });
    expect(copy.statusCode).toBe(200);
    const stored = copy.json() as {
      anchor: { has_reliable_price_anchor: boolean };
      compliance: { rnd_confirmed: boolean };
    };

    const { review } = await runReview(productId);
    /** 审核用的锚点 / 研发证据就是成稿落库时冻结的那一份，而不是重新解析今日数据（§57）。 */
    expect(review.has_reliable_price_anchor).toBe(stored.anchor.has_reliable_price_anchor);
    expect(review.rnd_confirmed).toBe(stored.compliance.rnd_confirmed);
    expect(review.price_high_story_ready).toBe(review.has_reliable_price_anchor);

    const reread = await readReview(productId, review.id);
    expect(reread.review.has_reliable_price_anchor).toBe(review.has_reliable_price_anchor);
    expect(reread.review.rnd_confirmed).toBe(review.rnd_confirmed);
    expect(reread.review.engine).toBe(review.engine);
    expect(reread.review.created_at).toBe(review.created_at);
  });
});

describe("§62-14 Agent 11：AI 只能加严，不可用时回落纯规则引擎", () => {
  it("AI 不可用（Mock / 失败）时整份回落纯规则引擎，并留下可读 warning", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const { review } = await runReview(productId, { use_ai: true });

    expect(review.engine).toBe("RULE");
    expect(review.warnings.some((warning) => warning.includes("退回纯规则引擎"))).toBe(true);
    expect(review.sentences.length).toBeGreaterThan(0);
    expect(review.publishable).toBe(true);
  });

  it("送审备注写进审核记录，人工回看能看到「为什么重审了这一版」", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);
    const { review } = await runReview(productId, { notes: "主播反馈价格段落太保守，重审一次" });
    expect(review.warnings).toEqual(["送审备注：主播反馈价格段落太保守，重审一次"]);
    const reread = await readReview(productId, review.id);
    expect(reread.review.warnings).toEqual(review.warnings);
  });
});

describe("§53 strict 校验：多余字段一律拒绝，不偷偷忽略", () => {
  it("送审 / 审批传多余字段返回 400", async () => {
    const productId = await createFullProduct();
    await generateCopy(productId);

    const extra = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/fact-review/generate`,
      headers: authHeader(admin.accessToken),
      payload: { skip_red: true }
    });
    expect(extra.statusCode).toBe(400);
    expect(extra.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    await runReview(productId);
    const badDecision = await decide("approve", productId, { force: true });
    expect(badDecision.statusCode).toBe(400);
    expect(badDecision.body.error).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("审核 id 传成别的产品的行也会 404，不会串门读到别人的审核", async () => {
    const productA = await createFullProduct("龙德记六星孔雀 A");
    const productB = await createFullProduct("龙德记六星孔雀 B");
    await generateCopy(productB);
    const reviewB = await runReview(productB);

    const crossRead = await context.app.inject({
      method: "GET",
      url: `/api/products/${productA}/fact-review/${reviewB.review.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(crossRead.statusCode).toBe(404);
  });
});
