import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import type { Database, NewProductFact, ProductFact } from "@ldj/database";
import { productFacts } from "@ldj/database";
import {
  factEvidenceSatisfied,
  factStatusRequiresAdmin,
  findFactKeyDefinition,
  resolveProductFactGroup,
  type CreateProductFactInput,
  type FactStatus,
  type ProductFactListQuery,
  type UpdateProductFactInput,
  type UserRole
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { assertProductExists } from "./product-guard.js";
import { serializeProductFact, type ProductFactApiShape } from "./serialize.js";

export interface RecordActor {
  id: string;
  role: UserRole;
}

const EVIDENCE_REQUIRED_MESSAGE = "事实状态不是 UNCONFIRMED 时必须提供证据说明或证据来源";

/**
 * 产品事实清单（规格 §11 / §36）。
 * 事实状态不是自动推断的结果：只有录入人显式提交的状态才会被存储，
 * 且非 UNCONFIRMED 状态必须有证据指向（未确认即不编造）。
 */
export class ProductFactService {
  constructor(private readonly db: Database) {}

  async list(productId: string, query: ProductFactListQuery): Promise<Paginated<ProductFactApiShape>> {
    await assertProductExists(this.db, productId);
    const pagination = normalizePagination({ page: query.page, pageSize: query.pageSize });
    const filters: SQL[] = [eq(productFacts.productId, productId)];

    if (query.fact_status) {
      filters.push(eq(productFacts.factStatus, query.fact_status));
    }
    if (query.fact_group) {
      filters.push(eq(productFacts.factGroup, query.fact_group));
    }
    if (query.fact_key) {
      filters.push(eq(productFacts.factKey, query.fact_key));
    }

    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(productFacts)
      .where(where)
      .orderBy(asc(productFacts.factGroup), desc(productFacts.createdAt))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db.select({ value: count() }).from(productFacts).where(where);
    return buildPage(
      rows.map(serializeProductFact),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  async getById(productId: string, factId: string): Promise<ProductFactApiShape> {
    return serializeProductFact(await this.findRow(productId, factId));
  }

  async create(
    productId: string,
    input: CreateProductFactInput,
    actor: RecordActor
  ): Promise<ProductFactApiShape> {
    await assertProductExists(this.db, productId);
    const status = input.fact_status;
    this.assertStatusGovernance(status, actor.role);

    const values: NewProductFact = {
      productId,
      factKey: input.fact_key,
      factLabel: input.fact_label ?? findFactKeyDefinition(input.fact_key)?.label ?? null,
      factGroup: input.fact_group ?? (resolveProductFactGroup(input.fact_key) as NewProductFact["factGroup"]),
      factValue: input.fact_value,
      factStatus: status,
      evidenceNote: input.evidence_note ?? null,
      evidenceSourceId: input.evidence_source_id ?? null,
      confirmedBy: status === "UNCONFIRMED" ? null : actor.id,
      confirmedAt: status === "UNCONFIRMED" ? null : new Date(),
      createdBy: actor.id
    };

    const inserted = await this.db.insert(productFacts).values(values).returning();
    return serializeProductFact(inserted[0]!);
  }

  async update(
    productId: string,
    factId: string,
    input: UpdateProductFactInput,
    actor: RecordActor
  ): Promise<ProductFactApiShape> {
    const existing = await this.findRow(productId, factId);
    const nextStatus: FactStatus = input.fact_status ?? existing.factStatus;
    const nextEvidenceNote =
      input.evidence_note === undefined ? existing.evidenceNote : input.evidence_note;
    const nextEvidenceSource =
      input.evidence_source_id === undefined ? existing.evidenceSourceId : input.evidence_source_id;
    const nextFactKey = input.fact_key ?? existing.factKey;

    this.assertStatusGovernance(nextStatus, actor.role);
    if (
      !factEvidenceSatisfied({
        factStatus: nextStatus,
        evidenceNote: nextEvidenceNote,
        evidenceSourceId: nextEvidenceSource
      })
    ) {
      throw AppError.validation(EVIDENCE_REQUIRED_MESSAGE, { fact_status: nextStatus });
    }

    const patch: Partial<NewProductFact> = {};
    if (input.fact_key !== undefined) {
      patch.factKey = input.fact_key;
    }
    if (input.fact_label !== undefined) {
      patch.factLabel = input.fact_label;
    }
    if (input.fact_group !== undefined) {
      patch.factGroup = input.fact_group;
    } else if (input.fact_key !== undefined) {
      // 事实键变化时按目录重新分组，避免分组与事实键不一致。
      patch.factGroup = resolveProductFactGroup(nextFactKey) as NewProductFact["factGroup"];
    }
    if (input.fact_value !== undefined) {
      patch.factValue = input.fact_value;
    }
    if (input.evidence_note !== undefined) {
      patch.evidenceNote = input.evidence_note;
    }
    if (input.evidence_source_id !== undefined) {
      patch.evidenceSourceId = input.evidence_source_id;
    }
    if (input.fact_status !== undefined) {
      patch.factStatus = input.fact_status;
      patch.confirmedBy = nextStatus === "UNCONFIRMED" ? null : actor.id;
      patch.confirmedAt = nextStatus === "UNCONFIRMED" ? null : new Date();
    }

    if (Object.keys(patch).length === 0) {
      return serializeProductFact(existing);
    }

    const updated = await this.db
      .update(productFacts)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(productFacts.id, factId), eq(productFacts.productId, productId)))
      .returning();
    return serializeProductFact(updated[0]!);
  }

  async remove(productId: string, factId: string): Promise<void> {
    const deleted = await this.db
      .delete(productFacts)
      .where(and(eq(productFacts.id, factId), eq(productFacts.productId, productId)))
      .returning({ id: productFacts.id });
    if (deleted.length === 0) {
      throw AppError.notFound("产品事实不存在");
    }
  }

  private assertStatusGovernance(status: FactStatus, role: UserRole): void {
    if (factStatusRequiresAdmin(status) && role !== "ADMIN") {
      throw AppError.forbidden("OFFICIAL_CONFIRMED 事实仅 ADMIN 可判定");
    }
  }

  private async findRow(productId: string, factId: string): Promise<ProductFact> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(productFacts)
      .where(and(eq(productFacts.id, factId), eq(productFacts.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("产品事实不存在");
    }
    return row;
  }
}
