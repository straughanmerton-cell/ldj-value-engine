import { and, asc, count, desc, eq, ilike, max, or, sql, type SQL } from "drizzle-orm";
import type { Database, ProductValueCode } from "@ldj/database";
import {
  brands,
  formulaPhilosophies,
  productArchitectures,
  productValueCodes,
  products,
  valueCodes
} from "@ldj/database";
import {
  TIME_DEPENDENT_FORBIDDEN_EXPRESSION,
  TIME_DEPENDENT_SAFE_EXPRESSION,
  VALUE_CODES_CONTRACT,
  VALUE_CODES_DOWNSTREAM,
  VALUE_CODE_COUNT,
  VALUE_CODE_LIMITS,
  VALUE_CODE_META,
  VALUE_CODE_STATUS_ORDER,
  VALUE_STORY_HANDOFF_PHASES,
  buildValueCodeDraft,
  formulaPhilosophyAcceptance,
  formulaPhilosophySchema,
  formulaPhilosophySummary,
  productArchitectureSummary,
  valueCodeOverviewSchema,
  valueCodeProfileSchema,
  valueDnaSchema,
  type ResolvedResearchMode,
  type ValueCodeAnchorContext,
  type ValueCodeArchitectureInput,
  type ValueCodeGenerateInput,
  type ValueCodeItem,
  type ValueCodeKey,
  type ValueCodeListQuery,
  type ValueCodeMatrixRow,
  type ValueCodeOverview,
  type ValueCodePhilosophyInput,
  type ValueCodeProductInput,
  type ValueCodeProfileView,
  type ValueCodeSort,
  type ValueCodeStatus,
  type ValueCodeUpdateInput,
  type ValueCodeVersionSummary,
  type ValueDna
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import type { AnchorsService } from "../anchors/anchors.service.js";
import { assertProductExists } from "../product-records/product-guard.js";

/**
 * 价值映射服务（规格 §18 Value Codes / §19 状态判定 / §20 六类价值故事 / §30 价值拆解）。
 *
 * 这一层只做四件事：
 * 1. **判定模式**：完全复用 Phase 7 锚点引擎（`AnchorsService.benchmarkMode`），
 *    本模块不重新实现「有没有对标」的阈值（§17）；
 * 2. **把已录入事实映射成 16 个 Code**：调用 `@ldj/schemas` 的纯函数构建器，
 *    没录就是 `UNKNOWN`，明确不成立才是 `NOT_HAVE`，绝不补全（§11 / §19 / §62-7）；
 * 3. **守住两条红线**：对标只提供「高价值产品需要什么底层条件」这一层标准，
 *    本产品事实一律来自自身字段（§44 / §62-5）；`TIME_DEPENDENT` 的成交层表达
 *    只能是 §19 的固定安全句式，不得写成「以后一定会有。」；
 * 4. **保住每一版**：重新生成只新增 version，人工确认只改 `is_confirmed`（§62-15）。
 */

/** 产品行 → 纯函数构建器入参：逐一映射事实字段，缺什么就存 null，不做任何推断。 */
function toProductInput(row: ProductRow): ValueCodeProductInput {
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
    endurance: row.endurance,
    brand_name: row.brandName,
    liquor_aroma: row.liquorAroma,
    viscosity: row.viscosity,
    water_texture: row.waterTexture,
    finish: row.finish,
    harvest_standard: row.harvestStandard,
    fermentation_degree: row.fermentationDegree,
    fermentation_method: row.fermentationMethod,
    storage: row.storage
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
  brandName: string | null;
  liquorAroma: string | null;
  viscosity: string | null;
  waterTexture: string | null;
  finish: string | null;
  harvestStandard: string | null;
  fermentationDegree: string | null;
  fermentationMethod: string | null;
  storage: string | null;
  valueDna: unknown;
}

/** 只取事实字段：品牌名从 brands 表 join，避免把品牌名写死进产品行。 */
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
  brandName: brands.name,
  liquorAroma: products.liquorAroma,
  viscosity: products.viscosity,
  waterTexture: products.waterTexture,
  finish: products.finish,
  harvestStandard: products.harvestStandard,
  fermentationDegree: products.fermentationDegree,
  fermentationMethod: products.fermentationMethod,
  storage: products.storage,
  valueDna: products.valueDna
} as const;

