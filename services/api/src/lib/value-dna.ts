import { asc, eq } from "drizzle-orm";
import type { Database, Product, ProductFact, RndReference, TastingProfile } from "@ldj/database";
import { productFacts, products, rAndDReferences, tastingProfiles } from "@ldj/database";
import {
  buildValueDnaFromProduct,
  valueDnaMetaSchema,
  type ValueDna,
  type ValueDnaBuildResult,
  type ValueDnaGenerator,
  type ValueDnaInput,
  type ValueDnaMeta,
  type PromptKey
} from "@ldj/schemas";
import { AppError } from "@ldj/shared";
import { serializeProduct } from "./serialize.js";
import { serializeTastingProfile } from "../modules/product-records/serialize.js";

/**
 * Value DNA（规格 §9）的加载与落库辅助层。
 *
 * 单独放在 lib 下，是因为两条链路都要用它：
 * - 产品创建后按 §9「产品创建后自动生成」立刻跑一次规则引擎（products 模块）；
 * - 显式重新生成（含 AI 辅助）与过期判定（value-dna 模块）。
 */

export interface ValueDnaCounts {
  product_version: number;
  fact_count: number;
  tasting_count: number;
  rnd_count: number;
}

export interface ValueDnaSources {
  product: Product;
  /** snake_case 产品快照，可直接喂给 buildValueDnaFromProduct */
  snapshot: Record<string, unknown>;
  facts: ProductFact[];
  tastingProfiles: TastingProfile[];
  rndReferences: RndReference[];
  counts: ValueDnaCounts;
}

export interface ValueDnaMetaExtra {
  generator: ValueDnaGenerator;
  promptKey?: PromptKey | null;
  promptVersion?: number | null;
  provider?: string | null;
  model?: string | null;
  version: number;
  extraWarnings?: readonly string[];
}

export async function loadValueDnaSources(db: Database, productId: string): Promise<ValueDnaSources> {
  const productRows = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  const product = productRows[0];
  if (!product) {
    throw AppError.notFound("产品不存在");
  }

  const facts = await db
    .select()
    .from(productFacts)
    .where(eq(productFacts.productId, productId))
    .orderBy(asc(productFacts.createdAt));
  const tasting = await db
    .select()
    .from(tastingProfiles)
    .where(eq(tastingProfiles.productId, productId))
    .orderBy(asc(tastingProfiles.createdAt));
  const rnd = await db
    .select()
    .from(rAndDReferences)
    .where(eq(rAndDReferences.productId, productId))
    .orderBy(asc(rAndDReferences.createdAt));

  return {
    product,
    snapshot: productSnapshot(product),
    facts,
    tastingProfiles: tasting,
    rndReferences: rnd,
    counts: {
      product_version: product.version,
      fact_count: facts.length,
      tasting_count: tasting.length,
      rnd_count: rnd.length
    }
  };
}

/** 内部构建一律用完整视图（不受角色可见性影响），DNA 不参与资金字段脱敏。 */
export function productSnapshot(product: Product): Record<string, unknown> {
  return { ...serializeProduct(product, "ADMIN") };
}

export function toValueDnaInput(sources: ValueDnaSources): ValueDnaInput {
  return {
    product: sources.snapshot,
    facts: sources.facts.map((row) => ({
      id: row.id,
      fact_key: row.factKey,
      fact_value: row.factValue,
      fact_group: row.factGroup,
      fact_status: row.factStatus
    })),
    tastingProfiles: sources.tastingProfiles.map(
      (row) => ({ ...serializeTastingProfile(row) }) as unknown as Record<string, unknown>
    ),
    rndReferences: sources.rndReferences.map((row) => ({
      id: row.id,
      reference_product_name: row.referenceProductName,
      reference_type: row.referenceType,
      description: row.description,
      verification_status: row.verificationStatus
    }))
  };
}

export function buildValueDna(
  sources: ValueDnaSources
): ValueDnaBuildResult & { input: ValueDnaInput } {
  const input = toValueDnaInput(sources);
  return { ...buildValueDnaFromProduct(input), input };
}

export function buildValueDnaMeta(
  result: ValueDnaBuildResult,
  counts: ValueDnaCounts,
  extra: ValueDnaMetaExtra
): ValueDnaMeta {
  return valueDnaMetaSchema.parse({
    generator: extra.generator,
    prompt_key: extra.promptKey ?? null,
    prompt_version: extra.promptVersion ?? null,
    provider: extra.provider ?? null,
    model: extra.model ?? null,
    generated_at: new Date().toISOString(),
    version: extra.version,
    product_version: counts.product_version,
    fact_count: counts.fact_count,
    tasting_count: counts.tasting_count,
    rnd_count: counts.rnd_count,
    source_fact_ids: result.sourceFactIds,
    provenance: result.provenance,
    missing_dimensions: result.missingDimensions,
    warnings: [...result.warnings, ...(extra.extraWarnings ?? [])]
  });
}

/**
 * 只写 value_dna / value_dna_meta 两列：
 * 刻意不改动 products.updated_at 与 version，避免重新生成 DNA 被误认为产品资料被改动。
 */
export async function saveValueDna(
  db: Database,
  productId: string,
  dna: ValueDna,
  meta: ValueDnaMeta
): Promise<void> {
  await db.update(products).set({ valueDna: dna, valueDnaMeta: meta }).where(eq(products.id, productId));
}
