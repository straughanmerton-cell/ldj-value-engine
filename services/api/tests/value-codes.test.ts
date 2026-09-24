import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  TIME_DEPENDENT_FORBIDDEN_EXPRESSION,
  TIME_DEPENDENT_SAFE_EXPRESSION,
  VALUE_CODE_META,
  VALUE_CODE_STATUS_ORDER,
  VALUE_CODE_TIME_DEPENDENT_KEYS,
  valueStoryKeys
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
 * Phase 9（规格 §18 Value Codes / §19 状态判定 / §20 六类价值故事 / §30 价值拆解 / §44 不移植竞品事实）。
 *
 * 本文件锁定五件事：
 * - **16 个 Code 与 5 种状态由 §18 / §19 固定**：顺序、含义与表达规范只能从后端读，前端不得自造；
 * - **没录入就是 UNKNOWN**（§11 / §62-7）：UNKNOWN 不得携带前台表达，只能进缺口清单；
 * - **TIME_DEPENDENT 不得承诺未来**（§19）：成交层表达只能是固定安全句式；
 * - **证据只来自本产品**（§44 / §62-5）：对标只提供「高价值产品需要什么底层条件」这一层标准；
 * - **版本只增不删**（§62-15）：重新生成派生新版本，人工确认只改确认状态。
 */

interface CodeItem {
  code: string;
  label: string;
  definition: string;
  dimensions: string[];
  requirement: string;
  contribution: string;
  evidence: string[];
  evidence_refs: string[];
  status: "ALREADY_HAVE" | "PARTIAL" | "TIME_DEPENDENT" | "NOT_HAVE" | "UNKNOWN";
  status_reason: string;
  statement: string | null;
  safe_expression: string | null;
  gap: string | null;
  layer: string;
}

interface StoryItem {
  label: string;
  status: "READY" | "PARTIAL" | "GAP" | "HANDOFF";
  text: string | null;
  layer: string;
  based_on: string[];
  gap: string | null;
  handoff_phase: number | null;
  note: string | null;
}

interface DownstreamItem {
  phase: number;
  deliverable: string;
  spec_ref: string;
  status: string;
}

interface ProfileBody {
  id: string;
  product_id: string;
  product_name: string | null;
  version: number;
  preference: string;
  mode_at_generation: string;
  resolved_by: string;
  mode_reason: string;
  anchor_context: { anchor_id: string | null; name: string | null; usage: string } | null;
  codes: CodeItem[];
  code_counts: Record<string, number>;
  stories: Record<string, StoryItem>;
  evidence_gaps: string[];
  fact_refs: string[];
  value_dna_refs: string[];
  downstream: DownstreamItem[];
  is_confirmed: boolean;
  confirmed_by: string | null;
  confirmed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  spec_ref: string;
}

interface OverviewBody {
  product_id: string;
  product_name: string | null;
  preference: string;
  mode: string;
  resolved_by: string;
  mode_reason: string;
  can_generate: boolean;
  block_reason: string | null;
  profile: ProfileBody | null;
  versions: {
    id: string;
    version: number;
    code_counts: Record<string, number>;
    time_dependent_count: number;
    unknown_count: number;
    is_confirmed: boolean;
  }[];
  spec_ref: string;
}

interface MatrixRow {
  product_id: string;
  product_name: string;
  year: number;
  tea_type: string;
  mountain: string | null;
  mode: string;
  preference: string;
  profile_id: string | null;
  version: number | null;
  is_confirmed: boolean;
  code_counts: Record<string, number>;
  time_dependent_codes: string[];
  unknown_codes: string[];
  already_have_codes: string[];
  time_dependent_expression: string | null;
  generated_at: string | null;
}