/** 供合同自检接口使用：16 个 Code、5 种状态与 §19 表达规范只从 schema 层读取。 */
export const VALUE_CODES_ENGINE_INFO = {
  spec_ref: "§18 / §19 / §20 / §30",
  code_count: VALUE_CODE_COUNT,
  statuses: VALUE_CODE_STATUS_ORDER,
  limits: VALUE_CODE_LIMITS,
  time_dependent_safe_expression: TIME_DEPENDENT_SAFE_EXPRESSION,
  time_dependent_forbidden_expression: TIME_DEPENDENT_FORBIDDEN_EXPRESSION,
  story_handoff_phases: VALUE_STORY_HANDOFF_PHASES,
  /** §44 / §62-5：竞品事实不得移植到自有产品 */
  no_competitor_fact_transplant: true,
  /** §19：TIME_DEPENDENT 不得承诺未来 */
  time_dependent_not_promise: true,
  /** §11 / §62-7：未录入一律 UNKNOWN */
  unknown_is_written_as_unknown: true,
  /** NOT_HAVE 必须能指到具体已录入事实 */
  not_have_requires_recorded_fact: true,
  /** 证据只引用本产品已录入事实与 Value DNA */
  evidence_only_from_own_product: true,
  note: "价值映射只回答「这款茶靠哪些底层条件贵得起」：没有录入的事实一律 UNKNOWN，不会替它把故事讲圆（§11 / §19）"
} as const;

const ZERO_COUNTS: Record<ValueCodeStatus, number> = {
  ALREADY_HAVE: 0,
  PARTIAL: 0,
  TIME_DEPENDENT: 0,
  NOT_HAVE: 0,
  UNKNOWN: 0
};

export class ValueCodesService {
  constructor(
    private readonly db: Database,
    private readonly anchors: AnchorsService
  ) {}

  /* ------------------------------------------------------------- 读取 */

  /**
   * 产品级总览：模式判定（复用 Phase 7 锚点引擎）+ 最新一版价值映射 + 版本列表。
   *
   * `can_generate` 只表达「现在还能不能生成新版」：价值映射可以反复重算，
   * 但历史版本必须保留（§62-15），因此到上限后要求先归档再生成。
   */
  async overview(productId: string): Promise<ValueCodeOverview> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const rows = await this.loadProfiles(productId);
    const latest = rows[0] ?? null;
    const canGenerate = rows.length < VALUE_CODE_LIMITS.maxProfilesPerProduct;

