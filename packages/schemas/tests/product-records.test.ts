import { describe, expect, it } from "vitest";
import {
  FACT_KEY_CATALOG,
  RND_CLAIM_EVIDENCE_STATUS,
  RND_CLAIM_RULES,
  SENSORY_FIELDS,
  checkRndClaimPermission,
  createProductFactSchema,
  createRndReferenceSchema,
  createTastingProfileSchema,
  findFactKeyDefinition,
  findRestrictedRndPhrases,
  resolveProductFactGroup,
  rndReferenceAllowsClaims,
  updateProductFactSchema
} from "../src/index.js";

describe("事实清单 schema（规格 §11）", () => {
  it("未提供状态时按 UNCONFIRMED 处理，不猜测确认状态", () => {
    const parsed = createProductFactSchema.parse({ fact_key: "mountain", fact_value: "布朗山" });
    expect(parsed.fact_status).toBe("UNCONFIRMED");
  });

  it("非 UNCONFIRMED 状态必须带证据说明或证据来源", () => {
    expect(
      createProductFactSchema.safeParse({
        fact_key: "tree_age",
        fact_value: "300 年",
        fact_status: "INTERNAL_CONFIRMED"
      }).success
    ).toBe(false);

    expect(
      createProductFactSchema.safeParse({
        fact_key: "tree_age",
        fact_value: "300 年",
        fact_status: "RND_CONFIRMED",
        evidence_note: "研发评审记录 RD-2026-014"
      }).success
    ).toBe(true);

    expect(
      createProductFactSchema.safeParse({
        fact_key: "tree_age",
        fact_value: "300 年",
        fact_status: "TASTING_CONFIRMED",
        evidence_source_id: "8a1c7d5e-3b1f-4a5c-9f0e-2f4b6d8a0c11"
      }).success
    ).toBe(true);
  });

  it("更新 schema 允许部分字段且不带默认值", () => {
    const parsed = updateProductFactSchema.parse({ fact_value: "布朗山老班章" });
    expect(parsed).toEqual({ fact_value: "布朗山老班章" });
    expect("fact_status" in parsed).toBe(false);
  });

  it("事实键目录与 §10.4 的 20 项感官字段一一对应", () => {
    expect(SENSORY_FIELDS).toHaveLength(20);
    for (const field of SENSORY_FIELDS) {
      expect(findFactKeyDefinition(field.key)).toMatchObject({ group: "SENSORY", label: field.label });
    }
  });

  it("目录外的补充事实键按 OTHER 分组", () => {
    expect(resolveProductFactGroup("mountain")).toBe("BASICS");
    expect(resolveProductFactGroup("custom_storage_note")).toBe("OTHER");
    expect(FACT_KEY_CATALOG.length).toBeGreaterThanOrEqual(30);
  });
});

describe("品饮档案 schema（规格 §10.4）", () => {
  it("允许只填部分感官字段，但拒绝空档案", () => {
    expect(createTastingProfileSchema.safeParse({ taster_name: "评审员A" }).success).toBe(false);
    expect(
      createTastingProfileSchema.safeParse({ dry_leaf_aroma: "烟香明显", huigan: "快" }).success
    ).toBe(true);
    expect(createTastingProfileSchema.safeParse({ conclusion: "结构完整" }).success).toBe(true);
  });

  it("品饮日期接受日期与 ISO 字符串", () => {
    const parsed = createTastingProfileSchema.parse({ entry_taste: "浓强", tasted_at: "2026-03-18" });
    expect(parsed.tasted_at).toBeInstanceOf(Date);
  });
});

describe("研发参考 schema（规格 §35.2 / §25）", () => {
  const base = {
    reference_product_name: "2003 年六星孔雀",
    reference_type: "sensory" as const,
    description: "参考其烟香表现"
  };

  it("未提供状态时按 UNCONFIRMED 存储", () => {
    expect(createRndReferenceSchema.parse(base).verification_status).toBe("UNCONFIRMED");
  });

  it("非 UNCONFIRMED 状态必须带证据", () => {
    expect(
      createRndReferenceSchema.safeParse({ ...base, verification_status: "INTERNAL_CONFIRMED" }).success
    ).toBe(false);
    expect(
      createRndReferenceSchema.safeParse({
        ...base,
        verification_status: "RND_CONFIRMED",
        evidence_note: "研发评审记录 RD-2026-021"
      }).success
    ).toBe(true);
  });

  it("只有 RND_CONFIRMED 允许声明研发 / 对标关系", () => {
    expect(RND_CLAIM_EVIDENCE_STATUS).toBe("RND_CONFIRMED");
    expect(rndReferenceAllowsClaims("RND_CONFIRMED")).toBe(true);
    expect(rndReferenceAllowsClaims("INTERNAL_CONFIRMED")).toBe(false);
    expect(rndReferenceAllowsClaims("UNCONFIRMED")).toBe(false);
  });

  it("无研发证据时能识别 §25 禁止表述", () => {
    expect(findRestrictedRndPhrases("复刻 2003 六星孔雀")).toContain("复刻");
    expect(findRestrictedRndPhrases("与 X 同款配方")).toContain("同款配方");
    expect(findRestrictedRndPhrases("烟香明显、汤感厚")).toEqual([]);

    const blocked = checkRndClaimPermission("复刻 2003 六星孔雀", { hasRndEvidence: false });
    expect(blocked.allowed).toBe(false);
    expect(blocked.blocked_phrases).toContain("复刻");

    const stillBlocked = checkRndClaimPermission("复刻 2003 六星孔雀", { hasRndEvidence: true });
    expect(stillBlocked.allowed).toBe(false);

    expect(checkRndClaimPermission("团队拆解过 X 的香气结构", { hasRndEvidence: true }).allowed).toBe(true);
  });

  it("对外暴露 §25 规则常量，避免前后端口径漂移", () => {
    expect(RND_CLAIM_RULES.evidence_status).toBe("RND_CONFIRMED");
    expect(RND_CLAIM_RULES.restricted_phrases).toEqual(
      expect.arrayContaining(["复刻", "同款配方", "经典秘方"])
    );
    expect(RND_CLAIM_RULES.allowed_phrases).toEqual(expect.arrayContaining(["团队拆解过"]));
  });
});
