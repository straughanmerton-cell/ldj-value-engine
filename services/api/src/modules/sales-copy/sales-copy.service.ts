import { and, asc, count, desc, eq, ilike, max, or, sql, type SQL } from "drizzle-orm";
import type { CopyOutputRow, Database } from "@ldj/database";
import {
  brands,
  categoryCreatorProfiles,
  copyOutputs,
  formulaPhilosophies,
  productArchitectures,
  productValueCodes,
  products,
  rAndDReferences,
  valueAnchors
} from "@ldj/database";
import {
  ANCHOR_REQUIREMENTS,
  COPY_INTENSITY_META,
  DEFAULT_COPY_INTENSITY,
  DEFAULT_VALUE_FOCUS,
  IMPACT_SCORE_BAND_META_BY_KEY,
  IMPACT_SCORE_META,
  INTENSIFY_BUTTON_LABELS,
  INTENSIFY_BUTTON_META,
  LEVEL5_REQUIREMENT_META,
  MIN3_TIMELINE,
  RND_CLAIM_EVIDENCE_STATUS,
  SALES_COPY_AGENT9_OUTPUTS,
  SALES_COPY_CONTRACT,
  SALES_COPY_DOWNSTREAM,
  SALES_COPY_ENGINE_INFO,
  SALES_COPY_INTENSITY_LABELS,
  SALES_COPY_INTENSITY_TONES,
  SALES_COPY_LIMITS,
  SALES_COPY_MAX_INTENSIFY_ROUNDS,
  SALES_COPY_OUTPUT_META,
  VALUE_DNA_DIMENSIONS,
  VALUE_FOCUS_META,
  buildSalesCopy,
  categoryStandardSchema,
  categoryStyleIdentitySchema,
  copyIntensitySchema,
  formulaPhilosophyAcceptance,
  formulaPhilosophySchema,
  formulaPhilosophySummary,
  intensifyGuardReason,
  intensifySalesCopy,
  intensifyTargetIntensity,
  productArchitectureSchema,
  productArchitectureSummary,
  salesCopyAnchorRefOf,
  salesCopyAnchorRefSchema,
  salesCopyBodyOf,
  salesCopyIntensifyResultSchema,
  salesCopyOutputKeys,
  salesCopyOutputStatuses,
  salesCopyMatrixRowSchema,
  salesCopyOverviewSchema,
  salesCopyRecordSchema,
  salesCopyReviewOf,
  salesCopyUpstreamStatusOf,
  salesCopyVersionSummarySchema,
  valueDnaSchema,
  type BenchmarkModeView,
  type CopyIntensity,
  type ResearchMode,
  type SalesCopyArchitectureInput,
  type SalesCopyBody,
  type SalesCopyBuildInput,
  type SalesCopyCategoryInput,
  type SalesCopyGenerateInput,
  type SalesCopyIntensifyInput,
  type SalesCopyIntensifyResult,
  type SalesCopyListQuery,
  type SalesCopyMatrixRow,
  type SalesCopyOverview,
  type SalesCopyPhilosophyInput,
  type SalesCopyProductInput,
  type SalesCopyRecordView,
  type SalesCopySort,
  type SalesCopyUpdateInput,
  type SalesCopyVersionSummary,
  type ValueCodeKey,
  type ValueCodeStatus,
  type ValueDna,
  type ValueFocusKey
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import type { AnchorsService } from "../anchors/anchors.service.js";
import { assertProductExists } from "../product-records/product-guard.js";

/**
 * 强成交话术服务（规格 §21 / §22 / §23 / §26 / §27 / §33 / §34 / §47 / §57 / §58）。
 *
 * 这一层只做四件事：
 * 1. **把上下文凑齐**：产品已录入事实、Value DNA、§17 锚点结论、产品结构（Phase 10）、
 *    配方哲学（Phase 11）、自建标准（Phase 8）、价值映射（Phase 9）、研发证据（§25）；
 * 2. **交给纯函数总装**：`buildSalesCopy()` 产出十三格骨架 + §26 九种输出 + §23 评分 +
 *    §22 七项 + §24 合规 + §57 验收，服务层不在这里另写任何判定；
 * 3. **落库即冻结**：正文与全部派生结论一起写进 `record`，日后产品事实或锚点变化不会
 *    把已交付的王者稿「改差」——要改就生成下一版（§62-15）；
 * 4. **回看侧与生成侧同源**：读取历史版本时走 `salesCopyReviewOf()` 这一份实现，
 *    绝不会出现「生成时 6 条事实、回看时 4 条」（Phase 11 的教训）。
 */

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
  preference: ResearchMode;
  copyIntensityDefault: number;
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
  preference: products.benchmarkModePreference,
  copyIntensityDefault: products.copyIntensityDefault,
  valueDna: products.valueDna
} as const;

