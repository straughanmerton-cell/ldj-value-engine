import { and, desc, eq } from "drizzle-orm";
import type { CategoryCreatorProfile, Database } from "@ldj/database";
import { categoryCreatorProfiles, products } from "@ldj/database";
import {
  CATEGORY_CREATOR_CONTRACT,
  CATEGORY_CREATOR_DOWNSTREAM,
  CATEGORY_CREATOR_LIMITS,
  buildCategoryCreatorDraft,
  categoryCreatorOverviewSchema,
  categoryCreatorProfileSchema,
  inferCategoryTrigger,
  valueDnaSchema,
  type CategoryCreatorGenerateInput,
  type CategoryCreatorOverview,
  type CategoryCreatorProfileView,
  type CategoryCreatorTrigger,
  type CategoryCreatorUpdateInput,
  type CategoryCreatorVersionSummary,
  type CategoryStandardProductInput,
  type ValueDna
} from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import type { AnchorsService } from "../anchors/anchors.service.js";
import { assertProductExists } from "../product-records/product-guard.js";

/**
 * 自建高端标准模式服务（规格 §4.2 / §17 / §29 / §24）。
 *
 * 这一层只做三件事：
 * 1. **判定谁该进来**：模式判定完全复用 Phase 7 的锚点引擎（`/benchmark-mode`），
 *    本模块不重新实现阈值，避免出现两套「有没有对标」的结论；
 * 2. **把已录入事实变成自建标准**：调用 `@ldj/schemas` 的纯函数构建器，
 *    事实缺失就输出缺口清单，绝不补全、绝不写弱化版文案（§4.2 / §62-7）；
 * 3. **保住每一版**：重新生成只新增 version，人工确认只改 `is_confirmed`（§62-15）。
 */

/** 产品行 → 纯函数构建器入参：逐一映射 §10 字段，缺什么就存 null，不做任何推断。 */
function toProductInput(row: ProductRow): CategoryStandardProductInput {
  return {
    product_name: row.productName,
    series_name: row.seriesName,
    year: row.year,
    tea_type: row.teaType,
    tea_subtype: row.teaSubtype,
    origin_province: row.originProvince,
    origin_city: row.originCity,
    origin_region: row.originRegion,
    mountain: row.mountain,
    village: row.village,
    raw_material: row.rawMaterial,
    tree_type: row.treeType,
    tree_age: row.treeAge,
    season: row.season,
    grade: row.grade,
    blend_description: row.blendDescription,
    kill_green_method: row.killGreenMethod,
    rolling_method: row.rollingMethod,
    drying_method: row.dryingMethod,
    pressing_method: row.pressingMethod,
    processing_notes: row.processingNotes,
    dry_leaf_aroma: row.dryLeafAroma,
    hot_cup_aroma: row.hotCupAroma,
    entry_taste: row.entryTaste,
    bitterness: row.bitterness,
    astringency: row.astringency,
    sweetness: row.sweetness,
    huigan: row.huigan,
    salivation: row.salivation,
    cha_qi: row.chaQi,
    thickness: row.thickness,
    early_stage: row.earlyStage,
    middle_stage: row.middleStage,
    late_stage: row.lateStage,
    endurance: row.endurance
  };
}

interface ProductRow {
  id: string;
  productName: string;
  seriesName: string | null;
  year: number;
  teaType: string;
  teaSubtype: string | null;
  originProvince: string | null;
  originCity: string | null;
  originRegion: string | null;
  mountain: string | null;
  village: string | null;
  rawMaterial: string | null;
  treeType: string | null;
  treeAge: string | null;
  season: string | null;
  grade: string | null;
  blendDescription: string | null;
  killGreenMethod: string | null;
  rollingMethod: string | null;
  dryingMethod: string | null;
  pressingMethod: string | null;
  processingNotes: string | null;
  dryLeafAroma: string | null;
  hotCupAroma: string | null;
  entryTaste: string | null;
  bitterness: string | null;
  astringency: string | null;
  sweetness: string | null;
  huigan: string | null;
  salivation: string | null;
  chaQi: string | null;
  thickness: string | null;
  earlyStage: string | null;
  middleStage: string | null;
  lateStage: string | null;
  endurance: string | null;
  valueDna: unknown;
}

