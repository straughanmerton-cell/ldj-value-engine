import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { Database, NewProduct, Product } from "@ldj/database";
import { brands, products } from "@ldj/database";
import type {
  CreateProductInput,
  ProductListQuery,
  UpdateProductInput,
  UserRole
} from "@ldj/schemas";
import { buildValueDnaFromProduct } from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { serializeProduct, type ProductApiShape } from "../../lib/serialize.js";
import { buildValueDnaMeta, productSnapshot, saveValueDna } from "../../lib/value-dna.js";

export class ProductService {
  constructor(private readonly db: Database) {}

  async list(query: ProductListQuery, role: UserRole): Promise<Paginated<ProductApiShape>> {
    const pagination = normalizePagination({ page: query.page, pageSize: query.pageSize });
    const filters: SQL[] = [];

    if (query.q) {
      const pattern = `%${query.q}%`;
      const searchCondition = or(
        ilike(products.productName, pattern),
        ilike(products.seriesName, pattern),
        ilike(products.mountain, pattern)
      );
      if (searchCondition) {
        filters.push(searchCondition);
      }
    }
    if (query.tea_type) {
      filters.push(eq(products.teaType, query.tea_type));
    }
    if (query.mountain) {
      filters.push(ilike(products.mountain, `%${query.mountain}%`));
    }
    if (query.brand_id) {
      filters.push(eq(products.brandId, query.brand_id));
    }
    if (query.benchmark_mode_preference) {
      filters.push(eq(products.benchmarkModePreference, query.benchmark_mode_preference));
    }

    const where = filters.length > 0 ? and(...filters) : undefined;
    const orderBy = resolveOrderBy(query.sort);

    const rows = await this.db
      .select()
      .from(products)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db.select({ value: count() }).from(products).where(where);
    const total = Number(totalRows[0]?.value ?? 0);

    return buildPage(
      rows.map((row) => serializeProduct(row, role)),
      total,
      pagination
    );
  }

  async getById(id: string, role: UserRole): Promise<ProductApiShape> {
    const row = await this.findRow(id);
    return serializeProduct(row, role);
  }

  async create(input: CreateProductInput, actorId: string, role: UserRole): Promise<ProductApiShape> {
    if (input.brand_id) {
      await this.assertBrandExists(input.brand_id);
    }
    const values = toInsertValues(input, actorId);
    const inserted = await this.db.insert(products).values(values).returning();
    const row = inserted[0]!;
    // 规格 §9：产品创建后自动生成 Value DNA（只跑规则引擎，不联网、不调模型）。
    await generateInitialValueDna(this.db, row);
    return serializeProduct(row, role);
  }

  async update(id: string, input: UpdateProductInput, role: UserRole): Promise<ProductApiShape> {
    const existing = await this.findRow(id);
    if (input.brand_id) {
      await this.assertBrandExists(input.brand_id);
    }
    const patch = toUpdateValues(input);
    if (Object.keys(patch).length === 0) {
      return serializeProduct(existing, role);
    }
    const updated = await this.db
      .update(products)
      .set({ ...patch, updatedAt: new Date(), version: existing.version + 1 })
      .where(eq(products.id, id))
      .returning();
    return serializeProduct(updated[0]!, role);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db.delete(products).where(eq(products.id, id)).returning({ id: products.id });
    if (deleted.length === 0) {
      throw AppError.notFound("产品不存在");
    }
  }

  private async findRow(id: string): Promise<Product> {
    const rows = await this.db.select().from(products).where(eq(products.id, id)).limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品不存在");
    }
    return row;
  }

  private async assertBrandExists(brandId: string): Promise<void> {
    const rows = await this.db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1);
    if (rows.length === 0) {
      throw AppError.validation("brand_id 不存在");
    }
  }
}

function resolveOrderBy(sort: ProductListQuery["sort"]) {
  switch (sort) {
    case "product_name":
      return asc(products.productName);
    case "-product_name":
      return desc(products.productName);
    case "year":
      return asc(products.year);
    case "-year":
      return desc(products.year);
    case "created_at":
      return asc(products.createdAt);
    default:
      return desc(products.createdAt);
  }
}

/**
 * 规格 §9：产品创建后自动生成 Value DNA。
 * 此处只跑规则引擎（不联网、不调模型），此时事实 / 品饮 / 研发参考均为空，
 * 因此 11 个维度里凡是需要外部事实的都会进入 missing_dimensions，等待后续录入。
 */
async function generateInitialValueDna(db: Database, row: Product): Promise<void> {
  const result = buildValueDnaFromProduct({ product: productSnapshot(row) });
  const meta = buildValueDnaMeta(
    result,
    { product_version: row.version, fact_count: 0, tasting_count: 0, rnd_count: 0 },
    { generator: "RULE_BASED", version: 1 }
  );
  await saveValueDna(db, row.id, result.dna, meta);
}