/** 产品行 → 纯函数构建器入参：逐一映射事实字段，缺什么就存 null，不做任何推断。 */
function toProductInput(row: ProductRow): SalesCopyProductInput {
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

/** 生成与回看共用的上下文：一次性把所有输入凑齐，避免两处各自实现一套加载逻辑。 */
interface SalesCopyContext {
  product: ProductRow;
  mode: BenchmarkModeView;
  dna: ValueDna | null;
  architecture: SalesCopyArchitectureInput | null;
  philosophy: SalesCopyPhilosophyInput | null;
  category: SalesCopyCategoryInput | null;
  valueCodes: Partial<Record<ValueCodeKey, ValueCodeStatus>> | null;
  rndConfirmed: boolean;
}

/** 产品录入的默认强度（§10.5 / §21）：脏值一律回落到 Level 4，不猜档位。 */
function defaultIntensityOf(product: ProductRow): CopyIntensity {
  const parsed = copyIntensitySchema.safeParse(product.copyIntensityDefault);
  return parsed.success ? parsed.data : DEFAULT_COPY_INTENSITY;
}

/**
 * §33 模式控件只是**请求**，真正的模式永远由 §17 锚点引擎判定。
 *
 * 请求与判定冲突时直接 400，而不是「按请求写稿」：
 * 没有可靠价格锚点就绝不能把这款茶写成 Benchmark Mode（§62-10）。
 */
function assertModeRequest(requested: ResearchMode | undefined, mode: BenchmarkModeView): void {
  if (!requested || requested === "AUTO") {
    return;
  }
  if (requested === mode.mode) {
    return;
  }
  throw AppError.validation(
    requested === "BENCHMARK"
      ? `没有可靠价格锚点，不能按 Benchmark Mode 生成强成交话术：${mode.reason}`
      : `产品已存在可靠价格锚点，不能按 Category Creator Mode 生成强成交话术：${mode.reason}`,
    { requested_mode: requested, resolved_mode: mode.mode, reason: mode.reason }
  );
}

/** 可靠锚点存在性：口径与 `AnchorsService.resolveMode` 逐条对齐（§16.1 / §17）。 */
function reliableAnchorExpr(): SQL {
  return sql`exists (
    select 1 from ${valueAnchors}
    where ${valueAnchors.productId} = ${products.id}
      and ${valueAnchors.similarityScore} >= ${ANCHOR_REQUIREMENTS.minSimilarity}
      and ${valueAnchors.priceEvidenceScore} >= ${ANCHOR_REQUIREMENTS.minPriceEvidence}
  )`;
}

/** §17 模式筛选：与锚点引擎同口径，只用于检索排产，不参与任何打分。 */
function modeFilter(mode: "BENCHMARK" | "CATEGORY_CREATOR"): SQL {
  const manualCategoryCreator = sql`${products.benchmarkModePreference} = 'CATEGORY_CREATOR'`;
  const reliable = reliableAnchorExpr();
  if (mode === "CATEGORY_CREATOR") {
    return sql`(${manualCategoryCreator} or not ${reliable})`;
  }
  return sql`(not ${manualCategoryCreator} and ${reliable})`;
}

export class SalesCopyService {
  constructor(
    private readonly db: Database,
    private readonly anchors: AnchorsService
  ) {}

  /* ------------------------------------------------------------- 读取 */

  /** 产品级总览：模式 + 最新一版成稿 + 版本列表 + 上游到位情况（§21 / §26 / §27）。 */
  async overview(productId: string): Promise<SalesCopyOverview> {
    const context = await this.loadContext(productId);
    const rows = await this.loadRows(productId);
    const latest = rows[0] ?? null;
    const intensity = defaultIntensityOf(context.product);
    const canGenerate = rows.length < SALES_COPY_LIMITS.maxVersionsPerProduct;

    return salesCopyOverviewSchema.parse({
      product_id: context.product.id,
      product_name: context.product.productName,
      preference: context.product.preference,
      mode: context.mode.mode,
      resolved_by: context.mode.resolved_by,
      mode_reason: context.mode.reason,
      default_intensity: intensity,
      can_generate: canGenerate,
      block_reason: canGenerate
        ? null
        : `单个产品最多保留 ${SALES_COPY_LIMITS.maxVersionsPerProduct} 版强成交话术，请先归档历史版本`,
      record: latest ? this.serialize(latest, context) : null,
      versions: rows.map((row) => this.serializeVersion(row)),
      missing_outputs: latest
        ? latest.record.acceptance.missing_outputs
        : [...salesCopyOutputKeys],
      anchor: salesCopyAnchorRefOf(context.mode),
      upstream: salesCopyUpstreamStatusOf(
        this.toBuildInput(context, context.product.preference, intensity, DEFAULT_VALUE_FOCUS)
      ),
      spec_ref: "§21 / §26 / §27 / §47"
    });
  }

  /** 版本列表：所有版本必须保留（§62-15），这里只读不写。 */
  async listVersions(productId: string): Promise<SalesCopyVersionSummary[]> {
    await assertProductExists(this.db, productId);
    const rows = await this.loadRows(productId);
    return rows.map((row) => this.serializeVersion(row));
  }

  async getRecord(productId: string, recordId: string): Promise<SalesCopyRecordView> {
    const row = await this.findRow(productId, recordId);
    const context = await this.loadContext(productId);
    return this.serialize(row, context);
  }

  /**
   * Phase 14｜事实审核：把一版**已落库的成稿**还原成纯函数入参。
   *
   * 逐句事实审核必须与成稿生成使用**完全同一份语料口径**（产品已录入事实 / Value DNA /
   * 上游成稿引用 / 研发证据），否则同一句话会出现两个结论（Phase 11 的教训）。
   * 因此这里直接复用生成侧的加载与映射逻辑，审核模块不再另写一份。
   *
   * 注意：锚点与「能不能讲价格高度」由调用方从成稿冻结记录里取（`record.anchor` /
   * `record.price_high_story_ready`），本方法只负责事实语料。
   */
  async buildInputForRow(productId: string, row: CopyOutputRow): Promise<SalesCopyBuildInput> {
    const context = await this.loadContext(productId);
    return this.toBuildInput(
      context,
      row.preference,
      copyIntensitySchema.parse(row.intensity),
      row.valueFocus
    );
  }

  /**
   * 「强成交话术库」跨产品列表（§31 一级导航）：一行 = 一款产品的最新一版成稿。
   *
   * 尚未生成的产品也会出现（一行全是 null），这样「哪些产品还没写成主播稿」一眼可见。
   */
  async listMatrix(query: SalesCopyListQuery): Promise<Paginated<SalesCopyMatrixRow>> {
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
    if (query.intensity !== undefined) {
      filters.push(eq(copyOutputs.intensity, query.intensity));
    }
    if (query.level5 === true) {
      filters.push(sql`${copyOutputs.level5Passed} is true`);
    } else if (query.level5 === false) {
      filters.push(sql`coalesce(${copyOutputs.level5Passed}, false) = false`);
    }
    if (query.has_anchor === true) {
      filters.push(reliableAnchorExpr());
    } else if (query.has_anchor === false) {
      filters.push(sql`(not ${reliableAnchorExpr()})`);
    }
    /**
     * §26 排产筛选：`missing=true` 只看还没写成稿的产品。
     * `missing=false` 必须显式反过来（只看已写成稿）——与 level5 / has_anchor 同一套口径，
     * 否则 `?missing=false` 会静默返回全量，运营以为筛过了其实没筛。
     */
    if (query.missing === true) {
      filters.push(sql`${copyOutputs.id} is null`);
    } else if (query.missing === false) {
      filters.push(sql`${copyOutputs.id} is not null`);
    }
    if (query.mode) {
      filters.push(modeFilter(query.mode));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? SALES_COPY_LIMITS.defaultPageSize
    });

    const latest = this.db
      .select({
        productId: copyOutputs.productId,
        // 别名不能叫 `version`：被 join 的 copy_outputs 本身也有 version 列，
        // Postgres 会判定 "version" 歧义并直接报 42702。
        latestVersion: max(copyOutputs.version).as("latest_version")
      })
      .from(copyOutputs)
      .groupBy(copyOutputs.productId)
      .as("latest_copy_output");

    const base = () =>
      this.db
        .select({
          productId: products.id,
          productName: products.productName,
          year: products.year,
          teaType: products.teaType,
          mountain: products.mountain,
          preference: products.benchmarkModePreference,
          record: copyOutputs
        })
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .leftJoin(latest, eq(latest.productId, products.id))
        .leftJoin(
          copyOutputs,
          and(
            eq(copyOutputs.productId, products.id),
            eq(copyOutputs.version, latest.latestVersion)
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
        copyOutputs,
        and(eq(copyOutputs.productId, products.id), eq(copyOutputs.version, latest.latestVersion))
      )
      .where(where);

    /** 未生成的产品的模式只能现算：模式不落库在 products 上，而是由锚点引擎判定的（§17）。 */
    const resolvedModes = new Map<string, BenchmarkModeView>();
    await Promise.all(
      rows
        .filter((row) => this.asRecord(row.record) === null)
        .map(async (row) => {
          resolvedModes.set(row.productId, await this.anchors.benchmarkMode(row.productId));
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
   * 生成一版强成交话术（§21 / §22 / §26 / §47）。
   *
   * 这一步不是「让 AI 编一段狠话」，而是把已录入事实与上游成稿摆成主播能直接念的稿子：
   * 没有可靠价格锚点时逐字改用 §22 标准句，没有 RND_CONFIRMED 时一个字都不暗示研发关系，
   * 事实少于 4 条时机械压分——这些都不是提示词里的「请注意」，而是纯函数里的硬条件。
   */
  async generate(
    productId: string,
    input: SalesCopyGenerateInput,
    actorId: string
  ): Promise<SalesCopyRecordView> {
    const context = await this.loadContext(productId);
    assertModeRequest(input.mode, context.mode);

    const intensity = input.intensity ?? defaultIntensityOf(context.product);
    const valueFocus: ValueFocusKey[] =
      input.value_focus && input.value_focus.length > 0
        ? [...input.value_focus]
        : [...DEFAULT_VALUE_FOCUS];
    const draft = buildSalesCopy(
      this.toBuildInput(context, context.product.preference, intensity, valueFocus)
    );

    const existing = await this.loadRows(productId);
    if (existing.length >= SALES_COPY_LIMITS.maxVersionsPerProduct) {
      throw AppError.validation(
        `单个产品最多保留 ${SALES_COPY_LIMITS.maxVersionsPerProduct} 版强成交话术，请先归档历史版本`
      );
    }
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;

    const inserted = await this.db
      .insert(copyOutputs)
      .values({
        productId,
        version,
        preference: context.product.preference,
        modeAtGeneration: context.mode.mode,
        resolvedBy: context.mode.resolved_by,
        modeReason: context.mode.reason,
        intensity,
        intensifyRounds: draft.intensify_rounds,
        valueFocus,
        record: draft,
        impactScoreTotal: draft.impact_score.total,
        impactScoreBand: draft.impact_score.band,
        level5Passed: draft.level5.satisfied,
        notes: input.notes ?? null,
        createdBy: actorId
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "强成交话术写入失败");
    }
    return this.serialize(row, context);
  }

  /**
   * §7 / §34 / §48「再狠一点」：把某一版按更高档位**重新总装一次**，并落成一个新版本。
   *
   * 三条产品语义写在这里，而不是留给调用方理解：
   * 1. 强化 = 生成新版本，源版本原封不动保留（§62-15）；
   * 2. 只升不降：目标强度取「按钮映射档位」与「源版本强度」的较大者，点更低的档直接 400（§7）；
   * 3. 不增加任何新事实：新版本正文逐字回查出的引用清单里，只要出现源版本没有的一条就拒绝落库（§34）。
   *
   * 达不到 §48 的分数线或八项自检时**不阻断**：结论照实返回 `self_check.passed = false`，
   * 由人工决定继续强化还是改写（最多自动 3 轮，第 3 轮后必须人工处理）。
   */
  async intensify(
    productId: string,
    input: SalesCopyIntensifyInput,
    actorId: string
  ): Promise<SalesCopyIntensifyResult> {
    const context = await this.loadContext(productId);
    const rows = await this.loadRows(productId);
    const source = input.record_id
      ? await this.findRow(productId, input.record_id)
      : rows[0];
    if (!source) {
      throw AppError.validation("这款产品还没有强成交话术版本，请先生成一版再强化（§34）");
    }

    const sourceIntensity = copyIntensitySchema.parse(source.intensity);
    const blockReason = intensifyGuardReason({
      level: input.level,
      source_intensity: sourceIntensity,
      source_intensify_rounds: source.intensifyRounds,
      total_versions: rows.length
    });
    if (blockReason) {
      throw AppError.validation(blockReason, {
        level: input.level,
        source_intensity: sourceIntensity,
        source_intensify_rounds: source.intensifyRounds,
        total_versions: rows.length,
        max_auto_rounds: SALES_COPY_MAX_INTENSIFY_ROUNDS
      });
    }
    /**
     * 源版本的「模式偏好」与今天的锚点结论必须仍然一致，否则这一版是在用今天的锚点
     * 重写一份当初按另一个模式写出来的稿子——宁可让运营重新生成一版，也不静默换口径（§17 / §62-10）。
     */
    if (source.preference !== "AUTO" && source.preference !== context.mode.mode) {
      throw AppError.validation(
        `这一版的模式偏好（${source.preference}）与今天的锚点结论（${context.mode.mode}）已不一致，请重新生成一版再强化：${context.mode.reason}`,
        {
          preference: source.preference,
          resolved_mode: context.mode.mode,
          reason: context.mode.reason
        }
      );
    }

    const targetIntensity = intensifyTargetIntensity(input.level, sourceIntensity);
    const outcome = intensifySalesCopy({
      input: this.toBuildInput(
        context,
        source.preference,
        targetIntensity,
        source.valueFocus
      ),
      source_body: salesCopyBodyOf(source.record),
      level: input.level,
      source_intensity: sourceIntensity,
      source_intensify_rounds: source.intensifyRounds
    });
    if (outcome.added_facts.length > 0) {
      throw AppError.validation(
        `强化后出现了源版本没有的事实引用，已拒绝落库（§34）：${outcome.added_facts.join(" / ")}`,
        { added_facts: outcome.added_facts }
      );
    }

    const version = Math.max(...rows.map((row) => row.version)) + 1;
    const autoNote =
      `「再狠一点」第 ${outcome.round} 轮：由 v${source.version}（Level ${sourceIntensity}）` +
      `强化到「${INTENSIFY_BUTTON_LABELS[input.level]}」（Level ${outcome.intensity}），` +
      `改写 ${outcome.changed_elements.length} 处，未新增任何事实` +
      (outcome.self_check.passed ? "，§48 八项自检通过" : "，§48 八项自检未达标") +
      (outcome.lost_facts.length > 0 ? `；被写弱的引用：${outcome.lost_facts.join(" / ")}` : "");

    const inserted = await this.db
      .insert(copyOutputs)
      .values({
        productId,
        version,
        preference: source.preference,
        modeAtGeneration: context.mode.mode,
        resolvedBy: context.mode.resolved_by,
        modeReason: context.mode.reason,
        intensity: outcome.intensity,
        intensifyRounds: outcome.round,
        valueFocus: source.valueFocus,
        record: outcome.draft,
        impactScoreTotal: outcome.draft.impact_score.total,
        impactScoreBand: outcome.draft.impact_score.band,
        level5Passed: outcome.draft.level5.satisfied,
        notes: input.notes ?? autoNote,
        createdBy: actorId
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "强成交话术强化结果写入失败");
    }
    return salesCopyIntensifyResultSchema.parse({
      level: input.level,
      intensity: outcome.intensity,
      source_intensity: outcome.source_intensity,
      round: outcome.round,
      max_auto_rounds: SALES_COPY_MAX_INTENSIFY_ROUNDS,
      previous: {
        version: source.version,
        intensity: sourceIntensity,
        impact_score: source.record.impact_score.total,
        band: source.record.impact_score.band,
        passed: source.record.impact_score.passed
      },
      changed_elements: outcome.changed_elements,
      added_facts: outcome.added_facts,
      self_check: outcome.self_check,
      record: this.serialize(row, context),
      spec_ref: "§7 / §34 / §48"
    });
  }

  /** 人工确认或追加备注；确认后版本仍可继续派生新版（§62-15）。 */
  async update(
    productId: string,
    recordId: string,
    input: SalesCopyUpdateInput,
    actorId: string
  ): Promise<SalesCopyRecordView> {
    const current = await this.findRow(productId, recordId);
    const patch: Partial<typeof copyOutputs.$inferInsert> = { updatedAt: new Date() };
    if (input.notes !== undefined) {
      patch.notes = input.notes;
    }
    if (input.is_confirmed !== undefined) {
      patch.isConfirmed = input.is_confirmed;
      patch.confirmedBy = input.is_confirmed ? actorId : null;
      patch.confirmedAt = input.is_confirmed ? new Date() : null;
    }

    const updated = await this.db
      .update(copyOutputs)
      .set(patch)
      .where(eq(copyOutputs.id, current.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw AppError.notFound("强成交话术不存在");
    }

    return this.serialize(row, await this.loadContext(productId));
  }

  /** 供合同自检接口使用：五档强度、九种输出、八项评分与红线只从 schema 层读取。 */
  contractBody(): {
    contract: typeof SALES_COPY_CONTRACT;
    engine: typeof SALES_COPY_ENGINE_INFO;
    downstream: typeof SALES_COPY_DOWNSTREAM;
  } {
    return {
      contract: SALES_COPY_CONTRACT,
      engine: SALES_COPY_ENGINE_INFO,
      downstream: SALES_COPY_DOWNSTREAM
    };
  }

  /** 前端筛选用：五档强度、牛逼化按钮、八项评分、Level 5 七项与价值重点八项。 */
  labelsBody(): {
    levels: typeof COPY_INTENSITY_META;
    level_labels: typeof SALES_COPY_INTENSITY_LABELS;
    level_tones: typeof SALES_COPY_INTENSITY_TONES;
    intensify_button: typeof INTENSIFY_BUTTON_META;
    intensify_button_labels: typeof INTENSIFY_BUTTON_LABELS;
    impact_score_items: typeof IMPACT_SCORE_META;
    impact_score_bands: typeof IMPACT_SCORE_BAND_META_BY_KEY;
    level5_requirements: typeof LEVEL5_REQUIREMENT_META;
    outputs: typeof SALES_COPY_OUTPUT_META;
    agent9_outputs: typeof SALES_COPY_AGENT9_OUTPUTS;
    min3_timeline: typeof MIN3_TIMELINE;
    value_focus: typeof VALUE_FOCUS_META;
    limits: typeof SALES_COPY_LIMITS;
    no_anchor_standard_sentence: typeof SALES_COPY_CONTRACT.no_anchor_standard_sentence;
    rules: typeof SALES_COPY_CONTRACT.rules;
  } {
    return {
      levels: COPY_INTENSITY_META,
      level_labels: SALES_COPY_INTENSITY_LABELS,
      level_tones: SALES_COPY_INTENSITY_TONES,
      intensify_button: INTENSIFY_BUTTON_META,
      intensify_button_labels: INTENSIFY_BUTTON_LABELS,
      impact_score_items: IMPACT_SCORE_META,
      impact_score_bands: IMPACT_SCORE_BAND_META_BY_KEY,
      level5_requirements: LEVEL5_REQUIREMENT_META,
      outputs: SALES_COPY_OUTPUT_META,
      agent9_outputs: SALES_COPY_AGENT9_OUTPUTS,
      min3_timeline: MIN3_TIMELINE,
      value_focus: VALUE_FOCUS_META,
      limits: SALES_COPY_LIMITS,
      no_anchor_standard_sentence: SALES_COPY_CONTRACT.no_anchor_standard_sentence,
      rules: SALES_COPY_CONTRACT.rules
    };
  }

  /* ------------------------------------------------------------- 内部实现 */

  /**
   * 生成与回看共用的上下文：一次性把产品事实与全部上游成稿凑齐（§21 / §26 / §60）。
   *
   * 上游成稿（产品结构 / 配方哲学 / 自建标准 / 价值映射）一律「有就用、没有就 null」，
   * 不做任何降级替换：缺上游时正文留缺口清单，而不是用简化版顶上去（§60 / §62-7）。
   */
  private async loadContext(productId: string): Promise<SalesCopyContext> {
    const product = await this.loadProduct(productId);
    const [mode, architecture, philosophy, category, valueCodes, rndConfirmed] =
      await Promise.all([
        this.anchors.benchmarkMode(productId),
        this.loadArchitectureContext(productId),
        this.loadPhilosophyContext(productId),
        this.loadCategoryContext(productId),
        this.loadValueCodes(productId),
        this.hasRndConfirmed(productId)
      ]);
    return {
      product,
      mode,
      dna: this.parseValueDna(product.valueDna),
      architecture,
      philosophy,
      category,
      valueCodes,
      rndConfirmed
    };
  }

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

  /** 版本倒序：最新一版在最前，历史版本全部保留（§62-15）。 */
  private async loadRows(productId: string): Promise<CopyOutputRow[]> {
    return this.db
      .select()
      .from(copyOutputs)
      .where(eq(copyOutputs.productId, productId))
      .orderBy(desc(copyOutputs.version));
  }

  private async findRow(productId: string, recordId: string): Promise<CopyOutputRow> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(copyOutputs)
      .where(and(eq(copyOutputs.id, recordId), eq(copyOutputs.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("强成交话术不存在");
    }
    return row;
  }

  /**
   * 整表 left join 的坑：Drizzle 在缺行时返回的是「字段全 null 的对象」而不是 null，
   * 必须按主键判空，否则 `row.record` 会直接抛 500。
   */
  private asRecord(raw: unknown): CopyOutputRow | null {
    const record = raw as CopyOutputRow | null;
    return record && record.id ? record : null;
  }

  /**
   * 产品上的 value_dna 只有通过 §9 schema 校验、且至少一维有内容，才允许参与成交话术：
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

  /**
   * 取产品最新一版产品结构（§5 / §45）作为成交话术的叙事来源。
   *
   * 结构只提供「结构与记忆点」这一层，**不作本产品的硬事实**：正文逐字引用上游成稿，
   * 不在这里二次改写，也不把结构里的字段当作新证据（§24 / §44 / §62-5）。
   */
  private async loadArchitectureContext(
    productId: string
  ): Promise<SalesCopyArchitectureInput | null> {
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
    const roles = productArchitectureSchema.parse({
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
    const summary = productArchitectureSummary(roles);
    return {
      version: row.version,
      written_roles: summary.written_roles,
      acceptance_passed: summary.acceptance_passed,
      roles,
      narrative: row.narrative,
      gap_role_labels: summary.gap_role_labels
    };
  }

  /**
   * 取产品最新一版配方哲学（§6 / §46）作为成交话术的「设计逻辑 + 成交层解释」来源。
   *
   * 这里同样只读上游成稿正文与验收结果，**不把配比当作本产品的新事实**：
   * 逐字引用 `formula_strategy` / `sales_explanation`，缺比例就留缺口（§6.1 / §60）。
   */
  private async loadPhilosophyContext(
    productId: string
  ): Promise<SalesCopyPhilosophyInput | null> {
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
      sales_explanation: row.salesExplanation,
      gap_component_labels: summary.gap_component_labels
    };
  }

  /**
   * 取产品最新一版自建标准（§4.2 / §8）作为「身份 + 标准」来源。
   *
   * `standard_summary` 优先用六轴的标准表达（缺口语）拼出，而不是用 `summary` 一句带过：
   * 主播稿要的是「这款茶按什么标准立身」，标准表达本身就是最贴近成交层的原文（§4.2）。
   */
  private async loadCategoryContext(productId: string): Promise<SalesCopyCategoryInput | null> {
    const rows = await this.db
      .select()
      .from(categoryCreatorProfiles)
      .where(eq(categoryCreatorProfiles.productId, productId))
      .orderBy(desc(categoryCreatorProfiles.version))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return null;
    }
    const standard = categoryStandardSchema.parse(row.standard);
    const axisTexts = standard.items
      .map((item) => item.statement ?? item.gap)
      .filter((text): text is string => Boolean(text && text.trim().length > 0));
    return {
      style_identity: categoryStyleIdentitySchema.parse(row.styleIdentity),
      standard_summary: axisTexts.length > 0 ? axisTexts.join("；") : standard.summary
    };
  }

  /**
   * 取产品最新一版价值映射（§18 / §19）作为成交话术的价值重点依据。
   *
   * 这里只读「每个 Code 处于什么状态」，不把映射正文塞进主播稿：
   * 成交稿是否需要展开某个 Code，由 §33 价值重点八项决定，而不是由映射替主播做取舍（§33）。
   */
  private async loadValueCodes(
    productId: string
  ): Promise<Partial<Record<ValueCodeKey, ValueCodeStatus>> | null> {
    const rows = await this.db
      .select()
      .from(productValueCodes)
      .where(eq(productValueCodes.productId, productId))
      .orderBy(desc(productValueCodes.version))
      .limit(1);
    const row = rows[0];
    if (!row || !Array.isArray(row.codes) || row.codes.length === 0) {
      return null;
    }
    const mapping: Partial<Record<ValueCodeKey, ValueCodeStatus>> = {};
    for (const item of row.codes) {
      mapping[item.code] = item.status;
    }
    return mapping;
  }

  /**
   * §25：是否存在 `RND_CONFIRMED` 的研发参考。
   *
   * 只有这一种状态允许在正文里出现研发关系暗示；其余状态一律按「没有」处理，
   * 宁可一个字都不提，也不拿未确认的证据去撑成交（§62-8）。
   */
  private async hasRndConfirmed(productId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: rAndDReferences.id })
      .from(rAndDReferences)
      .where(
        and(
          eq(rAndDReferences.productId, productId),
          eq(rAndDReferences.verificationStatus, RND_CLAIM_EVIDENCE_STATUS)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  /** 上下文 + 本次生成参数 → 纯函数构建器入参；只做映射，不在这里补任何默认值。 */
  private toBuildInput(
    context: SalesCopyContext,
    preference: ResearchMode,
    intensity: CopyIntensity,
    valueFocus: readonly ValueFocusKey[]
  ): SalesCopyBuildInput {
    return {
      product: toProductInput(context.product),
      value_dna: context.dna,
      preference,
      mode: context.mode.mode,
      resolved_by: context.mode.resolved_by,
      mode_reason: context.mode.reason,
      intensity,
      value_focus: valueFocus,
      anchor: context.mode,
      architecture: context.architecture,
      philosophy: context.philosophy,
      category: context.category,
      value_codes: context.valueCodes,
      rnd_confirmed: context.rndConfirmed
    };
  }

  /**
   * 出参统一收口：**生成侧与回看侧走同一份判定实现**（`salesCopyReviewOf`）。
   *
   * 锚点结论与「能不能讲价格高度」一律取自**落库时冻结的那一份**（`record.anchor` /
   * `record.price_high_story_ready`），不按今天的锚点重算——否则历史版本会因为
   * 对标价格被下架而「降级」（§23 / §57 / §62-15）。
   */
  private serialize(row: CopyOutputRow, context: SalesCopyContext): SalesCopyRecordView {
    const draft = row.record;
    const body: SalesCopyBody = salesCopyBodyOf(draft);
    const derived = salesCopyReviewOf(
      this.toBuildInput(
        context,
        row.preference,
        copyIntensitySchema.parse(row.intensity),
        row.valueFocus
      ),
      body,
      { anchor: draft.anchor, price_high_story_ready: draft.price_high_story_ready }
    );

    return salesCopyRecordSchema.parse({
      id: row.id,
      product_id: row.productId,
      product_name: context.product.productName,
      version: row.version,
      preference: row.preference,
      mode_at_generation: row.modeAtGeneration,
      resolved_by: row.resolvedBy,
      mode_reason: row.modeReason,
      intensity: copyIntensitySchema.parse(row.intensity),
      intensify_rounds: row.intensifyRounds,
      value_focus: row.valueFocus,
      anchor: derived.anchor,
      upstream: derived.upstream,
      ...body,
      output_statuses: derived.output_statuses,
      impact_score: derived.impact_score,
      level5: derived.level5,
      compliance: derived.compliance,
      acceptance: derived.acceptance,
      evidence_gaps: derived.evidence_gaps,
      fact_refs: derived.fact_refs,
      value_dna_refs: derived.value_dna_refs,
      upstream_refs: derived.upstream_refs,
      is_confirmed: row.isConfirmed,
      confirmed_by: row.confirmedBy,
      confirmed_at: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      notes: row.notes,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      spec_ref: "§21 / §22 / §23 / §26 / §27 / §33 / §47"
    });
  }

  /**
   * 版本摘要一律读**落库时冻结的派生结论**（`record`），不重新判定：
   * 版本列表要回答的是「这一版当时被判定成什么样」，不是「今天再算一遍是多少」（§62-15）。
   */
  private serializeVersion(row: CopyOutputRow): SalesCopyVersionSummary {
    const draft = row.record;
    return salesCopyVersionSummarySchema.parse({
      id: row.id,
      version: row.version,
      intensity: copyIntensitySchema.parse(row.intensity),
      intensify_rounds: row.intensifyRounds,
      impact_score: draft.impact_score.total,
      band: draft.impact_score.band,
      score_passed: draft.impact_score.passed,
      outputs_complete: draft.acceptance.outputs_complete,
      level5_passed: draft.level5.satisfied,
      compliance_passed: draft.compliance.risk !== "RED",
      acceptance_passed: draft.acceptance.passed,
      is_confirmed: row.isConfirmed,
      created_at: row.createdAt.toISOString()
    });
  }

  /** 列表排序：未生成的产品（整行 null）始终沉底，保证「已写成稿」的排产在前。 */
  private sortOrder(sort: SalesCopySort | undefined): SQL[] {
    switch (sort) {
      case "product_name":
        return [asc(products.productName)];
      case "-product_name":
        return [desc(products.productName)];
      case "updated_at":
        return [sql`${copyOutputs.updatedAt} asc nulls last`, asc(products.productName)];
      case "-impact_score":
        return [sql`${copyOutputs.impactScoreTotal} desc nulls last`, asc(products.productName)];
      case "-version":
        return [sql`${copyOutputs.version} desc nulls last`, asc(products.productName)];
      case "-updated_at":
      default:
        return [sql`${copyOutputs.updatedAt} desc nulls last`, asc(products.productName)];
    }
  }

  /**
   * 一行 = 一款产品最新一版强成交话术（§31「强成交话术库」）。
   *
   * 已生成的行一律读**冻结记录**（`mode_at_generation` / `record`），
   * 未生成的行才现算模式——模式本身不落库在 `products` 上，而由锚点引擎判定（§17）。
   */
  private toMatrixRow(
    row: MatrixSourceRow,
    resolvedMode: BenchmarkModeView | null
  ): SalesCopyMatrixRow {
    const record = this.asRecord(row.record);
    const draft = record ? record.record : null;

    return salesCopyMatrixRowSchema.parse({
      product_id: row.productId,
      product_name: row.productName,
      year: row.year,
      tea_type: row.teaType,
      mountain: row.mountain,
      mode: record ? record.modeAtGeneration : resolvedMode?.mode ?? "CATEGORY_CREATOR",
      preference: row.preference,
      has_reliable_price_anchor: draft
        ? draft.anchor.has_reliable_price_anchor
        : salesCopyAnchorRefOf(resolvedMode).has_reliable_price_anchor,
      record_id: record?.id ?? null,
      version: record?.version ?? null,
      intensity: record ? copyIntensitySchema.parse(record.intensity) : null,
      impact_score: draft ? draft.impact_score.total : null,
      band: draft ? draft.impact_score.band : null,
      is_confirmed: record?.isConfirmed ?? false,
      outputs_complete: draft ? draft.acceptance.outputs_complete : false,
      level5_passed: draft ? draft.level5.satisfied : false,
      compliance_passed: draft ? draft.compliance.risk !== "RED" : false,
      acceptance_passed: draft ? draft.acceptance.passed : false,
      missing_outputs: draft ? draft.acceptance.missing_outputs : [...salesCopyOutputKeys],
      one_liner: draft ? draft.headline.one_liner : null,
      generated_at: record ? record.createdAt.toISOString() : null,
      spec_ref: "§21 / §26 / §47"
    });
  }
}

interface MatrixSourceRow {
  productId: string;
  productName: string;
  year: number;
  teaType: string;
  mountain: string | null;
  preference: ResearchMode;
  record: CopyOutputRow | null;
}