const PRODUCT_COLUMNS = {
  id: products.id,
  productName: products.productName,
  seriesName: products.seriesName,
  year: products.year,
  teaType: products.teaType,
  teaSubtype: products.teaSubtype,
  originProvince: products.originProvince,
  originCity: products.originCity,
  originRegion: products.originRegion,
  mountain: products.mountain,
  village: products.village,
  rawMaterial: products.rawMaterial,
  treeType: products.treeType,
  treeAge: products.treeAge,
  season: products.season,
  grade: products.grade,
  blendDescription: products.blendDescription,
  killGreenMethod: products.killGreenMethod,
  rollingMethod: products.rollingMethod,
  dryingMethod: products.dryingMethod,
  pressingMethod: products.pressingMethod,
  processingNotes: products.processingNotes,
  dryLeafAroma: products.dryLeafAroma,
  hotCupAroma: products.hotCupAroma,
  entryTaste: products.entryTaste,
  bitterness: products.bitterness,
  astringency: products.astringency,
  sweetness: products.sweetness,
  huigan: products.huigan,
  salivation: products.salivation,
  chaQi: products.chaQi,
  thickness: products.thickness,
  earlyStage: products.earlyStage,
  middleStage: products.middleStage,
  lateStage: products.lateStage,
  endurance: products.endurance,
  valueDna: products.valueDna
} as const;

export const CATEGORY_CREATOR_ENGINE_INFO = {
  spec_ref: "§4.2 / §17 / §29",
  mode: "CATEGORY_CREATOR",
  triggers: CATEGORY_CREATOR_CONTRACT.triggers.map((item) => item.trigger),
  axes: CATEGORY_CREATOR_CONTRACT.axes,
  min_supported_axes: CATEGORY_CREATOR_LIMITS.minSupportedAxes,
  not_weak_copy: true,
  no_fake_benchmark: true,
  unknown_is_written_as_unknown: true,
  note: "没有现成对标 ≠ 没有价值可讲：找不到完全相同的产品，说明这款茶不能拿普通模板去理解（§4.2）"
} as const;

export class CategoryCreatorService {
  constructor(
    private readonly db: Database,
    private readonly anchors: AnchorsService
  ) {}

  /* ------------------------------------------------------------- 读取 */

  /**
   * 产品级总览：模式判定（复用 Phase 7 锚点引擎）+ 最新自建标准 + 版本列表。
   *
   * `can_generate` 只表达「现在还能不能生成新版」：
   * 已进入 Category Creator 的产品随时可以生成；仍在 Benchmark 模式的产品也能生成，
   * 但那代表产品负责人主动选择「不使用对标」（§4.2 的 USER_OPT_OUT）。
   */
  async overview(productId: string): Promise<CategoryCreatorOverview> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const rows = await this.loadProfiles(productId);
    const latest = rows[0] ?? null;

    const suggestedTrigger: CategoryCreatorTrigger = inferCategoryTrigger(mode.resolved_by);

