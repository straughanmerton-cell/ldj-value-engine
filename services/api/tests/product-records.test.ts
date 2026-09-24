import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  SIX_STAR_PEACOCK_FIXTURE,
  authHeader,
  bootstrapAdmin,
  createTestContext,
  type BootstrapResult,
  type TestContext
} from "./helpers/app.js";

let context: TestContext;
let admin: BootstrapResult;
let productId: string;

beforeAll(async () => {
  context = await createTestContext();
});

beforeEach(async () => {
  await context.reset();
  admin = await bootstrapAdmin(context.app, {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  });
  const created = await context.app.inject({
    method: "POST",
    url: "/api/products",
    headers: authHeader(admin.accessToken),
    payload: { ...SIX_STAR_PEACOCK_FIXTURE, brand_id: null }
  });
  productId = (created.json() as { id: string }).id;
});

afterAll(async () => {
  await context.close();
});

async function createUserToken(role: "RESEARCHER" | "COPYWRITER" | "VIEWER"): Promise<string> {
  const response = await context.app.inject({
    method: "POST",
    url: "/api/auth/register",
    headers: authHeader(admin.accessToken),
    payload: {
      email: `${role.toLowerCase()}@longdeji.local`,
      password: "RolePassword1234",
      name: `测试${role}`,
      role
    }
  });
  return (response.json() as { tokens: { access_token: string } }).tokens.access_token;
}

describe("产品事实清单（规格 §11 / §36）", () => {
  it("新建产品不会自动生成事实与研发关系（未确认即不编造）", async () => {
    const facts = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken)
    });
    expect(facts.statusCode).toBe(200);
    expect(facts.json()).toMatchObject({ items: [], total: 0 });

    const rnd = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/rnd-references`,
      headers: authHeader(admin.accessToken)
    });
    expect(rnd.statusCode).toBe(200);
    expect(rnd.json()).toMatchObject({ items: [], total: 0 });
  });

  it("未提供状态时按 UNCONFIRMED 存储，并按事实键推导分组与标签", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken),
      payload: { fact_key: "mountain", fact_value: "布朗山" }
    });
    expect(response.statusCode).toBe(201);
    const fact = response.json() as Record<string, unknown>;
    expect(fact.fact_status).toBe("UNCONFIRMED");
    expect(fact.fact_group).toBe("BASICS");
    expect(fact.fact_label).toBe("山头");
    expect(fact.evidence_note).toBeNull();
    expect(fact.confirmed_at).toBeNull();
  });

  it("非 UNCONFIRMED 状态必须带证据，否则拒绝写入", async () => {
    const missing = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken),
      payload: { fact_key: "raw_material", fact_value: "大树春茶", fact_status: "TASTING_CONFIRMED" }
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });

    const ok = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken),
      payload: {
        fact_key: "raw_material",
        fact_value: "大树春茶",
        fact_status: "RND_CONFIRMED",
        evidence_note: "2026-03 内部评审记录 RD-2026-014"
      }
    });
    expect(ok.statusCode).toBe(201);
    const fact = ok.json() as Record<string, unknown>;
    expect(fact.fact_status).toBe("RND_CONFIRMED");
    expect(fact.confirmed_by).toBe(admin.userId);
    expect(typeof fact.confirmed_at).toBe("string");
  });

  it("OFFICIAL_CONFIRMED 仅 ADMIN 可判定", async () => {
    const researcherToken = await createUserToken("RESEARCHER");
    const forbidden = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(researcherToken),
      payload: {
        fact_key: "year",
        fact_value: "2026",
        fact_status: "OFFICIAL_CONFIRMED",
        evidence_note: "官方发布资料"
      }
    });
    expect(forbidden.statusCode).toBe(403);

    const allowed = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken),
      payload: {
        fact_key: "year",
        fact_value: "2026",
        fact_status: "OFFICIAL_CONFIRMED",
        evidence_note: "官方发布资料"
      }
    });
    expect(allowed.statusCode).toBe(201);
  });

  it("PATCH 只更新提交字段，退回 UNCONFIRMED 时清空确认信息", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken),
      payload: {
        fact_key: "season",
        fact_value: "春茶",
        fact_status: "INTERNAL_CONFIRMED",
        evidence_note: "内部采摘记录"
      }
    });
    const fact = created.json() as { id: string };

    const updated = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/facts/${fact.id}`,
      headers: authHeader(admin.accessToken),
      payload: { fact_status: "UNCONFIRMED" }
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as Record<string, unknown>;
    expect(body.fact_status).toBe("UNCONFIRMED");
    expect(body.fact_value).toBe("春茶");
    expect(body.confirmed_by).toBeNull();
    expect(body.confirmed_at).toBeNull();
  });

  it("状态被提升为已确认但没有证据时拒绝更新", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(admin.accessToken),
      payload: { fact_key: "village", fact_value: "老班章" }
    });
    const fact = created.json() as { id: string };

    const rejected = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/facts/${fact.id}`,
      headers: authHeader(admin.accessToken),
      payload: { fact_status: "INTERNAL_CONFIRMED" }
    });
    expect(rejected.statusCode).toBe(400);
  });

  it("VIEWER 只能读取事实清单", async () => {
    const viewerToken = await createUserToken("VIEWER");
    const read = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(viewerToken)
    });
    expect(read.statusCode).toBe(200);

    const write = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/facts`,
      headers: authHeader(viewerToken),
      payload: { fact_key: "mountain", fact_value: "布朗山" }
    });
    expect(write.statusCode).toBe(403);
  });

  it("产品不存在时返回 404", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/products/00000000-0000-4000-8000-000000000000/facts",
      headers: authHeader(admin.accessToken)
    });
    expect(response.statusCode).toBe(404);
  });
});

