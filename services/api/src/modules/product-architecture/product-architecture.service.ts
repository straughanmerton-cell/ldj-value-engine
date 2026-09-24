import { and, asc, count, desc, eq, ilike, max, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Database, NewProductArchitectureRow, ProductArchitectureRow } from "@ldj/database";
import { brands, productArchitectures, products, valueAnchors } from "@ldj/database";
import {
  ANCHOR_REQUIREMENTS,
  PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS,
  PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION,
  PRODUCT_ARCHITECTURE_CONTRACT,
  PRODUCT_ARCHITECTURE_DOWNSTREAM,
  PRODUCT_ARCHITECTURE_LIMITS,
  PRODUCT_ARCHITECTURE_ROLE_COUNT,
  PRODUCT_ARCHITECTURE_ROLE_META,
  PRODUCT_ARCHITECTURE_ROLE_META_BY_KEY,
  buildProductArchitecture,
  productArchitectureCitations,
  productArchitectureGapReason,
  productArchitectureOverviewSchema,
  productArchitectureRecordSchema,
  productArchitectureRoleViewSchema,
  productArchitectureSchema,
  productArchitectureSummary,
  VALUE_DNA_DIMENSIONS,
  valueDnaSchema,
  type ProductArchitectureGenerateInput,
  type ProductArchitectureListQuery,
  type ProductArchitectureMatrixRow,
  type ProductArchitectureOverview,
  type ProductArchitectureProductInput,
  type ProductArchitectureRecordView,
  type ProductArchitectureRoleKey,
  type ProductArchitectureSort,
  type ProductArchitectureUpdateInput,
  type ProductArchitectureVersionSummary,
  type ProductArchitecture as ProductArchitectureValue,
  type ResolvedResearchMode,
  type ValueDna
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import type { AnchorsService } from "../anchors/anchors.service.js";
import { assertProductExists } from "../product-records/product-guard.js";

/**
 * 产品结构服务（规格 §5 Product Architecture Mode / §45 Agent 7 / §57 验收）。
 *
 * 这一层只做四件事：
 * 1. **把角色摆正**：调用 `@ldj/schemas` 的纯函数构建器，把已录入事实分配到九个角色上，
 *    没录就是 GAP 留空 + 缺口清单，绝不补写（§11 / §45 / §62-7）；
 * 2. **守住 §45 的红线**：角色文案只允许引用本产品已录入字段与 Value DNA，
 *    因此「不允许增加任何原料或配方事实」是结构上不可违反，而不是靠自觉；
 * 3. **给下游留接口**：产品结构是配方哲学（Phase 11）与成交话术（Phase 12）的输入，
 *    本模块只交付结构本身，不代写配方与成交文案（§60）；
 * 4. **保住每一版**：重新生成只新增 version，人工确认只改 `is_confirmed`（§62-15）。
 */

/** 产品行 → 纯函数构建器入参：逐一映射事实字段，缺什么就存 null，不做任何推断。 */
function toProductInput(row: ProductRow): ProductArchitectureProductInput {
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

/** §5 角色 → §35.3 列映射：读取既有版本时按同一张表回查。 */
const ROLE_COLUMNS = {
  backbone: productArchitectures.backbone,
  identity: productArchitectures.identity,
  aroma_role: productArchitectures.aromaRole,
  body_role: productArchitectures.bodyRole,
  front_stage_role: productArchitectures.frontStageRole,
  middle_stage_role: productArchitectures.middleStageRole,
  finish_role: productArchitectures.finishRole,
  memory_point: productArchitectures.memoryPoint,
  value_role: productArchitectures.valueRole
} as const satisfies Record<ProductArchitectureRoleKey, AnyPgColumn>;

/**
 * §5 角色对象 → §35.3 九个列。
 *
 * 必须逐列显式映射：Drizzle 的 `insert().values()` 只认列属性名（camelCase），
 * 用对象展开把 `aroma_role` 这类 snake_case 键塞进去会被静默忽略，
 * 结果是「只有 backbone / identity 写进去了」这种极难发现的错位。
 */
function toArchitectureColumns(architecture: ProductArchitectureValue): Pick<
  NewProductArchitectureRow,
  | "backbone"
  | "identity"
  | "aromaRole"
  | "bodyRole"
  | "frontStageRole"
  | "middleStageRole"
  | "finishRole"
  | "memoryPoint"
  | "valueRole"
> {
  return {
    backbone: architecture.backbone,
    identity: architecture.identity,
    aromaRole: architecture.aroma_role,
    bodyRole: architecture.body_role,
    frontStageRole: architecture.front_stage_role,
    middleStageRole: architecture.middle_stage_role,
    finishRole: architecture.finish_role,
    memoryPoint: architecture.memory_point,
    valueRole: architecture.value_role
  };
}

/** 供合同自检接口使用：九个角色、§45 八问与红线只从 schema 层读取。 */
export const PRODUCT_ARCHITECTURE_ENGINE_INFO = {
  spec_ref: "§5 / §45 / §57",
  role_count: PRODUCT_ARCHITECTURE_ROLE_COUNT,
  limits: PRODUCT_ARCHITECTURE_LIMITS,
  acceptance_required_keys: PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS,
  acceptance_question: PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION,
  /** §45：不允许增加任何原料或配方事实 */
  no_new_facts: true,
  /** §62-6：不虚构研发关系 / 配方比例 / 树龄山头年份 / 获奖大师 */
  no_fabricated_relation: true,
  /** §11 / §62-7：事实不足的角色留空并写缺口 */
  gap_stays_empty: true,
  /** §62-5：只引用本产品已录入字段与 Value DNA */
  evidence_only_from_own_product: true,
  /** §5：输出是结构叙事，不是参数罗列 */
  structure_not_parameter_list: true,
  note: "产品结构只解释「已录入的每一部分各自在干什么」：没有录入的部分留空并写缺口，不会替它编出原料与配方（§5 / §45）"
} as const;

export class ProductArchitectureService {
  constructor(
    private readonly db: Database,
    private readonly anchors: AnchorsService
  ) {}

  /* ------------------------------------------------------------- 读取 */

  /**
   * 产品级总览：九角色最新一版 + 版本列表 + §57 验收缺口。
   *
   * 模式（§17）现算并复用锚点引擎口径，只作上下文展示，不参与结构事实。
   */
  async overview(productId: string): Promise<ProductArchitectureOverview> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const rows = await this.loadRows(productId);
    const latest = rows[0] ?? null;
    const dna = this.parseValueDna(product.valueDna);
    const canGenerate = rows.length < PRODUCT_ARCHITECTURE_LIMITS.maxVersionsPerProduct;

    return productArchitectureOverviewSchema.parse({
      product_id: product.id,
      product_name: product.productName,
      preference: mode.preference,
      mode: mode.mode,
      resolved_by: mode.resolved_by,
      mode_reason: mode.reason,
      can_generate: canGenerate,
      block_reason: canGenerate
        ? null
        : `单个产品最多保留 ${PRODUCT_ARCHITECTURE_LIMITS.maxVersionsPerProduct} 版产品结构，请先归档历史版本`,
      record: latest ? this.serialize(latest, product, dna, mode) : null,
      versions: rows.map((row) => this.serializeVersion(row)),
      missing_acceptance_keys: latest
        ? this.missingAcceptanceKeys(latest)
        : [...PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS],
      spec_ref: "§5 / §45"
    });
  }

  /** 版本列表：所有版本必须保留（§62-15），这里只读不写。 */
  async listVersions(productId: string): Promise<ProductArchitectureVersionSummary[]> {
    await assertProductExists(this.db, productId);
    const rows = await this.loadRows(productId);
    return rows.map((row) => this.serializeVersion(row));
  }

  async getRecord(productId: string, recordId: string): Promise<ProductArchitectureRecordView> {
    const row = await this.findRow(productId, recordId);
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    return this.serialize(row, product, this.parseValueDna(product.valueDna), mode);
  }

  /**
   * 「产品结构」跨产品列表（§31 一级导航）：一行 = 一款产品的最新一版结构。
   *
   * 尚未生成结构的产品也会出现（九角色全 GAP），这样「哪些产品还没把结构讲清」一眼可见。
   */
  async listMatrix(
    query: ProductArchitectureListQuery
  ): Promise<Paginated<ProductArchitectureMatrixRow>> {
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
    if (query.role) {
      filters.push(sql`coalesce(${ROLE_COLUMNS[query.role]}, '') <> ''`);
    }
    if (query.missing) {
      filters.push(sql`${productArchitectures.id} is null`);
    }
    if (query.mode) {
      filters.push(modeFilter(query.mode));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;

    const pagination = normalizePagination({
      page: query.page ?? 1,
      pageSize: query.pageSize ?? PRODUCT_ARCHITECTURE_LIMITS.defaultPageSize
    });

    const latest = this.db
      .select({
        productId: productArchitectures.productId,
        // 别名不能叫 `version`：被 join 的 product_architectures 本身也有 version 列，
        // Postgres 会判定 "version" 歧义并直接报 42702。
        latestVersion: max(productArchitectures.version).as("latest_version")
      })
      .from(productArchitectures)
      .groupBy(productArchitectures.productId)
      .as("latest_architecture");

    const base = () =>
      this.db
        .select({
          productId: products.id,
          productName: products.productName,
          year: products.year,
          teaType: products.teaType,
          mountain: products.mountain,
          preference: products.benchmarkModePreference,
          record: productArchitectures
        })
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .leftJoin(latest, eq(latest.productId, products.id))
        .leftJoin(
          productArchitectures,
          and(
            eq(productArchitectures.productId, products.id),
            eq(productArchitectures.version, latest.latestVersion)
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
        productArchitectures,
        and(
          eq(productArchitectures.productId, products.id),
          eq(productArchitectures.version, latest.latestVersion)
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
   * 生成一版产品结构（§5 / §45）。
   *
   * 这一步不是「让 AI 编结构」，而是把当前已录入事实按九个角色摆正：
   * 事实不足时生成的是一份**完整的、可审核的结构**——只是 GAP 更多、缺口清单更长，
   * 且不会有任何原料或配方事实被补出来（§11 / §45 / §62-7）。
   */
  async generate(
    productId: string,
    input: ProductArchitectureGenerateInput,
    actorId: string
  ): Promise<ProductArchitectureRecordView> {
    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    const dna = this.parseValueDna(product.valueDna);

    const draft = buildProductArchitecture({
      product: toProductInput(product),
      value_dna: dna
    });

    const existing = await this.loadRows(productId);
    if (existing.length >= PRODUCT_ARCHITECTURE_LIMITS.maxVersionsPerProduct) {
      throw AppError.validation(
        `单个产品最多保留 ${PRODUCT_ARCHITECTURE_LIMITS.maxVersionsPerProduct} 版产品结构，请先归档历史版本`
      );
    }
    const version = existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.version)) + 1;

    const inserted = await this.db
      .insert(productArchitectures)
      .values({
        productId,
        version,
        ...toArchitectureColumns(draft.architecture),
        narrative: draft.narrative,
        evidenceIds: draft.evidence_refs,
        notes: input.notes ?? null,
        createdBy: actorId
      })
      .returning();

    const row = inserted[0];
    if (!row) {
      throw new AppError("INTERNAL_ERROR", "产品结构写入失败");
    }

    // 产品详情里的 `product_architecture` 只作最新快照，权威版本化来源是本表（§35.3）。
    await this.db
      .update(products)
      .set({ productArchitecture: productArchitectureSchema.parse(draft.architecture) })
      .where(eq(products.id, productId));

    return this.serialize(row, product, dna, mode);
  }

  /** 人工确认或追加备注；确认后版本仍可继续派生新版（§62-15）。 */
  async update(
    productId: string,
    recordId: string,
    input: ProductArchitectureUpdateInput,
    actorId: string
  ): Promise<ProductArchitectureRecordView> {
    const current = await this.findRow(productId, recordId);
    const patch: Partial<typeof productArchitectures.$inferInsert> = { updatedAt: new Date() };
    if (input.notes !== undefined) {
      patch.notes = input.notes;
    }
    if (input.is_confirmed !== undefined) {
      patch.isConfirmed = input.is_confirmed;
      patch.confirmedBy = input.is_confirmed ? actorId : null;
      patch.confirmedAt = input.is_confirmed ? new Date() : null;
    }

    const updated = await this.db
      .update(productArchitectures)
      .set(patch)
      .where(eq(productArchitectures.id, current.id))
      .returning();
    const row = updated[0];
    if (!row) {
      throw AppError.notFound("产品结构不存在");
    }

    const product = await this.loadProduct(productId);
    const mode = await this.anchors.benchmarkMode(productId);
    return this.serialize(row, product, this.parseValueDna(product.valueDna), mode);
  }

  /** 供合同自检接口使用：九个角色、§45 八问与红线只从 schema 层读取。 */
  contractBody(): {
    contract: typeof PRODUCT_ARCHITECTURE_CONTRACT;
    engine: typeof PRODUCT_ARCHITECTURE_ENGINE_INFO;
    downstream: typeof PRODUCT_ARCHITECTURE_DOWNSTREAM;
  } {
    return {
      contract: PRODUCT_ARCHITECTURE_CONTRACT,
      engine: PRODUCT_ARCHITECTURE_ENGINE_INFO,
      downstream: PRODUCT_ARCHITECTURE_DOWNSTREAM
    };
  }

  /** 前端筛选下拉用：九个角色与 §45 八问（口径一律来自 schema 层）。 */
  labelsBody(): {
    roles: typeof PRODUCT_ARCHITECTURE_ROLE_META;
    agent7_questions: typeof PRODUCT_ARCHITECTURE_CONTRACT.agent7_questions;
    acceptance: typeof PRODUCT_ARCHITECTURE_CONTRACT.acceptance;
    limits: typeof PRODUCT_ARCHITECTURE_LIMITS;
    rules: readonly string[];
  } {
    return {
      roles: PRODUCT_ARCHITECTURE_ROLE_META,
      agent7_questions: PRODUCT_ARCHITECTURE_CONTRACT.agent7_questions,
      acceptance: PRODUCT_ARCHITECTURE_CONTRACT.acceptance,
      limits: PRODUCT_ARCHITECTURE_LIMITS,
      rules: PRODUCT_ARCHITECTURE_CONTRACT.rules
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
  private async loadRows(productId: string): Promise<ProductArchitectureRow[]> {
    return this.db
      .select()
      .from(productArchitectures)
      .where(eq(productArchitectures.productId, productId))
      .orderBy(desc(productArchitectures.version));
  }

  private async findRow(productId: string, recordId: string): Promise<ProductArchitectureRow> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(productArchitectures)
      .where(
        and(eq(productArchitectures.id, recordId), eq(productArchitectures.productId, productId))
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品结构不存在");
    }
    return row;
  }

  /**
   * 整表 left join 的坑：Drizzle 在缺行时返回的是「字段全 null 的对象」而不是 null，
   * 必须按主键判空，否则 `row.backbone` 会直接抛 500。
   */
  private asRecord(raw: unknown): ProductArchitectureRow | null {
    const record = raw as ProductArchitectureRow | null;
    return record && record.id ? record : null;
  }

  /**
   * 产品上的 value_dna 只有通过 §9 schema 校验、且至少一维有内容，才允许参与结构：
   * 脏数据不能变成证据；11 维全空的 DNA 也等同于「尚未生成」——
   * 否则会出现「九个角色全 GAP，却因为存了一个空对象而不提示补 Value DNA」的自相矛盾（§9 / §11）。
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

  /** 行 → §5 九角色对象：判定与出参共用同一份取值，避免角色与列错位。 */
  private architectureOf(row: ProductArchitectureRow): ProductArchitectureValue {
    return productArchitectureSchema.parse({
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
  }

  private missingAcceptanceKeys(row: ProductArchitectureRow): ProductArchitectureRoleKey[] {
    return productArchitectureSummary(this.architectureOf(row)).missing_acceptance_keys;
  }

  private sortOrder(sort: ProductArchitectureSort | undefined): SQL[] {
    switch (sort) {
      case "product_name":
        return [asc(products.productName)];
      case "-product_name":
        return [desc(products.productName)];
      case "-written_roles":
        return [sql`${writtenRolesExpr()} desc`, asc(products.productName)];
      case "-gap_roles":
        return [sql`(${PRODUCT_ARCHITECTURE_ROLE_COUNT} - ${writtenRolesExpr()}) desc`, asc(products.productName)];
      case "updated_at":
        return [sql`${productArchitectures.updatedAt} asc nulls last`, asc(products.productName)];
      case "-updated_at":
      default:
        return [sql`${productArchitectures.updatedAt} desc nulls last`, asc(products.productName)];
    }
  }

  private toMatrixRow(
    row: MatrixSourceRow,
    resolvedMode: string | null
  ): ProductArchitectureMatrixRow {
    const record = this.asRecord(row.record);
    const written = record
      ? PRODUCT_ARCHITECTURE_ROLE_META.filter((meta) => roleText(record, meta.key).trim().length > 0)
          .length
      : 0;
    const missing = record ? this.missingAcceptanceKeys(record) : [...PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS];

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
      written_roles: written,
      gap_roles: PRODUCT_ARCHITECTURE_ROLE_COUNT - written,
      missing_acceptance_keys: missing,
      acceptance_passed: record !== null && missing.length === 0,
      narrative: record && record.narrative.trim().length > 0 ? record.narrative : null,
      generated_at: record ? record.createdAt.toISOString() : null,
      spec_ref: "§5 / §45"
    };
  }

  /**
   * 出参统一收口：九个角色在读取时逐条回查已录入事实，
   * 因此「这条角色引用了哪些字段」永远可回查，且不可能引用到未录入内容（§45 / §62-5）。
   */
  private serialize(
    row: ProductArchitectureRow,
    product: ProductRow,
    dna: ValueDna | null,
    mode: { preference: string; mode: string; resolved_by: string; reason: string }
  ): ProductArchitectureRecordView {
    const input = toProductInput(product);
    const writtenKeys: ProductArchitectureRoleKey[] = [];
    const roles = PRODUCT_ARCHITECTURE_ROLE_META.map((meta) => {
      const text = roleText(row, meta.key);
      const written = text.trim().length > 0;
      if (written) {
        writtenKeys.push(meta.key);
      }
      /**
       * 证据与正文同源：先逐字回查本产品已录入事实，再由引用反推字段白名单。
       * value_role 自己不挂字段，但它把各角色的分工串成一句话，证据取本版行里的并集
       * （生成时写入 evidence_ids），因此不会出现「有价值位文案、却没有一条可回查的证据」（§45 / §62-5）。
       */
      const citations = productArchitectureCitations(
        input,
        dna,
        meta,
        text,
        meta.key === "value_role" ? row.evidenceIds : undefined
      );
      return productArchitectureRoleViewSchema.parse({
        key: meta.key,
        label: meta.label,
        short_label: meta.short_label,
        question: meta.question,
        definition: meta.definition,
        requirement: meta.requirement,
        text,
        status: written ? "WRITTEN" : "GAP",
        layer: meta.key === "value_role" ? "RHETORIC" : "INTERPRETATION",
        evidence_refs: [...new Set(citations.map((citation) => citation.slice(0, citation.indexOf("="))))],
        citations,
        gap: written ? null : productArchitectureGapReason(meta, writtenKeys.length),
        acceptance_required: meta.acceptance_required,
        spec_ref: meta.spec_ref
      });
    });

    const missing = PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS.filter(
      (key) => !writtenKeys.includes(key)
    );
    const evidenceRefs = row.evidenceIds;

    return productArchitectureRecordSchema.parse({
      id: row.id,
      product_id: row.productId,
      product_name: product.productName,
      version: row.version,
      preference: mode.preference,
      mode: mode.mode,
      resolved_by: mode.resolved_by,
      mode_reason: mode.reason,
      roles,
      architecture: this.architectureOf(row),
      narrative: row.narrative,
      role_counts: {
        written: writtenKeys.length,
        gap: PRODUCT_ARCHITECTURE_ROLE_COUNT - writtenKeys.length
      },
      acceptance: {
        spec_ref: "§57",
        question: PRODUCT_ARCHITECTURE_ACCEPTANCE_QUESTION,
        required_keys: [...PRODUCT_ARCHITECTURE_ACCEPTANCE_KEYS],
        written_keys: writtenKeys,
        missing_keys: missing,
        passed: missing.length === 0
      },
      evidence_gaps: [
        ...roles
          .filter((role) => role.status === "GAP")
          .map((role) => `${role.short_label}：${role.gap ?? ""}`),
        ...(dna ? [] : ["尚未生成价值 DNA（§9）：香气、滋味与结构信号只能从录入字段直接取，覆盖面会偏窄"])
      ],
      evidence_refs: evidenceRefs,
      fact_refs: evidenceRefs.filter((ref) => ref.startsWith("product.")),
      value_dna_refs: evidenceRefs.filter((ref) => ref.startsWith("dna.")),
      downstream: [...PRODUCT_ARCHITECTURE_DOWNSTREAM],
      is_confirmed: row.isConfirmed,
      confirmed_by: row.confirmedBy,
      confirmed_at: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      notes: row.notes,
      created_by: row.createdBy,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      spec_ref: "§5 / §45"
    });
  }

  private serializeVersion(row: ProductArchitectureRow): ProductArchitectureVersionSummary {
    const written = PRODUCT_ARCHITECTURE_ROLE_META.filter(
      (meta) => roleText(row, meta.key).trim().length > 0
    ).length;
    return {
      id: row.id,
      version: row.version,
      written_roles: written,
      acceptance_passed: this.missingAcceptanceKeys(row).length === 0,
      missing_acceptance_keys: this.missingAcceptanceKeys(row),
      is_confirmed: row.isConfirmed,
      created_at: row.createdAt.toISOString()
    };
  }
}

/** §5 角色 → 行字段：读取时按同一张表取值，避免角色与列错位。 */
function roleText(row: ProductArchitectureRow, key: ProductArchitectureRoleKey): string {
  switch (key) {
    case "backbone":
      return row.backbone;
    case "identity":
      return row.identity;
    case "aroma_role":
      return row.aromaRole;
    case "body_role":
      return row.bodyRole;
    case "front_stage_role":
      return row.frontStageRole;
    case "middle_stage_role":
      return row.middleStageRole;
    case "finish_role":
      return row.finishRole;
    case "memory_point":
      return row.memoryPoint;
    case "value_role":
      return row.valueRole;
  }
}

/**
 * 九个角色里「写实了几个」的 SQL 表达，用于排序与筛选。
 *
 * 整段求和必须自带括号：`9 - a + b + …` 会被 Postgres 解析成 `((9 - a) + b) + …`，
 * 「按缺口数倒序」这种排序会静默失效（冒烟实测：缺口 8 的产品排到了缺口 0 的后面）。
 */
function writtenRolesExpr(): SQL {
  const parts = PRODUCT_ARCHITECTURE_ROLE_META.map(
    (meta) => sql`(coalesce(${ROLE_COLUMNS[meta.key]}, '') <> '')::int`
  );
  return sql`(${sql.join(parts, sql` + `)})`;
}

/**
 * §17 模式筛选：判定口径与 `AnchorsService.resolveMode` **逐条对齐**，不在这里另写一套规则。
 *
 * - 负责人指定 `CATEGORY_CREATOR` 时一定落在自建高端标准模式（人工偏好优先）；
 * - 否则只有当产品存在「Similarity ≥ minSimilarity 且 PriceEvidence ≥ minPriceEvidence」的锚点时才进入对标模式；
 * - 阈值直接引用 `ANCHOR_REQUIREMENTS`（与锚点引擎同一份常量），因此不会出现「列表说对标、详情说自建」。
 *
 * 这里只做检索过滤，不写任何数据，也不参与打分（价格同样不参与相似度，§15）。
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
  record: ProductArchitectureRow | null;
}