interface LibraryBody {
  items: MatrixRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ContractBody {
  contract: {
    spec_ref: string;
    codes: {
      code: string;
      label: string;
      definition: string;
      dimensions: string[];
      requirement: string;
      contribution: string;
      evidence_refs: string[];
      time_dependent: boolean;
    }[];
    dimensions: { dimension: string; label: string }[];
    statuses: { status: string; label: string; rule: string; tone: string }[];
    stories: { key: string; label: string }[];
    time_dependent_safe_expression: string;
    time_dependent_forbidden_expression: string;
    no_competitor_fact_transplant: boolean;
    time_dependent_not_promise: boolean;
    unknown_is_written_as_unknown: boolean;
    not_have_requires_recorded_fact: boolean;
    evidence_only_from_own_product: boolean;
    downstream_phases: DownstreamItem[];
    rules: string[];
  };
  engine: {
    spec_ref: string;
    code_count: number;
    statuses: string[];
    limits: { maxProfilesPerProduct: number; defaultPageSize: number; maxPageSize: number };
    note: string;
  };
  downstream: DownstreamItem[];
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

/** 事实齐备的产品：多数 Code 能落到 ALREADY_HAVE，三个时间依赖 Code 有底子。 */
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

/** 几乎没有事实的产品：用来验证「事实不足就写缺口，不写弱化版故事」。 */
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

async function readOverview(productId: string, token = admin.accessToken): Promise<OverviewBody> {
  const response = await context.app.inject({
    method: "GET",
    url: `/api/products/${productId}/value-codes`,
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
    url: `/api/products/${productId}/value-codes/generate`,
    headers: authHeader(token),
    payload
  });
  expect(response.statusCode).toBe(201);
  return response.json() as ProfileBody;
}

async function readLibrary(query = "", token = admin.accessToken): Promise<LibraryBody> {
  const response = await context.app.inject({
    method: "GET",
   url: `/api/value-codes${query}`,
   headers: authHeader(token)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as LibraryBody;
}

async function createUserToken(
  role: "VIEWER" | "RESEARCHER",
  email = `${role.toLowerCase()}-phase9@longdeji.local`
): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: { email, password: "RolePassword1234", name: `测试${role}`, role }
  });
  expect(response.statusCode).toBe(201);
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

function codeOf(profile: ProfileBody, code: string): CodeItem {
  const item = profile.codes.find((entry) => entry.code === code);
  if (!item) {
    throw new Error(`缺少 Code：${code}`);
  }
  return item;
}

describe("§18 / §19 合同自检与前端文案", () => {
  it("合同锁定 16 个 Code、5 种状态、§19 表达规范、五条红线与下游交接", async () => {
    const unauthorized = await context.app.inject({ method: "GET", url: "/api/value-codes/contract" });
    expect(unauthorized.statusCode).toBe(401);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/value-codes/contract",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ContractBody;
    const { contract } = body;

    expect(contract.spec_ref).toBe("§18 / §19 / §20");
    expect(contract.codes).toHaveLength(16);
    expect(contract.codes.map((item) => item.code)).toEqual(VALUE_CODE_META.map((meta) => meta.code));
    expect(
      contract.codes.every(
        (item) => item.label.length > 0 && item.requirement.length > 0 && item.contribution.length > 0
      )
    ).toBe(true);
    expect(
      contract.codes.every(
        (item) =>
          item.definition.length > 0 &&
          item.dimensions.length > 0 &&
          item.evidence_refs.every((ref) => ref.startsWith("product.") || ref.startsWith("dna."))
      )
    ).toBe(true);
    expect(contract.codes.filter((item) => item.time_dependent).map((item) => item.code)).toEqual([
      ...VALUE_CODE_TIME_DEPENDENT_KEYS
    ]);

    expect(contract.dimensions).toHaveLength(12);
    expect(contract.dimensions.map((item) => item.dimension)).toContain("VINTAGE");
    expect(contract.statuses.map((item) => item.status)).toEqual([...VALUE_CODE_STATUS_ORDER]);
    expect(contract.statuses).toHaveLength(5);
    expect(contract.statuses.find((item) => item.status === "UNKNOWN")?.label).toContain("不得书写");
    expect(contract.stories.map((item) => item.key)).toEqual([...valueStoryKeys]);

    expect(contract.time_dependent_safe_expression).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(contract.time_dependent_forbidden_expression).toBe(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
    expect(contract.no_competitor_fact_transplant).toBe(true);
    expect(contract.time_dependent_not_promise).toBe(true);
    expect(contract.unknown_is_written_as_unknown).toBe(true);
    expect(contract.not_have_requires_recorded_fact).toBe(true);
    expect(contract.evidence_only_from_own_product).toBe(true);

    expect(contract.rules).toHaveLength(7);
    expect(contract.rules.join("丨")).toContain("不得增删或重排");
    expect(contract.rules.join("丨")).toContain(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
    expect(contract.rules.join("丨")).toContain("禁止推测补全");
    expect(contract.rules.join("丨")).toContain("配方哲学由 Phase 11 交付");

    expect(body.downstream.map((item) => item.phase)).toEqual([]);
    expect(body.downstream.every((item) => item.status === "PENDING")).toBe(true);
    expect(contract.downstream_phases.map((item) => item.phase)).toEqual([]);

    expect(body.engine.code_count).toBe(16);
    expect(body.engine.statuses).toEqual([...VALUE_CODE_STATUS_ORDER]);
    expect(body.engine.limits.maxProfilesPerProduct).toBe(20);
    expect(body.engine.note).toContain("UNKNOWN");
  });

  it("标签接口把状态 / 维度 / 故事文案与 7 条规则交给前端，前端不再自造一套", async () => {
    const unauthorized = await context.app.inject({ method: "GET", url: "/api/value-codes/labels" });
    expect(unauthorized.statusCode).toBe(401);

    const response = await context.app.inject({
      method: "GET",
      url: "/api/value-codes/labels",
      headers: authHeader(admin.accessToken)
    });
    const body = response.json() as {
      statuses: { status: string }[];
      status_labels: Record<string, string>;
      status_short_labels: Record<string, string>;
      status_tones: Record<string, string>;
      dimension_labels: Record<string, string>;
      story_labels: Record<string, string>;
      story_status_labels: Record<string, string>;
      story_handoff_phases: Record<string, number>;
      time_dependent_safe_expression: string;
      rules: string[];
    };

    expect(Object.keys(body.status_labels)).toHaveLength(5);
    expect(body.status_labels.UNKNOWN).toContain("不得书写");
    expect(body.status_short_labels.TIME_DEPENDENT).toBe("时间依赖");
    expect(body.status_tones.ALREADY_HAVE).toBe("ok");
    expect(Object.keys(body.dimension_labels)).toHaveLength(12);
    expect(Object.keys(body.story_labels)).toHaveLength(6);
    expect(body.story_status_labels.HANDOFF).toContain("后续 Phase");
    // Phase 10 / 11 已交付：产品结构与配方哲学故事都不再走 HANDOFF，交接表为空。
    expect(body.story_handoff_phases.product_architecture_story).toBeUndefined();
    expect(body.story_handoff_phases.formula_philosophy_story).toBeUndefined();
    expect(body.time_dependent_safe_expression).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(body.rules).toHaveLength(7);
  });
});

describe("§17 模式判定复用：没有锚点就是自建高端标准", () => {
  it("产品没有锚点时 mode = CATEGORY_CREATOR，尚无价值映射", async () => {
    const productId = await createThinProduct();
    const overview = await readOverview(productId);

    expect(overview.mode).toBe("CATEGORY_CREATOR");
    expect(overview.preference).toBe("AUTO");
    expect(overview.resolved_by).toBe("NO_RELIABLE_ANCHOR");
    expect(overview.mode_reason).toContain("不得硬凑竞品");
    expect(overview.can_generate).toBe(true);
    expect(overview.block_reason).toBeNull();
    expect(overview.profile).toBeNull();
    expect(overview.versions).toEqual([]);
    expect(overview.spec_ref).toBe("§18 / §19 / §20");
  });

  it("读取 / 生成不存在的产品一律 404", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const headers = authHeader(admin.accessToken);
    expect(
      (await context.app.inject({ method: "GET", url: `/api/products/${missing}/value-codes`, headers }))
        .statusCode
    ).toBe(404);
    expect(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/products/${missing}/value-codes/versions`,
          headers
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: `/api/products/${missing}/value-codes/generate`,
          headers,
          payload: {}
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/products/${missing}/value-codes/${missing}`,
          headers
        })
      ).statusCode
    ).toBe(404);
  });
});

