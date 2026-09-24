import { and, asc, count, desc, eq, type SQL } from "drizzle-orm";
import type { Database, NewTastingProfile, TastingProfile } from "@ldj/database";
import { tastingProfiles } from "@ldj/database";
import {
  SENSORY_FIELDS,
  tastingProfileHasContent,
  type CreateTastingProfileInput,
  type TastingProfileListQuery,
  type UpdateTastingProfileInput
} from "@ldj/schemas";
import { AppError, buildPage, normalizePagination, type Paginated } from "@ldj/shared";
import { assertProductExists } from "./product-guard.js";
import { serializeTastingProfile, type TastingProfileApiShape } from "./serialize.js";
import type { RecordActor } from "./facts.service.js";

const EMPTY_PROFILE_MESSAGE = "品饮档案至少需要一项感官记录或结论，避免产生空档案";

function camelize(key: string): string {
  return key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/**
 * 品饮档案（规格 §10.4 / §36）。
 * 同一产品可保留多条记录；不自动把品饮结果写回 products，
 * 需要更新产品主档案时由录入人显式修改产品字段。
 */
export class TastingProfileService {
  constructor(private readonly db: Database) {}

  async list(
    productId: string,
    query: TastingProfileListQuery
  ): Promise<Paginated<TastingProfileApiShape>> {
    await assertProductExists(this.db, productId);
    const pagination = normalizePagination({ page: query.page, pageSize: query.pageSize });
    const filters: SQL[] = [eq(tastingProfiles.productId, productId)];
    if (query.taster_name) {
      filters.push(eq(tastingProfiles.tasterName, query.taster_name));
    }

    const where = and(...filters);
    const rows = await this.db
      .select()
      .from(tastingProfiles)
      .where(where)
      .orderBy(desc(tastingProfiles.tastedAt), asc(tastingProfiles.createdAt))
      .limit(pagination.pageSize)
      .offset((pagination.page - 1) * pagination.pageSize);

    const totalRows = await this.db.select({ value: count() }).from(tastingProfiles).where(where);
    return buildPage(
      rows.map(serializeTastingProfile),
      Number(totalRows[0]?.value ?? 0),
      pagination
    );
  }

  async getById(productId: string, profileId: string): Promise<TastingProfileApiShape> {
    return serializeTastingProfile(await this.findRow(productId, profileId));
  }

  async create(
    productId: string,
    input: CreateTastingProfileInput,
    actor: RecordActor
  ): Promise<TastingProfileApiShape> {
    await assertProductExists(this.db, productId);
    const values = toInsertValues(productId, input, actor);
    const inserted = await this.db.insert(tastingProfiles).values(values).returning();
    return serializeTastingProfile(inserted[0]!);
  }

  async update(
    productId: string,
    profileId: string,
    input: UpdateTastingProfileInput,
    actor: RecordActor
  ): Promise<TastingProfileApiShape> {
    const existing = await this.findRow(productId, profileId);
    const patch = toUpdateValues(input);

    if (Object.keys(patch).length === 0) {
      return serializeTastingProfile(existing);
    }

    // 用 snake_case 视图做合并校验，与 §10.4 的字段名保持一致。
    const merged: Record<string, unknown> = { ...serializeTastingProfile(existing) };
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
    if (!tastingProfileHasContent(merged)) {
      throw AppError.validation(EMPTY_PROFILE_MESSAGE);
    }

    const updated = await this.db
      .update(tastingProfiles)
      .set({ ...patch, updatedAt: new Date(), version: existing.version + 1 })
      .where(and(eq(tastingProfiles.id, profileId), eq(tastingProfiles.productId, productId)))
      .returning();
    return serializeTastingProfile(updated[0]!);
  }

  async remove(productId: string, profileId: string): Promise<void> {
    const deleted = await this.db
      .delete(tastingProfiles)
      .where(and(eq(tastingProfiles.id, profileId), eq(tastingProfiles.productId, productId)))
      .returning({ id: tastingProfiles.id });
    if (deleted.length === 0) {
      throw AppError.notFound("品饮档案不存在");
    }
  }

  private async findRow(productId: string, profileId: string): Promise<TastingProfile> {
    await assertProductExists(this.db, productId);
    const rows = await this.db
      .select()
      .from(tastingProfiles)
      .where(and(eq(tastingProfiles.id, profileId), eq(tastingProfiles.productId, productId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      throw AppError.notFound("品饮档案不存在");
    }
    return row;
  }
}

function toInsertValues(
  productId: string,
  input: CreateTastingProfileInput,
  actor: RecordActor
): NewTastingProfile {
  const values: Record<string, unknown> = {
    productId,
    tasterName: input.taster_name ?? null,
    tastedAt: input.tasted_at ?? null,
    conclusion: input.conclusion ?? null,
    evidenceSourceId: input.evidence_source_id ?? null,
    createdBy: actor.id
  };
  for (const field of SENSORY_FIELDS) {
    values[camelize(field.key)] = input[field.key] ?? null;
  }
  return values as NewTastingProfile;
}

function toUpdateValues(input: UpdateTastingProfileInput): Partial<NewTastingProfile> {
  const patch: Record<string, unknown> = {};
  for (const field of SENSORY_FIELDS) {
    const value = input[field.key];
    if (value !== undefined) {
      patch[camelize(field.key)] = value;
    }
  }
  if (input.taster_name !== undefined) {
    patch.tasterName = input.taster_name;
  }
  if (input.tasted_at !== undefined) {
    patch.tastedAt = input.tasted_at;
  }
  if (input.conclusion !== undefined) {
    patch.conclusion = input.conclusion;
  }
  if (input.evidence_source_id !== undefined) {
    patch.evidenceSourceId = input.evidence_source_id;
  }
  return patch as Partial<NewTastingProfile>;
}