function toInsertValues(input: CreateProductInput, actorId: string): NewProduct {
  return {
    brandId: input.brand_id ?? null,
    productName: input.product_name,
    seriesName: input.series_name ?? null,
    year: input.year,
    teaType: input.tea_type,
    teaSubtype: input.tea_subtype ?? null,
    originProvince: input.origin_province ?? null,
    originCity: input.origin_city ?? null,
    originRegion: input.origin_region ?? null,
    mountain: input.mountain ?? null,
    village: input.village ?? null,
    weightG: String(input.weight_g),
    piecesPerBox: input.pieces_per_box ?? null,
    boxesPerCase: input.boxes_per_case ?? null,
    suggestedRetailPrice:
      input.suggested_retail_price === undefined ? null : String(input.suggested_retail_price),
    internalCost: input.internal_cost === undefined ? null : String(input.internal_cost),
    rawMaterial: input.raw_material ?? null,
    treeType: input.tree_type ?? null,
    treeAge: input.tree_age ?? null,
    season: input.season ?? null,
    harvestStandard: input.harvest_standard ?? null,
    grade: input.grade ?? null,
    blendDescription: input.blend_description ?? null,
    materialNotes: input.material_notes ?? null,
    killGreenMethod: input.kill_green_method ?? null,
    rollingMethod: input.rolling_method ?? null,
    dryingMethod: input.drying_method ?? null,
    pressingMethod: input.pressing_method ?? null,
    fermentationDegree: input.fermentation_degree ?? null,
    fermentationMethod: input.fermentation_method ?? null,
    storage: input.storage ?? null,
    processingNotes: input.processing_notes ?? null,
    dryLeafAroma: input.dry_leaf_aroma ?? null,
    hotCupAroma: input.hot_cup_aroma ?? null,
    liquorAroma: input.liquor_aroma ?? null,
    coldCupAroma: input.cold_cup_aroma ?? null,
    entryTaste: input.entry_taste ?? null,
    bitterness: input.bitterness ?? null,
    astringency: input.astringency ?? null,
    sweetness: input.sweetness ?? null,
    huigan: input.huigan ?? null,
    salivation: input.salivation ?? null,
    chaQi: input.cha_qi ?? null,
    thickness: input.thickness ?? null,
    viscosity: input.viscosity ?? null,
    waterTexture: input.water_texture ?? null,
    earlyStage: input.early_stage ?? null,
    middleStage: input.middle_stage ?? null,
    lateStage: input.late_stage ?? null,
    finish: input.finish ?? null,
    endurance: input.endurance ?? null,
    leafBottom: input.leaf_bottom ?? null,
    benchmarkModePreference: input.benchmark_mode_preference ?? "AUTO",
    copyIntensityDefault: input.copy_intensity_default ?? 4,
    rAndDReferenceEnabled: input.r_and_d_reference_enabled ?? false,
    rAndDReferenceNotes: input.r_and_d_reference_notes ?? null,
    hasExplicitBenchmark: input.has_explicit_benchmark ?? null,
    hasRndReference: input.has_rnd_reference ?? null,
    rndEvidenceAvailable: input.rnd_evidence_available ?? null,
    productArchitecture: input.product_architecture ?? null,
    formulaPhilosophy: input.formula_philosophy ?? null,
    createdBy: actorId
  };
}

function toUpdateValues(input: UpdateProductInput): Partial<NewProduct> {
  const patch: Record<string, unknown> = {};
  const direct: Record<string, keyof UpdateProductInput> = {
    brandId: "brand_id",
    productName: "product_name",
    seriesName: "series_name",
    year: "year",
    teaType: "tea_type",
    teaSubtype: "tea_subtype",
    originProvince: "origin_province",
    originCity: "origin_city",
    originRegion: "origin_region",
    mountain: "mountain",
    village: "village",
    piecesPerBox: "pieces_per_box",
    boxesPerCase: "boxes_per_case",
    rawMaterial: "raw_material",
    treeType: "tree_type",
    treeAge: "tree_age",
    season: "season",
    harvestStandard: "harvest_standard",
    grade: "grade",
    blendDescription: "blend_description",
    materialNotes: "material_notes",
    killGreenMethod: "kill_green_method",
    rollingMethod: "rolling_method",
    dryingMethod: "drying_method",
    pressingMethod: "pressing_method",
    fermentationDegree: "fermentation_degree",
    fermentationMethod: "fermentation_method",
    storage: "storage",
    processingNotes: "processing_notes",
    dryLeafAroma: "dry_leaf_aroma",
    hotCupAroma: "hot_cup_aroma",
    liquorAroma: "liquor_aroma",
    coldCupAroma: "cold_cup_aroma",
    entryTaste: "entry_taste",
    bitterness: "bitterness",
    astringency: "astringency",
    sweetness: "sweetness",
    huigan: "huigan",
    salivation: "salivation",
    chaQi: "cha_qi",
    thickness: "thickness",
    viscosity: "viscosity",
    waterTexture: "water_texture",
    earlyStage: "early_stage",
    middleStage: "middle_stage",
    lateStage: "late_stage",
    finish: "finish",
    endurance: "endurance",
    leafBottom: "leaf_bottom",
    benchmarkModePreference: "benchmark_mode_preference",
    copyIntensityDefault: "copy_intensity_default",
    rAndDReferenceEnabled: "r_and_d_reference_enabled",
    rAndDReferenceNotes: "r_and_d_reference_notes",
    hasExplicitBenchmark: "has_explicit_benchmark",
    hasRndReference: "has_rnd_reference",
    rndEvidenceAvailable: "rnd_evidence_available",
    productArchitecture: "product_architecture",
    formulaPhilosophy: "formula_philosophy"
  };

  for (const [column, inputKey] of Object.entries(direct)) {
    const value = input[inputKey as keyof UpdateProductInput];
    if (value !== undefined) {
      patch[column] = value;
    }
  }

  if (input.weight_g !== undefined) {
    patch.weightG = String(input.weight_g);
  }
  if (input.suggested_retail_price !== undefined) {
    patch.suggestedRetailPrice = String(input.suggested_retail_price);
  }
  if (input.internal_cost !== undefined) {
    patch.internalCost = String(input.internal_cost);
  }

  return patch as Partial<NewProduct>;
}