describe("§18 / §19 生成：事实齐备 → 大多数 Code 成立，时间依赖另有表达", () => {
  it("16 个 Code 全部落位，事实齐备时不出现 UNKNOWN", async () => {
    const productId = await createFullProduct();
    const profile = await generate(productId, { notes: "第一版价值拆解" });

    expect(profile.version).toBe(1);
    expect(profile.mode_at_generation).toBe("CATEGORY_CREATOR");
    expect(profile.resolved_by).toBe("NO_RELIABLE_ANCHOR");
    expect(profile.mode_reason.length).toBeGreaterThan(0);
    expect(profile.spec_ref).toBe("§18 / §19 / §20");
    expect(profile.is_confirmed).toBe(false);
    expect(profile.notes).toBe("第一版价值拆解");
    expect(profile.codes.map((item) => item.code)).toEqual(VALUE_CODE_META.map((meta) => meta.code));
    expect(profile.codes.every((item) => item.layer === "INTERPRETATION")).toBe(true);

    expect(profile.code_counts.UNKNOWN).toBe(0);
    expect(profile.code_counts.ALREADY_HAVE).toBeGreaterThanOrEqual(10);
    expect(profile.code_counts.TIME_DEPENDENT).toBe(3);

    const have = profile.codes.filter((item) => item.status === "ALREADY_HAVE");
    expect(have.every((item) => item.evidence.length >= 2)).toBe(true);
    expect(have.every((item) => item.statement !== null && item.gap === null)).toBe(true);

    const partial = profile.codes.filter((item) => item.status === "PARTIAL");
    expect(partial.every((item) => item.evidence.length === 1)).toBe(true);
    expect(partial.every((item) => item.gap !== null && item.statement !== null)).toBe(true);

    expect(profile.fact_refs).toContain("product.mountain");
    expect(profile.fact_refs.every((ref) => ref.startsWith("product.") || ref.startsWith("dna."))).toBe(true);
    expect(profile.evidence_gaps.some((gap) => gap.includes("只有 1 条事实记录"))).toBe(true);
  });

  it("§19 时间依赖型 Code：陈化 / 收藏 / 流通只能说安全句式，不得承诺未来", async () => {
    const productId = await createFullProduct();
    const profile = await generate(productId);

    for (const code of VALUE_CODE_TIME_DEPENDENT_KEYS) {
      const item = codeOf(profile, code);
      expect(item.status).toBe("TIME_DEPENDENT");
      expect(item.safe_expression).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
      expect(item.statement).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
      expect(item.gap).toContain(TIME_DEPENDENT_SAFE_EXPRESSION);
      expect(item.evidence.length).toBeGreaterThan(0);
    }

    // §19：禁止句只能作为「约束说明」出现在 story.note / contract.rules 里，
    // 不得出现在任何 Code 的成交表达（statement / contribution）或故事正文中。
    const forbidden = TIME_DEPENDENT_FORBIDDEN_EXPRESSION;
    for (const item of profile.codes) {
      expect(item.statement ?? "").not.toContain(forbidden);
      expect(item.contribution).not.toContain(forbidden);
    }
    expect(profile.stories.time_story?.text ?? "").not.toContain(forbidden);

    const timeStory = profile.stories.time_story;
    expect(timeStory?.status).toBe("READY");
    expect(timeStory?.text).toContain(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(timeStory?.note).toContain(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
  });

  it("§20 六类故事：配方哲学只登记交接；产品结构故事取 Phase 10 正文，没结构就留空", async () => {
    const productId = await createFullProduct();
    const profile = await generate(productId);

    expect(Object.keys(profile.stories)).toEqual([...valueStoryKeys]);
    expect(profile.stories.identity_story?.status).toBe("READY");
    expect(profile.stories.flavor_identity_story?.status).toBe("READY");

    // Phase 10 已交付：还没生成产品结构时，结构故事是 GAP（留空 + 指回产品结构页），不是 HANDOFF。
    const architectureBefore = profile.stories.product_architecture_story;
    expect(architectureBefore?.status).toBe("GAP");
    expect(architectureBefore?.text).toBeNull();
    expect(architectureBefore?.handoff_phase).toBeNull();
    expect(architectureBefore?.gap).toContain("尚未生成产品结构");

    // Phase 11 已交付：还没生成配方哲学时，配方哲学故事是 GAP（留空 + 指回配方哲学页），不是 HANDOFF。
    const philosophy = profile.stories.formula_philosophy_story;
    expect(philosophy?.status).toBe("GAP");
    expect(philosophy?.text).toBeNull();
    expect(philosophy?.handoff_phase).toBeNull();
    expect(philosophy?.gap).toContain("尚未生成配方哲学");

    const readyStory = profile.stories.price_ceiling_story;
    expect(readyStory?.status).toBe("READY");
    expect(readyStory?.layer).toBe("INTERPRETATION");
    expect(readyStory?.based_on).toContain("SCARCITY");
    expect(readyStory?.note).toContain("不得照抄任何竞品");

    expect(profile.downstream.map((item) => item.phase)).toEqual([]);
    expect(profile.downstream.every((item) => item.status === "PENDING")).toBe(true);
  });

  it("§20 生成产品结构后，结构故事直接引用它的正文（§5 / §57 / §60）", async () => {
    const productId = await createFullProduct();

    const architecture = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/architecture/generate`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(architecture.statusCode).toBe(201);
    const architectureBody = architecture.json() as {
      version: number;
      narrative: string;
      acceptance: { passed: boolean };
    };
    expect(architectureBody.acceptance.passed).toBe(true);

    const profile = await generate(productId);
    const story = profile.stories.product_architecture_story;
    expect(story?.status).toBe("READY");
    expect(story?.text).toBe(architectureBody.narrative);
    expect(story?.handoff_phase).toBeNull();
    expect(story?.gap).toBeNull();
    expect(story?.note).toContain(`第 ${architectureBody.version} 版`);
  });

  it("§58-7 生成配方哲学后，配方哲学故事直接引用它的设计逻辑（§6 / §46 / §57）", async () => {
    const productId = await createFullProduct();

    const philosophy = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/formula-philosophy/generate`,
      headers: authHeader(admin.accessToken),
      payload: {}
    });
    expect(philosophy.statusCode).toBe(201);
    const philosophyBody = philosophy.json() as {
      version: number;
      formula_strategy: string;
      design_logic_ready: boolean;
      acceptance: { passed: boolean };
    };
    expect(philosophyBody.design_logic_ready).toBe(true);
    expect(philosophyBody.acceptance.passed).toBe(true);

    const profile = await generate(productId);
    const story = profile.stories.formula_philosophy_story;
    expect(story?.status).toBe("READY");
    expect(story?.text).toBe(philosophyBody.formula_strategy);
    expect(story?.handoff_phase).toBeNull();
    expect(story?.gap).toBeNull();
    expect(story?.note).toContain(`第 ${philosophyBody.version} 版`);
  });
});

