import { and, asc, count, desc, eq, ilike, max, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database, FormulaPhilosophyRow, NewFormulaPhilosophyRow } from "@ldj/database";
import {
  brands,
  formulaPhilosophies,
  productArchitectures,
  products,
  valueAnchors
} from "@ldj/database";
import {
  ANCHOR_REQUIREMENTS,
  FORMULA_COMPONENT_COUNT,
  FORMULA_COMPONENT_META,
  FORMULA_PHILOSOPHY_ACCEPTANCE_QUESTION,
  FORMULA_PHILOSOPHY_AGENT8_OUTPUTS,
  FORMULA_PHILOSOPHY_CONTRACT,
  FORMULA_PHILOSOPHY_DOWNSTREAM,
  FORMULA_PHILOSOPHY_LIMITS,
  VALUE_DNA_DIMENSIONS,
  buildFormulaPhilosophy,
  formulaComponentTextsOf,
  formulaPhilosophyAcceptance,
  formulaPhilosophyCitations,
  formulaPhilosophyEvidenceGaps,
  formulaPhilosophyGapReason,
  formulaPhilosophyOverviewSchema,
  formulaPhilosophyRecordSchema,
  formulaPhilosophySummary,
  formulaPhilosophyVersionSummarySchema,
  formulaPhilosophySchema,
  formulaRatioSchema,
  productArchitectureSummary,
  resolveFormulaRatio,
  valueDnaSchema,
  type FormulaComponentKey,
  type FormulaComponentView,
  type FormulaPhilosophyArchitectureRef,
  type FormulaPhilosophyGenerateInput,
  type FormulaPhilosophyListQuery,
  type FormulaPhilosophyMatrixRow,
  type FormulaPhilosophyOverview,
  type FormulaPhilosophyProductInput,
  type FormulaPhilosophyRecordView,
  type FormulaPhilosophySort,
  type FormulaPhilosophyUpdateInput,
  type FormulaPhilosophyVersionSummary,
  type FormulaPhilosophy as FormulaPhilosophyValue,
  type ResolvedResearchMode,
  type ValueDna
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import type { AnchorsService } from "../anchors/anchors.service.js";
import { assertProductExists } from "../product-records/product-guard.js";

/**
 * 配方哲学服务（规格 §6 Formula Philosophy / §46 Agent 8 / §57 验收）。
 *
 * 这一层只做四件事：
 * 1. **把设计逻辑讲清楚**：调用 `@ldj/schemas` 的纯函数构建器，把已录入事实按
 *    骨架 / 香气 / 回甘 / 汤感 / 收口五个分量摆正，写「每一部分各自承担什么任务」，
 *    没录就是 GAP 留空 + 缺口清单（§6.2 / §6.3 / §46）；
 * 2. **守住 §6.1 的比例红线**：没有确切比例时绝对不编比例，正文里也不出现比例字样；
 *    人工登记的比例只有在每个原料都能逐字回查时才接受，否则直接 400（§6.1）；
 * 3. **守住 §46 的原料红线**：分量正文只引用本产品已录入字段与 Value DNA，
 *    因此「没有的原料不会被新增」是结构上不可违反；
 * 4. **保住每一版**：重新生成只新增 version，人工确认只改 `is_confirmed`（§62-15）。
 */

/** 产品行 → 纯函数构建器入参：逐一映射事实字段，缺什么就存 null，不做任何推断。 */
function toProductInput(row: ProductRow): FormulaPhilosophyProductInput {
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

/** §6.3 分量 → §35.4 列映射：读取既有版本时按同一张表回查。 */
const COMPONENT_COLUMNS = {
  backbone: formulaPhilosophies.backboneComponent,
  aroma: formulaPhilosophies.aromaComponent,
  sweetness: formulaPhilosophies.sweetnessComponent,
  body: formulaPhilosophies.bodyComponent,
  finish: formulaPhilosophies.finishComponent
} as const satisfies Record<FormulaComponentKey, AnyPgColumn>;

/** 供合同自检接口使用：五个分量、§46 五项输出与红线只从 schema 层读取。 */
export const FORMULA_PHILOSOPHY_ENGINE_INFO = {
  spec_ref: "§6 / §46 / §57",
  component_count: FORMULA_COMPONENT_COUNT,
  limits: FORMULA_PHILOSOPHY_LIMITS,
  acceptance_question: FORMULA_PHILOSOPHY_ACCEPTANCE_QUESTION,
  agent8_outputs: FORMULA_PHILOSOPHY_AGENT8_OUTPUTS,
  /** §6.1：没有确切比例绝对不创造比例，正文里也不得抄进比例字样 */
  no_fabricated_ratio: true,
  /** §46：没有某个原料绝对不新增原料 */
  no_new_ingredient: true,
  /** §6.2：没有比例时仍然要写出「先定骨架、再定香气、再定回甘」的设计逻辑 */
  design_logic_without_ratio: true,
  /** §11 / §62-7：事实不足的分量留空并写缺口 */
  gap_stays_empty: true,
  /** §62-5：证据只引用本产品已录入字段与 Value DNA */
  evidence_only_from_own_product: true,
  /** §24 / §62-8：允许极强修辞，但它只能描述「各部分承担什么任务」 */
  rhetoric_allowed_for_roles_only: true,
  note: "配方哲学回答「这款茶为什么这么设计」：没有比例时不编比例、没有原料时不新增原料，仍然写出「每一部分各自承担什么任务」的设计逻辑（§6 / §46）"
} as const;

export class FormulaPhilosophyService {
  constructor(
    private readonly db: Database,
    private readonly anchors: AnchorsService
  ) {}

  /* ------------------------------------------------------------- 读取 */

  /** 产品级总览：最新一版分量 + 版本列表 + §57 验收 + 产品结构上下文。 */
  async overview(productId: string): Promise<FormulaPhilosophyOverview> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const rows = await this.loadRows(productId);
    const latest = rows[0] ?? null;
    const dna = this.parseValueDna(product.valueDna);
    const architecture = await this.loadArchitectureContext(productId);
    const canGenerate = rows.length < FORMULA_PHILOSOPHY_LIMITS.maxVersionsPerProduct;

    return formulaPhilosophyOverviewSchema.parse({
      product_id: product.id,
      product_name: product.productName,
      preference: mode.preference,
      mode: mode.mode,
      resolved_by: mode.resolved_by,
      mode_reason: mode.reason,
      can_generate: canGenerate,
      block_reason: canGenerate
        ? null
        : `单个产品最多保留 ${FORMULA_PHILOSOPHY_LIMITS.maxVersionsPerProduct} 版配方哲学，请先归档历史版本`,
      record: latest ? this.serialize(latest, product, dna, mode, architecture) : null,
      versions: rows.map((row) => this.serializeVersion(row)),
      missing_components: latest
        ? formulaPhilosophySummary(this.formulaOf(latest)).gap_component_keys
        : FORMULA_COMPONENT_META.map((meta) => meta.key),
      architecture,
      spec_ref: "§6 / §46"
    });
  }

  /** 版本列表：所有版本必须保留（§62-15），这里只读不写。 */
  async listVersions(productId: string): Promise<FormulaPhilosophyVersionSummary[]> {
    await assertProductExists(this.db, productId);
    const rows = await this.loadRows(productId);
    return rows.map((row) => this.serializeVersion(row));
  }

  async getRecord(productId: string, recordId: string): Promise<FormulaPhilosophyRecordView> {
    const row = await this.findRow(productId, recordId);
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const architecture = await this.loadArchitectureContext(productId);
    return this.serialize(row, product, this.parseValueDna(product.valueDna), mode, architecture);
  }

  /**
   * 「配方哲学」跨产品列表（§31 一级导航）：一行 = 一款产品的最新一版配方哲学。
   *
   * 尚未生成的产品也会出现（五个分量全 GAP），这样「哪些产品还没把设计逻辑讲清」一眼可见。
   */
  async listMatrix(
    query: FormulaPhilosophyListQuery
  ): Promise<Paginated<FormulaPhilosophyMatrixRow>> {
    const filters: SQL[] = [];
    if (query.product_id) {
      filters.push(eq(products.id, query.product_id));
    }
    if (query.q) {
      const pattern = `%${query.q}%`;
      const condition = or(ilike(products.productName, pattern), ilike(brands.name, pattern));
      if (condition) {
        filters.push(condition);
      }
    }
    if (query.component) {
      filters.push(sql`jsonb_array_length(${COMPONENT_COLUMNS[query.component]}) > 0`);
    }
    if (query.known_ratio === true) {
      filters.push(sql`${formulaPhilosophies.knownRatio} is true`);
    } else if (query.known_ratio === false) {
      filters.push(sql`coalesce(${formulaPhilosophies.knownRatio}, false) = false`);
    }
    if (query.missing) {
      filters.push(sql`${formulaPhilosophies.id} is null`);
    }
    if (query.mode) {
      filters.push(modeFilter(query.mode));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? FORMULA_PHILOSOPHY_LIMITS.defaultPageSize
    });

    const latest = this.db
      .select({
        productId: formulaPhilosophies.productId,
        // 别名不能叫 `version`：被 join 的 formula_philosophies 本身也有 version 列，
        // Postgres 会判定 "version" 歧义并直接报 42702。
        latestVersion: max(formulaPhilosophies.version).as("latest_version")
      })
      .from(formulaPhilosophies)
      .groupBy(formulaPhilosophies.productId)
      .as("latest_formula_philosophy");

    const base = () =>
      this.db
        .select({
          productId: products.id,
          productName: products.productName,
          year: products.year,
          teaType: products.teaType,
          mountain: products.mountain,
          preference: products.benchmarkModePreference,
          record: formulaPhilosophies
        })
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .leftJoin(latest, eq(latest.productId, products.id))
        .leftJoin(
          formulaPhilosophies,
          and(
            eq(formulaPhilosophies.productId, products.id),
            eq(formulaPhilosophies.version, latest.latestVersion)
          )
        )
        .where(where);

    const rows = await base()
      .orderBy(...this.sortOrder(query.sort))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db
      .select({ value: count() })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .leftJoin(latest, eq(latest.productId, products.id))
      .leftJoin(
        formulaPhilosophies,
        and(
          eq(formulaPhilosophies.productId, products.id),
          eq(formulaPhilosophies.version, latest.latestVersion)
        )
      )
      .where(where);

    const resolvedModes = new Map<string, string>();
    await Promise.all(
      rows
        .filter((row) => this.asRecord(row.record) === null)
        .map(async (row) => {
          const mode = await this.anchors.benchmarkMode(row.productId);
          resolvedModes.set(row.productId, mode.mode);
        })
    );

    return buildPage(
      rows.map((row) => this.toMatrixRow(row, resolvedModes.get(row.productId) ?? null)),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  /* ------------------------------------------------------------- 写入 */

  /**
   * 生成一版配方哲学（§6 / §46）。
   *
   * 这一步不是「让 AI 编配比」，而是把当前已录入事实按五个分量摆正：
   * 没有比例时生成的是「设计逻辑 + 缺口清单」，而不是一个编出来的配比；
   * 人工登记的比例只有在每个原料都能逐字回查时才接受，否则直接 400（§6.1）。
   */
  async generate(
    productId: string,
    input: FormulaPhilosophyGenerateInput,
    actorId: string
  ): Promise<FormulaPhilosophyRecordView> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const dna = this.parseValueDna(product.valueDna);
    const productInput = toProductInput(product);
    const architecture = await this.loadArchitectureContext(productId);

    const resolution = resolveFormulaRatio(productInput, input.ratio_data ?? null);
    if (resolution.problems.length > 0) {
      throw AppError.validation(resolution.problems.join("；"), { problems: resolution.problems });
    }

    const draft = buildFormulaPhilosophy({
      product: productInput,
      value_dna: dna,
      ratio: resolution.ratio,
      architecture
    });

    const existing = await this.loadRows(productId);
    if (existing.length >= FORMULA_PHILOSOPHY_LIMITS.maxVersionsPerProduct) {
      throw AppError.validation(
        `单个产品最多保留 ${FORMULA_PHILOSOPHY_LIMITS.maxVersionsPerProduct} 版配方哲学，请先归档历史版本`
      );
    }
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;

    const inserted = await this.db
      .insert(formulaPhilosophies)
      .values({
        productId,
        version,
        backboneComponent: draft.formula.backbone_component,
        aromaComponent: draft.formula.aroma_component,
        sweetnessComponent: draft.formula.sweetness_component,
        bodyComponent: draft.formula.body_component,
        finishComponent: draft.formula.finish_component,
        formulaStrategy: draft.formula.formula_strategy,
        designGoal: draft.formula.design_goal,
        salesExplanation: draft.sales_explanation,
        ingredientRoles: draft.ingredient_roles,
        tasteRoles: draft.taste_roles,
        knownRatio: draft.ratio.known_ratio,
        ratioData: draft.ratio.ratio_data,
        ratioEvidence: draft.ratio.ratio_evidence,
        ratioSource: draft.ratio.ratio_source,
        evidenceIds: draft.evidence_refs,
        notes: input.notes ?? null,
        createdBy: actorId
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "配方哲学写入失败");
    }

    // 产品详情里的 `formula_philosophy` 只作最新快照，权威版本化来源是本表（§35.4）。
    await this.db
      .update(products)
      .set({ formulaPhilosophy: formulaPhilosophySchema.parse(draft.formula) })
      .where(eq(products.id, productId));

    return this.serialize(row, product, dna, mode, architecture);
  }

  /** 人工确认或追加备注；确认后版本仍可继续派生新版（§62-15）。 */
  async update(
    productId: string,
    recordId: string,
    input: FormulaPhilosophyUpdateInput,
    actorId: string
  ): Promise<FormulaPhilosophyRecordView> {
    const current = await this.findRow(productId, recordId);
    const patch: Partial<typeof formulaPhilosophies.$inferInsert> = { updatedAt: new Date() };
    if (input.notes !== undefined) {
      patch.notes = input.notes;
    }
    if (input.is_confirmed !== undefined) {
      patch.isConfirmed = input.is_confirmed;
      patch.confirmedBy = input.is_confirmed ? actorId : null;
      patch.confirmedAt = input.is_confirmed ? new Date() : null;
    }

    const updated = await this.db
      .update(formulaPhilosophies)
      .set(patch)
      .where(eq(formulaPhilosophies.id, current.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw AppError.notFound("配方哲学不存在");
    }

    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const architecture = await this.loadArchitectureContext(productId);
    return this.serialize(row, product, this.parseValueDna(product.valueDna), mode, architecture);
  }

  /** 供合同自检接口使用：五个分量、§46 五项输出与红线只从 schema 层读取。 */
  contractBody(): {
    contract: typeof FORMULA_PHILOSOPHY_CONTRACT;
    engine: typeof FORMULA_PHILOSOPHY_ENGINE_INFO;
    downstream: typeof FORMULA_PHILOSOPHY_DOWNSTREAM;
  } {
    return {
      contract: FORMULA_PHILOSOPHY_CONTRACT,
      engine: FORMULA_PHILOSOPHY_ENGINE_INFO,
      downstream: FORMULA_PHILOSOPHY_DOWNSTREAM
    };
  }

  /** 前端筛选用：五个分量与 §46 五项输出（口径一律来自 schema 层）。 */
  labelsBody(): {
    components: typeof FORMULA_PHILOSOPHY_CONTRACT.components;
    agent8_outputs: typeof FORMULA_PHILOSOPHY_AGENT8_OUTPUTS;
    acceptance: typeof FORMULA_PHILOSOPHY_CONTRACT.acceptance;
    limits: typeof FORMULA_PHILOSOPHY_LIMITS;
    rules: readonly string[];
  } {
    return {
      components: FORMULA_PHILOSOPHY_CONTRACT.components,
      agent8_outputs: FORMULA_PHILOSOPHY_AGENT8_OUTPUTS,
      acceptance: FORMULA_PHILOSOPHY_CONTRACT.acceptance,
      limits: FORMULA_PHILOSOPHY_LIMITS,
      rules: FORMULA_PHILOSOPHY_CONTRACT.rules
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
  private async loadRows(productId: string): Promise<FormulaPhilosophyRow[]> {
    return this.db
      .select()
      .from(formulaPhilosophies)
      .where(eq(formulaPhilosophies.productId, productId))
      .orderBy(desc(formulaPhilosophies.version));
  }

  private async findRow(productId: string, recordId: string): Promise<FormulaPhilosophyRow> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(formulaPhilosophies)
      .where(
        and(eq(formulaPhilosophies.id, recordId), eq(formulaPhilosophies.productId, productId))
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("配方哲学不存在");
    }
    return row;
  }

  /**
   * 取产品最新一版产品结构（§5 / §45）作为配方哲学的上下文。
   *
   * 这里只读版本号与验收结果，**不把结构当成配方事实**：结构本身也只引用本产品已录入字段。
   */
  private async loadArchitectureContext(
    productId: string
  ): Promise<FormulaPhilosophyArchitectureRef | null> {
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
      acceptance_passed: summary.acceptance_passed
    };
  }

  /**
   * 整表 left join 的坑：Drizzle 在缺行时返回的是「字段全 null 的对象」而不是 null，
   * 必须按主键判空，否则 `row.formulaStrategy` 会直接抛 500。
   */
  private asRecord(raw: unknown): FormulaPhilosophyRow | null {
    const record = raw as FormulaPhilosophyRow | null;
    return record && record.id ? record : null;
  }

  /**
   * 产品上的 value_dna 只有通过 §9 schema 校验、且至少一维有内容，才允许参与配方哲学：
   * 脏数据不能变成证据；11 维全空的 DNA 也等同于「尚未生成」（§9 / §11）。
   */
  private parseValueDna(raw: unknown): ValueDna | null {
    if (!raw) {
      return null;
    }
    const parsed = valueDnaSchema.safeParse(raw);
    if (!parsed.success) {
      return null;
    }
    const hasContent = VALUE_DNA_DIMENSIONS.some(
      (dimension) => (parsed.data[dimension]?.length ?? 0) > 0
    );
    return hasContent ? parsed.data : null;
  }

  /** 行 → §6.3 扁平快照（FormulaPhilosophy）：判定与出参共用同一份取值。 */
  private formulaOf(row: FormulaPhilosophyRow): FormulaPhilosophyValue {
    return formulaPhilosophySchema.parse({
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
  }

  /** 行 → §6.1 比例口径（读取既有版本时用，与生成侧同一 schema 守住红线）。 */
  private ratioOf(row: FormulaPhilosophyRow) {
    return formulaRatioSchema.parse({
      known_ratio: row.knownRatio,
      ratio_data: row.knownRatio ? row.ratioData : null,
      ratio_evidence: row.knownRatio ? row.ratioEvidence : [],
      ratio_source: row.knownRatio ? row.ratioSource : null,
      spec_ref: "§6.1"
    });
  }

  private sortOrder(sort: FormulaPhilosophySort | undefined): SQL[] {
    switch (sort) {
      case "product_name":
        return [asc(products.productName)];
      case "-product_name":
        return [desc(products.productName)];
      case "-written_components":
        return [sql`${writtenComponentsExpr()} desc`, asc(products.productName)];
      case "-gap_components":
        return [
          sql`(${FORMULA_COMPONENT_COUNT} - ${writtenComponentsExpr()}) desc`,
          asc(products.productName)
        ];
      case "updated_at":
        return [sql`${formulaPhilosophies.updatedAt} asc nulls last`, asc(products.productName)];
      case "-updated_at":
      default:
        return [sql`${formulaPhilosophies.updatedAt} desc nulls last`, asc(products.productName)];
    }
  }

  private toMatrixRow(
    row: MatrixSourceRow,
    resolvedMode: string | null
  ): FormulaPhilosophyMatrixRow {
    const record = this.asRecord(row.record);
    const summary = record ? formulaPhilosophySummary(this.formulaOf(record)) : null;

    return {
      product_id: row.productId,
      product_name: row.productName,
      year: row.year,
      tea_type: row.teaType,
      mountain: row.mountain,
      mode: resolvedMode ?? "CATEGORY_CREATOR",
      preference: row.preference,
      record_id: record?.id ?? null,
      version: record?.version ?? null,
      is_confirmed: record?.isConfirmed ?? false,
      written_components: summary?.written_components ?? 0,
      gap_components: summary ? FORMULA_COMPONENT_COUNT - summary.written_components : FORMULA_COMPONENT_COUNT,
      texts_total: summary?.texts_total ?? 0,
      known_ratio: summary?.known_ratio ?? false,
      design_logic_ready: summary?.design_logic_ready ?? false,
      acceptance_passed: record
        ? formulaPhilosophyAcceptance(this.formulaOf(record), [record.salesExplanation]).passed
        : false,
      formula_strategy: record && record.formulaStrategy.trim().length > 0 ? record.formulaStrategy : null,
      generated_at: record ? record.createdAt.toISOString() : null,
      spec_ref: "§6 / §46"
    };
  }

  /**
   * 出参统一收口：五个分量在读取时逐条回查本产品已录入事实，
   * 因此「这条分量引用了哪些字段」永远可回查，且不可能引用到未录入内容（§6.1 / §46）。
   */
  private serialize(
    row: FormulaPhilosophyRow,
    product: ProductRow,
    dna: ValueDna | null,
    mode: { preference: string; mode: string; resolved_by: string; reason: string },
    architecture: FormulaPhilosophyArchitectureRef | null
  ): FormulaPhilosophyRecordView {
    const input = toProductInput(product);
    const formula = this.formulaOf(row);
    const knownRatio = row.knownRatio;

    const components: FormulaComponentView[] = FORMULA_COMPONENT_META.map((meta) => {
      const texts = formulaComponentTextsOf(formula, meta.key);
      const written = texts.length > 0;
      /**
       * 证据与正文同源：先逐字回查本产品已录入事实。
       * 读取侧默认 `known_ratio=false` 更保守——除非这一版明确确认过比例，
       * 否则带比例字样的事实（含 DNA）一律不算引用，避免「回查把比例捡回来」（§6.1）。
       */
      const citations = formulaPhilosophyCitations(input, dna, meta, texts, {
        known_ratio: knownRatio
      });
      return {
        key: meta.key,
        label: meta.label,
        short_label: meta.short_label,
        storage_field: meta.storage_field,
        definition: meta.definition,
        requirement: meta.requirement,
        agent8_output: meta.agent8_output,
        texts,
        status: written ? "WRITTEN" : "GAP",
        layer: "INTERPRETATION",
        evidence_refs: [...new Set(citations.map((citation) => citation.slice(0, citation.indexOf("="))))],
        citations,
        gap: written ? null : formulaPhilosophyGapReason(meta),
        spec_ref: meta.spec_ref
      };
    });

    const summary = formulaPhilosophySummary(formula);
    const acceptance = formulaPhilosophyAcceptance(formula, [row.salesExplanation]);
    const evidenceRefs = row.evidenceIds;

    return formulaPhilosophyRecordSchema.parse({
      id: row.id,
      product_id: row.productId,
      product_name: product.productName,
      version: row.version,
      preference: mode.preference,
      mode: mode.mode,
      resolved_by: mode.resolved_by,
      mode_reason: mode.reason,
      components,
      formula,
      formula_strategy: row.formulaStrategy,
      ingredient_roles: row.ingredientRoles,
      taste_roles: row.tasteRoles,
      design_goal: row.designGoal,
      sales_explanation: row.salesExplanation,
      ratio: this.ratioOf(row),
      component_counts: {
        written: summary.written_components,
        gap: FORMULA_COMPONENT_COUNT - summary.written_components
      },
      acceptance,
      design_logic_ready: summary.design_logic_ready,
      architecture_version: architecture?.version ?? null,
      architecture_acceptance_passed: architecture?.acceptance_passed ?? null,
      evidence_gaps: formulaPhilosophyEvidenceGaps({ formula, product: input, dna, architecture }),
      evidence_refs: evidenceRefs,
      fact_refs: evidenceRefs.filter((ref) => ref.startsWith("product.")),
      value_dna_refs: evidenceRefs.filter((ref) => ref.startsWith("dna.")),
      downstream: [...FORMULA_PHILOSOPHY_DOWNSTREAM],
      is_confirmed: row.isConfirmed,
      confirmed_by: row.confirmedBy,
      confirmed_at: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      notes: row.notes,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      spec_ref: "§6 / §46"
    });
  }

  private serializeVersion(row: FormulaPhilosophyRow): FormulaPhilosophyVersionSummary {
    const formula = this.formulaOf(row);
    const summary = formulaPhilosophySummary(formula);
    return formulaPhilosophyVersionSummarySchema.parse({
      id: row.id,
      version: row.version,
      written_components: summary.written_components,
      texts_total: summary.texts_total,
      known_ratio: summary.known_ratio,
      design_logic_ready: summary.design_logic_ready,
      acceptance_passed: formulaPhilosophyAcceptance(formula, [row.salesExplanation]).passed,
      is_confirmed: row.isConfirmed,
      created_at: row.createdAt.toISOString()
    });
  }
}

/**
 * 五个分量里「写实了几个」的 SQL 表达，用于排序与筛选。
 *
 * 整段求和必须自带括号：`5 - a + b + …` 会被 Postgres 解析成 `((5 - a) + b) + …`，
 * 「按缺口数倒序」这种排序会静默失效（§6.3）。
 */
function writtenComponentsExpr(): SQL {
  const parts = FORMULA_COMPONENT_META.map(
    (meta) => sql`(jsonb_array_length(${COMPONENT_COLUMNS[meta.key]}) > 0)::int`
  );
  return sql`(${sql.join(parts, sql` + `)})`;
}

/**
 * §17 模式筛选：判定口径与 `AnchorsService.resolveMode` **逐条对齐**，不在这里另写一套规则。
 */
function modeFilter(mode: ResolvedResearchMode): SQL {
  const manualCategoryCreator = sql`${products.benchmarkModePreference} = 'CATEGORY_CREATOR'`;
  const reliableAnchor = sql`exists (
    select 1 from ${valueAnchors}
    where ${valueAnchors.productId} = ${products.id}
      and ${valueAnchors.similarityScore} >= ${ANCHOR_REQUIREMENTS.minSimilarity}
      and ${valueAnchors.priceEvidenceScore} >= ${ANCHOR_REQUIREMENTS.minPriceEvidence}
  )`;
  if (mode === "CATEGORY_CREATOR") {
    return sql`(${manualCategoryCreator} or not ${reliableAnchor})`;
  }
  return sql`(not ${manualCategoryCreator} and ${reliableAnchor})`;
}

interface MatrixSourceRow {
  productId: string;
  productName: string;
  year: number;
  teaType: string;
  mountain: string | null;
  preference: string;
  record: FormulaPhilosophyRow | null;
}