    return valueCodeOverviewSchema.parse({
      product_id: product.id,
      product_name: product.productName,
      preference: mode.preference,
      mode: mode.mode,
      resolved_by: mode.resolved_by,
      mode_reason: mode.reason,
      can_generate: canGenerate,
      block_reason: canGenerate
        ? null
        : `单个产品最多保留 ${VALUE_CODE_LIMITS.maxProfilesPerProduct} 版价值映射，请先归档历史版本`,
      profile: latest ? this.serialize(latest, product.productName) : null,
      versions: rows.map((row) => this.serializeVersion(row)),
      spec_ref: "§18 / §19 / §20"
    });
  }

  /** 版本列表：所有版本必须保留（§62-15），这里只读不写。 */
  async listVersions(productId: string): Promise<ValueCodeVersionSummary[]> {
    await assertProductExists(this.db, productId);
    const rows = await this.loadProfiles(productId);
    return rows.map((row) => this.serializeVersion(row));
  }

  async getProfile(productId: string, profileId: string): Promise<ValueCodeProfileView> {
    const row = await this.findProfile(productId, profileId);
    const product = await this.loadProduct(productId);
    return this.serialize(row, product.productName);
  }

  /**
   * 价值密码库（§31 一级导航）跨产品总览：一行 = 一款产品的最新一版价值映射。
   *
   * 只做检索与复盘，不改写任何产品事实；尚未生成映射的产品也会出现（计数全 0），
   * 这样「还差哪些产品的价值拆解没做」一眼可见。
   */
  async listOverview(query: ValueCodeListQuery): Promise<Paginated<ValueCodeMatrixRow>> {
    const filters: SQL[] = [];
    if (query.product_id) {
      filters.push(eq(products.id, query.product_id));
    }
    if (query.mode) {
      filters.push(eq(productValueCodes.modeAtGeneration, query.mode));
    }
    if (query.status) {
      filters.push(sql`coalesce((${productValueCodes.codeCounts} ->> ${query.status}), '0')::int > 0`);
    }
    if (query.q) {
      const pattern = `%${query.q}%`;
      const condition = or(ilike(products.productName, pattern), ilike(brands.name, pattern));
      if (condition) {
        filters.push(condition);
      }
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? VALUE_CODE_LIMITS.defaultPageSize
    });

    const latest = this.db
      .select({
        productId: productValueCodes.productId,
        // 别名不能叫 `version`：被 join 的 product_value_codes 本身也有 version 列，
        // Postgres 会判定 "version" 歧义并直接报 42702。
        latestVersion: max(productValueCodes.version).as("latest_version")
      })
      .from(productValueCodes)
      .groupBy(productValueCodes.productId)
      .as("latest_value_codes");

    const rows = await this.db
      .select({
        productId: products.id,
        productName: products.productName,
        year: products.year,
        teaType: products.teaType,
        mountain: products.mountain,
        preference: products.benchmarkModePreference,
        profile: productValueCodes
      })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(latest, eq(latest.productId, products.id))
      .leftJoin(
        productValueCodes,
        and(
          eq(productValueCodes.productId, products.id),
          eq(productValueCodes.version, latest.latestVersion)
        )
      )
      .where(where)
      .orderBy(...this.sortOrder(query.sort))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db
      .select({ value: count() })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(latest, eq(latest.productId, products.id))
      .leftJoin(
        productValueCodes,
        and(
          eq(productValueCodes.productId, products.id),
          eq(productValueCodes.version, latest.latestVersion)
        )
      )
      .where(where);

    return buildPage(
      await this.toMatrixRows(rows),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  /* ------------------------------------------------------------- 写入 */

  /**
   * 生成一版价值映射（§18 / §19 / §20）。
   *
   * 关键点：这一步不是「AI 编故事」，而是把当前已录入事实按 16 个 Code 摆正。
   * 事实不足时生成的仍然是一份**完整的、可审核的映射**——只是 UNKNOWN 更多、
   * 缺口清单更长，且不会有任何成交层表达被补出来（§11 / §62-7）。
   */
  async generate(
    productId: string,
    input: ValueCodeGenerateInput,
    actorId: string
  ): Promise<ValueCodeProfileView> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const dna = this.parseValueDna(product.valueDna);
    const anchorContext = this.buildAnchorContext(mode);
    const architecture = await this.loadArchitectureContext(productId);
    const philosophy = await this.loadFormulaPhilosophyContext(productId);

    const draft = buildValueCodeDraft({
      product: toProductInput(product),
      value_dna: dna,
      mode: mode.mode,
      resolved_by: mode.resolved_by,
      anchor_context: anchorContext,
      product_architecture: architecture,
      formula_philosophy: philosophy
    });

    const existing = await this.loadProfiles(productId);
    if (existing.length >= VALUE_CODE_LIMITS.maxProfilesPerProduct) {
      throw AppError.validation(
        `单个产品最多保留 ${VALUE_CODE_LIMITS.maxProfilesPerProduct} 版价值映射，请先归档历史版本`
      );
    }
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;

    await this.syncDictionary();

    const inserted = await this.db
      .insert(productValueCodes)
      .values({
        productId,
        version,
        preference: mode.preference,
        modeAtGeneration: mode.mode,
        resolvedBy: mode.resolved_by,
        modeReason: mode.reason,
        anchorContext,
        codes: draft.codes,
        codeCounts: draft.code_counts,
        stories: draft.stories,
        evidenceGaps: draft.evidence_gaps,
        factRefs: draft.fact_refs,
        valueDnaRefs: draft.value_dna_refs,
        notes: input.notes ?? null,
        createdBy: actorId
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "价值映射写入失败");
    }
    return this.serialize(row, product.productName);
  }

  /** 人工确认或追加备注；确认后版本仍可继续派生新版（§62-15）。 */
  async update(
    productId: string,
    profileId: string,
    input: ValueCodeUpdateInput,
    actorId: string
  ): Promise<ValueCodeProfileView> {
    const current = await this.findProfile(productId, profileId);
    const patch: Partial<typeof productValueCodes.$inferInsert> = { updatedAt: new Date() };
    if (input.notes !== undefined) {
      patch.notes = input.notes;
    }
    if (input.is_confirmed !== undefined) {
      patch.isConfirmed = input.is_confirmed;
      patch.confirmedBy = input.is_confirmed ? actorId : null;
      patch.confirmedAt = input.is_confirmed ? new Date() : null;
    }

    const updated = await this.db
      .update(productValueCodes)
      .set(patch)
      .where(eq(productValueCodes.id, current.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw AppError.notFound("价值映射不存在");
    }
    const product = await this.loadProduct(productId);
    return this.serialize(row, product.productName);
  }

  /** 供合同自检接口使用：16 个 Code、5 种状态与红线只从 schema 层读取。 */
  contractBody(): {
    contract: typeof VALUE_CODES_CONTRACT;
    engine: typeof VALUE_CODES_ENGINE_INFO;
    downstream: typeof VALUE_CODES_DOWNSTREAM;
  } {
    return {
      contract: VALUE_CODES_CONTRACT,
      engine: VALUE_CODES_ENGINE_INFO,
      downstream: VALUE_CODES_DOWNSTREAM
    };
  }

  /* ------------------------------------------------------------- 内部实现 */

  private async loadProduct(productId: string): Promise<ProductRow> {
    const rows = await this.db
      .select(PRODUCT_COLUMNS)
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(eq(products.id, productId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品不存在");
    }
    return row as ProductRow;
  }

  /** 版本倒序：最新一版在最前，历史版本全部保留。 */
  private async loadProfiles(productId: string): Promise<ProductValueCode[]> {
    return this.db
      .select()
      .from(productValueCodes)
      .where(eq(productValueCodes.productId, productId))
      .orderBy(desc(productValueCodes.version));
  }

  private async findProfile(productId: string, profileId: string): Promise<ProductValueCode> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(productValueCodes)
      .where(and(eq(productValueCodes.id, profileId), eq(productValueCodes.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("价值映射不存在");
    }
    return row;
  }

  /**
   * 整表 left join 的坑：Drizzle 在缺行时返回的是「字段全 null 的对象」而不是 null，
   * 必须按主键判空，否则 `codes.filter` 会直接抛 500。
   */
  private asProfile(raw: unknown): ProductValueCode | null {
    const profile = raw as ProductValueCode | null;
    return profile && profile.id ? profile : null;
  }

  /** 产品上的 value_dna 只有通过 §9 schema 校验才允许参与生成，避免脏数据变成证据。 */
  private parseValueDna(raw: unknown): ValueDna | null {
    if (!raw) {
      return null;
    }
    const parsed = valueDnaSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  /**
   * 取产品最新一版产品结构（§5 / §45）供 `product_architecture_story` 引用。
   *
   * 这里只读正文与验收结果，**不把结构当成价值映射的新事实**：结构本身也只引用本产品已录入字段。
   * 尚未生成结构时返回 null，故事留空写缺口，不用 Code 拼简化版（§60）。
   */
  private async loadArchitectureContext(
    productId: string
  ): Promise<ValueCodeArchitectureInput | null> {
    const rows = await this.db
      .select()
      .from(productArchitectures)
      .where(eq(productArchitectures.productId, productId))
      .orderBy(desc(productArchitectures.version))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const summary = productArchitectureSummary({
      backbone: row.backbone,
      identity: row.identity,
      aroma_role: row.aromaRole,
      body_role: row.bodyRole,
      front_stage_role: row.frontStageRole,
      middle_stage_role: row.middleStageRole,
      finish_role: row.finishRole,
      memory_point: row.memoryPoint,
      value_role: row.valueRole
    });
    return {
      version: row.version,
      written_roles: summary.written_roles,
      acceptance_passed: summary.acceptance_passed,
      narrative: row.narrative,
      gap_role_labels: summary.gap_role_labels
    };
  }

  /**
   * 取产品最新一版配方哲学（§6 / §46）供 `formula_philosophy_story` 引用。
   *
   * 这里只读设计逻辑正文、验收结果与分量覆盖，**不把配方哲学当成价值映射的新事实**：
   * 配方哲学本身也只引用本产品已录入字段。尚未生成时返回 null，故事留空写缺口（§60）。
   */
  private async loadFormulaPhilosophyContext(
    productId: string
  ): Promise<ValueCodePhilosophyInput | null> {
    const rows = await this.db
      .select()
      .from(formulaPhilosophies)
      .where(eq(formulaPhilosophies.productId, productId))
      .orderBy(desc(formulaPhilosophies.version))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const formula = formulaPhilosophySchema.parse({
      formula_strategy: row.formulaStrategy,
      backbone_component: row.backboneComponent,
      aroma_component: row.aromaComponent,
      sweetness_component: row.sweetnessComponent,
      body_component: row.bodyComponent,
      finish_component: row.finishComponent,
      design_goal: row.designGoal,
      known_ratio: row.knownRatio,
      ratio_data: row.ratioData
    });
    const summary = formulaPhilosophySummary(formula);
    return {
      version: row.version,
      written_components: summary.written_components,
      acceptance_passed: formulaPhilosophyAcceptance(formula, [row.salesExplanation]).passed,
      design_logic_ready: summary.design_logic_ready,
      strategy: row.formulaStrategy,
      gap_component_labels: summary.gap_component_labels
    };
  }

  /**
   * 对标上下文（§44）：只记录「参考了哪条锚点」，用于说明高价值产品的底层条件，
   * **不作为本产品的事实**。自建高端标准模式下没有对标，这里就是 null（§4.2）。
   */
  private buildAnchorContext(mode: {
    mode: ResolvedResearchMode;
    primary_anchor: {
      id: string;
      candidate_name?: string | null;
      similarity_score: number;
      price_evidence_score: number;
    } | null;
  }): ValueCodeAnchorContext | null {
    const primary = mode.primary_anchor;
    if (mode.mode !== "BENCHMARK" || !primary) {
      return null;
    }
    return {
      anchor_id: primary.id,
      name: primary.candidate_name ?? null,
      similarity_score: primary.similarity_score,
      price_evidence_score: primary.price_evidence_score,
      usage: "STANDARD_ONLY"
    };
  }

  /**
   * 字典快照同步：`value_codes` 的唯一数据源是 §18 的 `VALUE_CODE_META`，
   * 每次生成时按 code upsert，保证字典表与代码口径永远一致（不做人工改写）。
   */
  private async syncDictionary(): Promise<void> {
    await this.db
      .insert(valueCodes)
      .values(
        VALUE_CODE_META.map((meta) => ({
          code: meta.code,
          label: meta.label,
          definition: meta.definition,
          dimensions: [...meta.dimensions],
          requirement: meta.requirement,
          contribution: meta.contribution,
          evidenceRefs: [...meta.evidence_refs],
          timeDependent: meta.time_dependent,
          specRef: meta.spec_ref
        }))
      )
      .onConflictDoUpdate({
        target: valueCodes.code,
        set: {
          label: sql`excluded.label`,
          definition: sql`excluded.definition`,
          dimensions: sql`excluded.dimensions`,
          requirement: sql`excluded.requirement`,
          contribution: sql`excluded.contribution`,
          evidenceRefs: sql`excluded.evidence_refs`,
          timeDependent: sql`excluded.time_dependent`,
          specRef: sql`excluded.spec_ref`,
          updatedAt: new Date()
        }
      });
  }

  private sortOrder(sort: ValueCodeSort | undefined): SQL[] {
    switch (sort) {
      case "product_name":
        return [asc(products.productName)];
      case "-product_name":
        return [desc(products.productName)];
      case "-unknown_count":
        return [
          sql`coalesce((${productValueCodes.codeCounts} ->> 'UNKNOWN'), '0')::int desc nulls last`,
          asc(products.productName)
        ];
      case "-time_dependent_count":
        return [
          sql`coalesce((${productValueCodes.codeCounts} ->> 'TIME_DEPENDENT'), '0')::int desc nulls last`,
          asc(products.productName)
        ];
      case "updated_at":
        return [sql`${productValueCodes.updatedAt} asc nulls last`, asc(products.productName)];
      case "-updated_at":
      default:
        return [sql`${productValueCodes.updatedAt} desc nulls last`, asc(products.productName)];
    }
  }

  /**
   * 尚无价值映射的产品也要出现在密码库里，方便排产；此时 `mode` 只能现算，
   * 仍复用锚点引擎同一口径（§17），不另写一套阈值。
   */
  private async toMatrixRows(
    rows: readonly MatrixSourceRow[]
  ): Promise<ValueCodeMatrixRow[]> {
    const missing = rows.filter((row) => this.asProfile(row.profile) === null);
    const resolvedModes = new Map<string, ResolvedResearchMode>();
    await Promise.all(
      missing.map(async (row) => {
        const mode = await this.anchors.benchmarkMode(row.productId);
        resolvedModes.set(row.productId, mode.mode);
      })
    );

    return rows.map((row) => this.toMatrixRow(row, resolvedModes.get(row.productId) ?? null));
  }

  private toMatrixRow(
    row: MatrixSourceRow,
    resolvedMode: ResolvedResearchMode | null
  ): ValueCodeMatrixRow {
    const profile = this.asProfile(row.profile);
    const codes: readonly ValueCodeItem[] = profile?.codes ?? [];
    const counts = profile?.codeCounts ?? ZERO_COUNTS;
    const byStatus = (status: ValueCodeStatus): ValueCodeKey[] =>
      codes.filter((item) => item.status === status).map((item) => item.code);

    return {
      product_id: row.productId,
      product_name: row.productName,
      year: row.year,
      tea_type: row.teaType,
      mountain: row.mountain,
      mode: profile?.modeAtGeneration ?? resolvedMode ?? "CATEGORY_CREATOR",
      preference: profile?.preference ?? row.preference,
      profile_id: profile?.id ?? null,
      version: profile?.version ?? null,
      is_confirmed: profile?.isConfirmed ?? false,
      code_counts: counts,
      time_dependent_codes: byStatus("TIME_DEPENDENT"),
      unknown_codes: byStatus("UNKNOWN"),
      already_have_codes: byStatus("ALREADY_HAVE"),
      time_dependent_expression:
        (counts.TIME_DEPENDENT ?? 0) > 0 ? TIME_DEPENDENT_SAFE_EXPRESSION : null,
      generated_at: profile ? profile.createdAt.toISOString() : null,
      spec_ref: "§18 / §19 / §20"
    };
  }

  private serialize(row: ProductValueCode, productName: string | null): ValueCodeProfileView {
    return valueCodeProfileSchema.parse({
      id: row.id,
      product_id: row.productId,
      product_name: productName,
      version: row.version,
      preference: row.preference,
      mode_at_generation: row.modeAtGeneration,
      resolved_by: row.resolvedBy,
      mode_reason: row.modeReason,
      anchor_context: row.anchorContext ?? null,
      codes: row.codes,
      code_counts: row.codeCounts,
      stories: row.stories,
      evidence_gaps: row.evidenceGaps,
      fact_refs: row.factRefs,
      value_dna_refs: row.valueDnaRefs,
      downstream: [...VALUE_CODES_DOWNSTREAM],
      is_confirmed: row.isConfirmed,
      confirmed_by: row.confirmedBy,
      confirmed_at: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      notes: row.notes,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      spec_ref: "§18 / §19 / §20"
    });
  }

  private serializeVersion(row: ProductValueCode): ValueCodeVersionSummary {
    return {
      id: row.id,
      version: row.version,
      mode_at_generation: row.modeAtGeneration,
      resolved_by: row.resolvedBy,
      code_counts: row.codeCounts,
      time_dependent_count: row.codeCounts.TIME_DEPENDENT ?? 0,
      unknown_count: row.codeCounts.UNKNOWN ?? 0,
      is_confirmed: row.isConfirmed,
      created_at: row.createdAt.toISOString()
    };
  }
}

interface MatrixSourceRow {
  productId: string;
  productName: string;
  year: number;
  teaType: string;
  mountain: string | null;
  preference: ValueCodeProfileView["preference"];
  profile: ProductValueCode | null;
}