describe("品饮档案（规格 §10.4）", () => {
  it("可以记录多轮品饮，并保留品饮人与日期", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/tasting-profiles`,
      headers: authHeader(admin.accessToken),
      payload: {
        taster_name: "评审员A",
        tasted_at: "2026-03-18",
        dry_leaf_aroma: "烟香明显",
        entry_taste: "浓强",
        huigan: "快",
        salivation: "强",
        conclusion: "烟香与浓强度符合六星孔雀定位"
      }
    });
    expect(created.statusCode).toBe(201);
    const profile = created.json() as Record<string, unknown>;
    expect(profile.hot_cup_aroma).toBeNull();
    expect(profile.taster_name).toBe("评审员A");
    expect(profile.version).toBe(1);
    expect(String(profile.tasted_at)).toContain("2026-03-18");
  });

  it("空档案被拒绝（避免把未品饮当成已品饮）", async () => {
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/tasting-profiles`,
      headers: authHeader(admin.accessToken),
      payload: { taster_name: "评审员B" }
    });
    expect(response.statusCode).toBe(400);
  });

  it("PATCH 只更新提交字段并递增版本", async () => {
    const created = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/tasting-profiles`,
      headers: authHeader(admin.accessToken),
      payload: { entry_taste: "浓强", conclusion: "初评" }
    });
    const profile = created.json() as { id: string };

    const updated = await context.app.inject({
      method: "PATCH",
      url: `/api/products/${productId}/tasting-profiles/${profile.id}`,
      headers: authHeader(admin.accessToken),
      payload: { cha_qi: "明显" }
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as Record<string, unknown>;
    expect(body.cha_qi).toBe("明显");
    expect(body.entry_taste).toBe("浓强");
    expect(body.version).toBe(2);
  });

  it("列表按产品隔离", async () => {
    const other = await context.app.inject({
      method: "POST",
      url: "/api/products",
      headers: authHeader(admin.accessToken),
      payload: { product_name: "龙德记五星孔雀", year: 2025, tea_type: "普洱生茶", weight_g: 357 }
    });
    const otherId = (other.json() as { id: string }).id;
    await context.app.inject({
      method: "POST",
      url: `/api/products/${otherId}/tasting-profiles`,
      headers: authHeader(admin.accessToken),
      payload: { entry_taste: "柔和" }
    });

    const list = await context.app.inject({
      method: "GET",
      url: `/api/products/${productId}/tasting-profiles`,
      headers: authHeader(admin.accessToken)
    });
    expect(list.json()).toMatchObject({ total: 0 });
  });
});

describe("研发参考（规格 §35.2 / §25）", () => {
  async function createReference(payload: Record<string, unknown>) {
    return context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/rnd-references`,
      headers: authHeader(admin.accessToken),
      payload
    });
  }

  it("可创建研发参考并返回声明许可标志", async () => {
    const response = await createReference({
      reference_product_name: "2003 年六星孔雀",
      reference_type: "sensory",
      description: "参考其烟香表现与汤感结构",
      verification_status: "UNCONFIRMED"
    });
    expect(response.statusCode).toBe(201);
    const reference = response.json() as Record<string, unknown>;
    expect(reference.claims_allowed).toBe(false);
    expect(reference.reference_type).toBe("sensory");
  });

  it("无 RND_CONFIRMED 证据时禁止使用「复刻 / 同款配方」表述", async () => {
    const rejected = await createReference({
      reference_product_name: "2003 年六星孔雀",
      reference_type: "formula_structure",
      description: "复刻 2003 六星孔雀的同款配方",
      verification_status: "INTERNAL_CONFIRMED",
      evidence_note: "内部会议纪要"
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { restricted_phrases: expect.arrayContaining(["复刻", "同款配方"]) }
      }
    });
  });

  it("PUT 升级为 RND_CONFIRMED 且带证据后允许声明研发关系", async () => {
    const created = await createReference({
      reference_product_name: "2003 年六星孔雀",
      reference_type: "sensory",
      description: "参考其烟香表现",
      verification_status: "UNCONFIRMED"
    });
    const reference = created.json() as { id: string };

    const withoutEvidence = await context.app.inject({
      method: "PUT",
      url: `/api/products/${productId}/rnd-references/${reference.id}`,
      headers: authHeader(admin.accessToken),
      payload: { verification_status: "RND_CONFIRMED" }
    });
    expect(withoutEvidence.statusCode).toBe(400);

    const updated = await context.app.inject({
      method: "PUT",
      url: `/api/products/${productId}/rnd-references/${reference.id}`,
      headers: authHeader(admin.accessToken),
      payload: {
        verification_status: "RND_CONFIRMED",
        evidence_note: "研发评审记录 RD-2026-021：以该产品烟香作为风格参考之一"
      }
    });
    expect(updated.statusCode).toBe(200);
    const body = updated.json() as Record<string, unknown>;
    expect(body.claims_allowed).toBe(true);
    expect(body.reference_product_name).toBe("2003 年六星孔雀");
  });

  it("研发参考不能指向产品自身", async () => {
    const response = await createReference({
      reference_product_id: productId,
      reference_product_name: "龙德记六星孔雀",
      reference_type: "other",
      description: "自引用",
      verification_status: "UNCONFIRMED"
    });
    expect(response.statusCode).toBe(400);
  });

  it("COPYWRITER 不能写入研发参考", async () => {
    const copywriterToken = await createUserToken("COPYWRITER");
    const response = await context.app.inject({
      method: "POST",
      url: `/api/products/${productId}/rnd-references`,
      headers: authHeader(copywriterToken),
      payload: {
        reference_product_name: "某标杆产品",
        reference_type: "sensory",
        description: "参考口感",
        verification_status: "UNCONFIRMED"
      }
    });
    expect(response.statusCode).toBe(403);
  });
});