describe("§11 / §62-7 事实不足：写缺口而不是补故事", () => {
  it("事实不足的产品仍然生成完整映射，但 UNKNOWN 一律不携带前台表达", async () => {
    const productId = await createThinProduct();
    const profile = await generate(productId, { notes: "事实尚未录入" });

    expect(profile.version).toBe(1);
    expect(profile.codes).toHaveLength(16);
    expect(profile.code_counts.UNKNOWN).toBeGreaterThanOrEqual(10);

    const unknown = profile.codes.filter((item) => item.status === "UNKNOWN");
    expect(unknown.every((item) => item.statement === null)).toBe(true);
    expect(unknown.every((item) => item.gap !== null && item.gap.length > 0)).toBe(true);
    expect(unknown.every((item) => item.evidence.length === 0)).toBe(true);
    expect(unknown.every((item) => item.layer === "INTERPRETATION")).toBe(true);

    expect(profile.evidence_gaps.length).toBeGreaterThanOrEqual(10);
    expect(profile.evidence_gaps.some((gap) => gap.includes("未录入相关事实"))).toBe(true);

    const architecture = profile.stories.product_architecture_story;
    expect(architecture?.status).toBe("GAP");
    expect(architecture?.text).toBeNull();
    expect(architecture?.gap).toContain("尚未生成产品结构");

    // 同上：约束说明允许出现禁止句，但没有任何成交表达可以引用它。
    for (const item of profile.codes) {
      expect(item.statement ?? "").not.toContain(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
      expect(item.contribution).not.toContain(TIME_DEPENDENT_FORBIDDEN_EXPRESSION);
    }
    expect(profile.anchor_context).toBeNull();
  });
});

describe("§44 竞品事实不移植：证据只来自本产品", () => {
  it("CATEGORY_CREATOR 下没有对标上下文，所有证据都指向本产品字段与自身 Value DNA", async () => {
    const productId = await createFullProduct();
    const profile = await generate(productId);

    expect(profile.mode_at_generation).toBe("CATEGORY_CREATOR");
    expect(profile.anchor_context).toBeNull();
    expect(profile.value_dna_refs.length).toBeGreaterThan(0);
    expect(profile.value_dna_refs.every((ref) => ref.startsWith("dna."))).toBe(true);

    for (const item of profile.codes) {
      for (const evidence of item.evidence) {
        expect(evidence.startsWith("product.") || evidence.startsWith("dna.")).toBe(true);
      }
      expect(item.status_reason).not.toContain("对标产品");
    }
  });

  it("事实明确排除时才允许 NOT_HAVE，并必须写明是哪条事实（§44）", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: {
        ...SIX_STAR_PEACOCK_FIXTURE,
        product_name: "龙德记台地试样",
        tree_type: "台地小树",
        raw_material: "台地小树夏茶",
        brand_id: null
      }
    });
    expect(created.statusCode).toBe(201);
    const productId = (created.json() as { id: string }).id;

    const profile = await generate(productId);
    const material = codeOf(profile, "PREMIUM_MATERIAL");
    expect(material.status).toBe("NOT_HAVE");
    expect(material.statement).toContain("已录入事实不支持");
    expect(material.gap).toContain("台地");
    // §44：NOT_HAVE 必须能指到「哪条已录入事实排除了它」，因此证据非空且只来自本产品。
    expect(material.evidence.length).toBeGreaterThan(0);
    expect(material.evidence.some((entry) => entry.startsWith("product.raw_material="))).toBe(true);
    expect(
      material.evidence.every(
        (entry) => entry.startsWith("product.") || entry.startsWith("dna.")
      )
    ).toBe(true);
  });
});

