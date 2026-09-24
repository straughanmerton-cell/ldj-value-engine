import { and, count, desc, eq, type SQL } from "drizzle-orm";
import type { Database, NewRndReference, RndReference } from "@ldj/database";
import { rAndDReferences } from "@ldj/database";
import {
  RND_CLAIM_EVIDENCE_STATUS,
  findRestrictedRndPhrases,
  rndReferenceEvidenceSatisfied,
  type CreateRndReferenceInput,
  type FactStatus,
  type RndReferenceListQuery,
  type UpdateRndReferenceInput
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { assertProductExists } from "./product-guard.js";
import { serializeRndReference, type RndReferenceApiShape } from "./serialize.js";
import type { RecordActor } from "./facts.service.js";

const EVIDENCE_REQUIRED_MESSAGE = "研发参考状态不是 UNCONFIRMED 时必须提供证据说明或证据来源";

/**
 * 研发参考（规格 §35.2 / §25）。
 * 只记录「参考了哪个产品、以什么方式参考、证据状态如何」，
 * 不会把参考产品的原料、价格、年份等事实写入本产品（规格 §62-5）。
 */
export class RndReferenceService {
  constructor(private readonly db: Database) {}

  async list(
    productId: string,
    query: RndReferenceListQuery
  ): Promise<Paginated<RndReferenceApiShape>> {
    await assertProductExists(this.db, productId);
    const pagination = normalizePagination({ page: query.page, pageSize: query.pageSize });
    const filters: SQL[] = [eq(rAndDReferences.productId, productId)];
    if (query.reference_type) {
      filters.push(eq(rAndDReferences.referenceType, query.reference_type));
    }
    if (query.verification_status) {
      filters.push(eq(rAndDReferences.verificationStatus, query.verification_status));
    }

    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(rAndDReferences)
      .where(where)
      .orderBy(desc(rAndDReferences.createdAt))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db.select({ value: count() }).from(rAndDReferences).where(where);
    return buildPage(
      rows.map(serializeRndReference),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  async getById(productId: string, referenceId: string): Promise<RndReferenceApiShape> {
    return serializeRndReference(await this.findRow(productId, referenceId));
  }

  async create(
    productId: string,
    input: CreateRndReferenceInput,
    actor: RecordActor
  ): Promise<RndReferenceApiShape> {
    await assertProductExists(this.db, productId);
    if (input.reference_product_id === productId) {
      throw AppError.validation("研发参考产品不能是产品自身");
    }
    this.assertClaimLanguageAllowed(
      input.description,
      input.verification_status,
      input.evidence_note ?? null
    );
    const values: NewRndReference = {
      productId,
      referenceProductId: input.reference_product_id ?? null,
      referenceProductName: input.reference_product_name,
      referenceType: input.reference_type,
      description: input.description,
      verificationStatus: input.verification_status,
      evidenceSourceId: input.evidence_source_id ?? null,
      evidenceNote: input.evidence_note ?? null,
      createdBy: actor.id
    };
    const inserted = await this.db.insert(rAndDReferences).values(values).returning();
    return serializeRndReference(inserted[0]!);
  }

  async update(
    productId: string,
    referenceId: string,
    input: UpdateRndReferenceInput,
    _actor: RecordActor
  ): Promise<RndReferenceApiShape> {
    const existing = await this.findRow(productId, referenceId);
    const nextStatus: FactStatus = input.verification_status ?? existing.verificationStatus;
    const nextNote = input.evidence_note === undefined ? existing.evidenceNote : input.evidence_note;
    const nextSource =
      input.evidence_source_id === undefined ? existing.evidenceSourceId : input.evidence_source_id;

    if (
      !rndReferenceEvidenceSatisfied({
        verificationStatus: nextStatus,
        evidenceNote: nextNote,
        evidenceSourceId: nextSource
      })
    ) {
      throw AppError.validation(EVIDENCE_REQUIRED_MESSAGE, { verification_status: nextStatus });
    }

    const nextDescription = input.description ?? existing.description;
    this.assertClaimLanguageAllowed(nextDescription, nextStatus, nextNote);

    const patch: Partial<NewRndReference> = {};
    if (input.reference_product_id !== undefined) {
      if (input.reference_product_id === productId) {
        throw AppError.validation("研发参考产品不能是产品自身");
      }
      patch.referenceProductId = input.reference_product_id;
    }
    if (input.reference_product_name !== undefined) {
      patch.referenceProductName = input.reference_product_name;
    }
    if (input.reference_type !== undefined) {
      patch.referenceType = input.reference_type;
    }
    if (input.description !== undefined) {
      patch.description = input.description;
    }
    if (input.verification_status !== undefined) {
      patch.verificationStatus = input.verification_status;
    }
    if (input.evidence_note !== undefined) {
      patch.evidenceNote = input.evidence_note;
    }
    if (input.evidence_source_id !== undefined) {
      patch.evidenceSourceId = input.evidence_source_id;
    }

    if (Object.keys(patch).length === 0) {
      return serializeRndReference(existing);
    }

    const updated = await this.db
      .update(rAndDReferences)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(rAndDReferences.id, referenceId), eq(rAndDReferences.productId, productId)))
      .returning();
    return serializeRndReference(updated[0]!);
  }

  /**
   * 规格 §25：无 RND_CONFIRMED 证据时，不允许出现「复刻 X」「同款配方」等表述。
   */
  private assertClaimLanguageAllowed(
    description: string,
    status: FactStatus,
    evidenceNote: string | null
  ): void {
    const restricted = findRestrictedRndPhrases(description);
    if (restricted.length === 0) {
      return;
    }
    const hasEvidence = status === RND_CLAIM_EVIDENCE_STATUS && (evidenceNote?.trim().length ?? 0) > 0;
    if (!hasEvidence) {
      throw AppError.validation("研发/对标表述缺少 RND_CONFIRMED 证据（规格 §25）", {
        restricted_phrases: restricted,
        verification_status: status
      });
    }
  }

  async remove(productId: string, referenceId: string): Promise<void> {
    const deleted = await this.db
      .delete(rAndDReferences)
      .where(and(eq(rAndDReferences.id, referenceId), eq(rAndDReferences.productId, productId)))
      .returning({ id: rAndDReferences.id });
    if (deleted.length === 0) {
      throw AppError.notFound("研发参考不存在");
    }
  }

  private async findRow(productId: string, referenceId: string): Promise<RndReference> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(rAndDReferences)
      .where(and(eq(rAndDReferences.id, referenceId), eq(rAndDReferences.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("研发参考不存在");
    }
    return row;
  }
}