    return categoryCreatorOverviewSchema.parse({
      product_id: product.id,
      product_name: product.productName,
      preference: mode.preference,
      mode: mode.mode,
      resolved_by: mode.resolved_by,
      mode_reason: mode.reason,
      can_generate: true,
      block_reason: null,
      suggested_trigger: suggestedTrigger,
      profile: latest ? this.serialize(latest, product.productName) : null,
      versions: rows.map((row) => this.serializeVersion(row)),
      spec_ref: "§4.2 / §17 / §29"
    });
  }

  /** 版本列表：所有版本必须保留（§62-15），这里只读不写。 */
  async listVersions(productId: string): Promise<CategoryCreatorVersionSummary[]> {
    await assertProductExists(this.db, productId);
    const rows = await this.loadProfiles(productId);
    return rows.map((row) => this.serializeVersion(row));
  }

  async getProfile(productId: string, profileId: string): Promise<CategoryCreatorProfileView> {
    const row = await this.findProfile(productId, profileId);
    const product = await this.loadProduct(productId);
    return this.serialize(row, product.productName);
  }

  /* ------------------------------------------------------------- 写入 */

  /**
   * 生成一版自建标准（§4.2 / §29）。
   *
   * 关键点：生成不是「AI 编一个品类」，而是把当前已录入事实按六个标准轴摆正。
   * 事实不足时生成的仍然是一份**完整的、可审核的标准文档**——只是缺口清单更长、
   * `readiness` 更低、且不含成交表达。这样「没有对标」不会变成「没有内容」。
   */
  async generate(
    productId: string,
    input: CategoryCreatorGenerateInput,
    actorId: string
  ): Promise<CategoryCreatorProfileView> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const trigger = input.trigger ?? inferCategoryTrigger(mode.resolved_by);

    const dna = this.parseValueDna(product.valueDna);
    const draft = buildCategoryCreatorDraft({
      product: toProductInput(product),
      value_dna: dna,
      trigger
    });

    const existing = await this.loadProfiles(productId);
    if (existing.length >= CATEGORY_CREATOR_LIMITS.maxProfilesPerProduct) {
      throw AppError.validation(
        `单个产品最多保留 ${CATEGORY_CREATOR_LIMITS.maxProfilesPerProduct} 版自建标准，请先归档历史版本`
      );
    }
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;

    const inserted = await this.db
      .insert(categoryCreatorProfiles)
      .values({
        productId,
        version,
        trigger,
        modeAtGeneration: mode.mode,
        readiness: draft.readiness,
        supportedAxes: draft.supported_axes,
        totalAxes: draft.total_axes,
        standard: draft.standard,
        styleIdentity: draft.style_identity,
        valueLogic: draft.value_logic,
        evidenceGaps: draft.evidence_gaps,
        factRefs: draft.fact_refs,
        valueDnaRefs: draft.value_dna_refs,
        notes: input.notes ?? null,
        createdBy: actorId
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "自建标准写入失败");
    }
    return this.serialize(row, product.productName);
  }

  /** 人工确认或追加备注；确认后版本仍可继续派生新版（§62-15）。 */
  async update(
    productId: string,
    profileId: string,
    input: CategoryCreatorUpdateInput,
    actorId: string
  ): Promise<CategoryCreatorProfileView> {
    const current = await this.findProfile(productId, profileId);
    const patch: Partial<typeof categoryCreatorProfiles.$inferInsert> = { updatedAt: new Date() };
    if (input.notes !== undefined) {
      patch.notes = input.notes;
    }
    if (input.is_confirmed !== undefined) {
      patch.isConfirmed = input.is_confirmed;
      patch.confirmedBy = input.is_confirmed ? actorId : null;
      patch.confirmedAt = input.is_confirmed ? new Date() : null;
    }

    const updated = await this.db
      .update(categoryCreatorProfiles)
      .set(patch)
      .where(eq(categoryCreatorProfiles.id, current.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw AppError.notFound("自建标准不存在");
    }
    const product = await this.loadProduct(productId);
    return this.serialize(row, product.productName);
  }

  /** 供合同自检接口使用：触发条件、标准轴与红线只从 schema 层读取。 */
  contractBody(): { contract: typeof CATEGORY_CREATOR_CONTRACT; engine: typeof CATEGORY_CREATOR_ENGINE_INFO; downstream: typeof CATEGORY_CREATOR_DOWNSTREAM } {
    return {
      contract: CATEGORY_CREATOR_CONTRACT,
      engine: CATEGORY_CREATOR_ENGINE_INFO,
      downstream: CATEGORY_CREATOR_DOWNSTREAM
    };
  }

  /* ------------------------------------------------------------- 内部实现 */

  private async loadProduct(productId: string): Promise<ProductRow> {
    const rows = await this.db
      .select(PRODUCT_COLUMNS)
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品不存在");
    }
    return row as ProductRow;
  }

  /** 版本倒序：最新一版在最前，历史版本全部保留。 */
  private async loadProfiles(productId: string): Promise<CategoryCreatorProfile[]> {
    return this.db
      .select()
      .from(categoryCreatorProfiles)
      .where(eq(categoryCreatorProfiles.productId, productId))
      .orderBy(desc(categoryCreatorProfiles.version));
  }

  private async findProfile(productId: string, profileId: string): Promise<CategoryCreatorProfile> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(categoryCreatorProfiles)
      .where(and(eq(categoryCreatorProfiles.id, profileId), eq(categoryCreatorProfiles.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("自建标准不存在");
    }
    return row;
  }

  /** 产品上的 value_dna 只有通过 §9 schema 校验才允许参与生成，避免脏数据变成标准。 */
  private parseValueDna(raw: unknown): ValueDna | null {
    if (!raw) {
      return null;
    }
    const parsed = valueDnaSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private serialize(row: CategoryCreatorProfile, productName: string | null): CategoryCreatorProfileView {
    return categoryCreatorProfileSchema.parse({
      id: row.id,
      product_id: row.productId,
      product_name: productName,
      version: row.version,
      trigger: row.trigger,
      mode_at_generation: row.modeAtGeneration,
      readiness: row.readiness,
      supported_axes: row.supportedAxes,
      total_axes: row.totalAxes,
      standard: row.standard,
      style_identity: row.styleIdentity,
      value_logic: row.valueLogic,
      evidence_gaps: row.evidenceGaps,
      fact_refs: row.factRefs,
      value_dna_refs: row.valueDnaRefs,
      downstream: [...CATEGORY_CREATOR_DOWNSTREAM],
      is_confirmed: row.isConfirmed,
      confirmed_by: row.confirmedBy,
      confirmed_at: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      notes: row.notes,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      spec_ref: "§4.2 / §17 / §29"
    });
  }

  private serializeVersion(row: CategoryCreatorProfile): CategoryCreatorVersionSummary {
    return {
      id: row.id,
      version: row.version,
      trigger: row.trigger,
      readiness: row.readiness,
      supported_axes: row.supportedAxes,
      total_axes: row.totalAxes,
      is_confirmed: row.isConfirmed,
      created_at: row.createdAt.toISOString()
    };
  }
}