describe("§62-15 版本与人工确认：只增不删", () => {
  it("重新生成派生新版本，旧版本仍可单独调阅", async () => {
    const productId = await createThinProduct();
    const first = await generate(productId, { notes: "v1" });

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

    const second = await generate(productId, { notes: "v2" });
    expect(second.version).toBe(2);
    expect(second.id).not.toBe(first.id);
    expect(second.code_counts.UNKNOWN).toBeLessThan(first.code_counts.UNKNOWN ?? 0);

    const versions = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/value-codes/versions`,
      headers: authHeader(admin.accessToken)
    });
    expect(versions.statusCode).toBe(200);
    const list = (versions.json() as { items: { id: string; version: number; unknown_count: number }[] })
      .items;
    expect(list.map((item) => item.version)).toEqual([2, 1]);
    expect(list.find((item) => item.version === 1)?.unknown_count).toBe(first.code_counts.UNKNOWN);

    const old = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/value-codes/${first.id}`,
      headers: authHeader(admin.accessToken)
    });
    expect(old.statusCode).toBe(200);
    expect((old.json() as ProfileBody).version).toBe(1);
    expect((old.json() as ProfileBody).code_counts.UNKNOWN).toBe(first.code_counts.UNKNOWN);

    expect((await readOverview(productId)).profile?.version).toBe(2);
  });

  it("人工确认只改确认状态，不新增版本、不改写正文", async () => {
    const productId = await createThinProduct();
    const profile = await generate(productId);

    const confirmed = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/value-codes/${profile.id}`,
      headers: authHeader(admin.accessToken),
      payload: { is_confirmed: true, notes: "研究员已核对 16 个 Code" }
    });
    expect(confirmed.statusCode).toBe(200);
    const body = confirmed.json() as ProfileBody;
    expect(body.is_confirmed).toBe(true);
    expect(body.confirmed_at).not.toBeNull();
    expect(body.confirmed_by).toBe(admin.userId);
    expect(body.version).toBe(1);
    expect(body.code_counts).toEqual(profile.code_counts);
    expect(body.notes).toBe("研究员已核对 16 个 Code");

    const versions = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/value-codes/versions`,
      headers: authHeader(admin.accessToken)
    });
    const items = (versions.json() as { items: { version: number; is_confirmed: boolean }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]?.is_confirmed).toBe(true);

    const reverted = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/value-codes/${profile.id}`,
      headers: authHeader(admin.accessToken),
      payload: { is_confirmed: false }
    });
    const revertedBody = reverted.json() as ProfileBody;
    expect(revertedBody.is_confirmed).toBe(false);
    expect(revertedBody.confirmed_at).toBeNull();
    expect(revertedBody.confirmed_by).toBeNull();
  });

  it("写入 schema 严格：状态与 Code 不允许由前端自填", async () => {
    const productId = await createThinProduct();
    const profile = await generate(productId);
    const headers = authHeader(admin.accessToken);

    const extraOnGenerate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/value-codes/generate`,
      headers,
      payload: { codes: [] }
    });
    expect(extraOnGenerate.statusCode).toBe(400);

    const extraOnPatch = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/value-codes/${profile.id}`,
      headers,
      payload: { status: "ALREADY_HAVE" }
    });
    expect(extraOnPatch.statusCode).toBe(400);
  });

  it("跨产品调阅或确认别人的版本返回 404（不串号）", async () => {
    const first = await createThinProduct("龙德记试样茶 A");
    const second = await createThinProduct("龙德记试样茶 B");
    const profile = await generate(first);
    const headers = authHeader(admin.accessToken);

    expect(
      (
        await context.app.inject({
          method: "GET",
          url: `/api/products/${second}/value-codes/${profile.id}`,
          headers
        })
      ).statusCode
    ).toBe(404);
    expect(
      (
        await context.app.inject({
          method: "PATCH",
          url: `/api/products/${second}/value-codes/${profile.id}`,
          headers,
          payload: { is_confirmed: true }
        })
      ).statusCode
    ).toBe(404);
  });
});

describe("§18 字典同步：value_codes 表与代码口径同源", () => {
  it("生成时按 §18 的 16 个 Code 同步字典表", async () => {
    const productId = await createFullProduct();
    await generate(productId);

    const rows = await context.dbHandle.db.execute(
      sql`select code, label, time_dependent from value_codes order by code`
    );
    const items = (rows as unknown as { rows: { code: string; label: string; time_dependent: boolean }[] })
      .rows;
    expect(items).toHaveLength(16);
    expect(new Set(items.map((item) => item.code))).toEqual(new Set(VALUE_CODE_META.map((meta) => meta.code)));
    expect(items.filter((item) => item.time_dependent).map((item) => item.code).sort()).toEqual(
      [...VALUE_CODE_TIME_DEPENDENT_KEYS].sort()
    );
  });
});

describe("§31 价值密码库：跨产品只读总览", () => {
  it("每款产品一行（取最新版本），尚未生成的产品也会出现", async () => {
    const full = await createFullProduct();
    const thin = await createThinProduct();
    const pending = await createThinProduct("龙德记尚未拆解试样");
    await generate(full);
    await generate(thin);

    const library = await readLibrary();
    expect(library.total).toBe(3);
    expect(library.page).toBe(1);
    expect(library.pageSize).toBe(20);
    expect(library.totalPages).toBe(1);
    expect(library.items).toHaveLength(3);

    const fullRow = library.items.find((row) => row.product_id === full);
    expect(fullRow?.version).toBe(1);
    expect(fullRow?.profile_id).not.toBeNull();
    expect(fullRow?.unknown_codes).toEqual([]);
    expect(fullRow?.time_dependent_codes).toEqual([...VALUE_CODE_TIME_DEPENDENT_KEYS]);
    expect(fullRow?.time_dependent_expression).toBe(TIME_DEPENDENT_SAFE_EXPRESSION);
    expect(fullRow?.already_have_codes.length).toBeGreaterThanOrEqual(10);
    expect(fullRow?.mode).toBe("CATEGORY_CREATOR");
    expect(fullRow?.preference).toBe("AUTO");
    expect(fullRow?.generated_at).not.toBeNull();

    const pendingRow = library.items.find((row) => row.product_id === pending);
    expect(pendingRow?.profile_id).toBeNull();
    expect(pendingRow?.version).toBeNull();
    expect(pendingRow?.code_counts.UNKNOWN).toBe(0);
    expect(pendingRow?.time_dependent_expression).toBeNull();
    expect(pendingRow?.generated_at).toBeNull();
    expect(pendingRow?.mode).toBe("CATEGORY_CREATOR");
  });

  it("筛选与排序可用：产品 / 模式 / 状态 / 关键词 / 未知数排序 / 分页", async () => {
    const full = await createFullProduct();
    const thin = await createThinProduct();
    await createThinProduct("龙德记尚未拆解试样");
    await generate(full);
    await generate(thin);

    const byProduct = await readLibrary(`?product_id=${full}`);
    expect(byProduct.total).toBe(1);
    expect(byProduct.items[0]?.product_id).toBe(full);

    const byMode = await readLibrary("?mode=CATEGORY_CREATOR");
    expect(byMode.total).toBe(2);

    const byStatus = await readLibrary("?status=UNKNOWN");
    expect(byStatus.total).toBe(1);
    expect(byStatus.items[0]?.product_id).toBe(thin);

    const byAlreadyHave = await readLibrary("?status=ALREADY_HAVE");
    expect(byAlreadyHave.total).toBe(2);

    const byQuery = await readLibrary("?q=%E5%AD%94%E9%9B%80");
    expect(byQuery.total).toBe(1);
    expect(byQuery.items[0]?.product_id).toBe(full);

    const sorted = await readLibrary("?sort=-unknown_count");
    expect(sorted.items[0]?.product_id).toBe(thin);
    expect(sorted.items.slice(1).every((row) => row.code_counts.UNKNOWN === 0)).toBe(true);

    const paged = await readLibrary("?pageSize=1&page=2");
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
    expect(paged.totalPages).toBe(3);

    const badSort = await context.app.inject({
      method: "GET",
      url: "/api/value-codes?sort=magic",
      headers: authHeader(admin.accessToken)
    });
    expect(badSort.statusCode).toBe(400);
    const badPageSize = await context.app.inject({
      method: "GET",
      url: "/api/value-codes?pageSize=999",
      headers: authHeader(admin.accessToken)
    });
    expect(badPageSize.statusCode).toBe(400);
  });
});

describe("权限矩阵：读需登录，写限 ADMIN / RESEARCHER", () => {
  it("未登录一律 401", async () => {
    const cases: { method: "GET" | "POST" | "PATCH"; url: string; payload?: Record<string, unknown> }[] = [
      { method: "GET", url: "/api/value-codes" },
      { method: "GET", url: "/api/products/00000000-0000-4000-8000-000000000000/value-codes" },
      { method: "GET", url: "/api/products/00000000-0000-4000-8000-000000000000/value-codes/versions" },
      {
        method: "POST",
        url: "/api/products/00000000-0000-4000-8000-000000000000/value-codes/generate",
        payload: {}
      },
      {
        method: "PATCH",
        url: "/api/products/00000000-0000-4000-8000-000000000000/value-codes/00000000-0000-4000-8000-000000000000",
        payload: { is_confirmed: true }
      }
    ];
    for (const entry of cases) {
      const response = await context.app.inject({
        method: entry.method,
        url: entry.url,
        ...(entry.payload ? { payload: entry.payload } : {})
      });
      expect(response.statusCode).toBe(401);
    }
  });

  it("VIEWER 只读，RESEARCHER 可生成与确认", async () => {
    const productId = await createFullProduct();
    const viewerToken = await createUserToken("VIEWER");
    const researcherToken = await createUserToken("RESEARCHER");

    expect((await readOverview(productId, viewerToken)).mode).toBe("CATEGORY_CREATOR");
    expect((await readLibrary("", viewerToken)).total).toBe(1);

    const viewerGenerate = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/value-codes/generate`,
      headers: authHeader(viewerToken),
      payload: {}
    });
    expect(viewerGenerate.statusCode).toBe(403);

    const researcherProfile = await generate(productId, { notes: "研究员生成" }, researcherToken);
    expect(researcherProfile.created_by).toBeTruthy();

    const viewerConfirm = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/value-codes/${researcherProfile.id}`,
      headers: authHeader(viewerToken),
      payload: { is_confirmed: true }
    });
    expect(viewerConfirm.statusCode).toBe(403);

    const researcherConfirm = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/value-codes/${researcherProfile.id}`,
      headers: authHeader(researcherToken),
      payload: { is_confirmed: true }
    });
    expect(researcherConfirm.statusCode).toBe(200);
    expect((researcherConfirm.json() as ProfileBody).is_confirmed).toBe(true);
  });
});
