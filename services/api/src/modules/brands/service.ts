import { asc, eq } from "drizzle-orm";
import type { Brand, Database } from "@ldj/database";
import { brands } from "@ldj/database";
import type { CreateBrandInput, UpdateBrandInput } from "@ldj/schemas";
import { AppError } from "@ldj/shared";

export interface BrandView {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export class BrandService {
  constructor(private readonly db: Database) {}

  async list(): Promise<BrandView[]> {
    const rows = await this.db.select().from(brands).orderBy(asc(brands.name));
    return rows.map(toBrandView);
  }

  async getById(id: string): Promise<BrandView> {
    const rows = await this.db.select().from(brands).where(eq(brands.id, id)).limit(1);
    const brand = rows[0];
    if (!brand) {
      throw AppError.notFound("品牌不存在");
    }
    return toBrandView(brand);
  }

  async create(input: CreateBrandInput): Promise<BrandView> {
    const existing = await this.db.select({ id: brands.id }).from(brands).where(eq(brands.name, input.name)).limit(1);
    if (existing.length > 0) {
      throw AppError.conflict("同名品牌已存在");
    }
    const inserted = await this.db
      .insert(brands)
      .values({ name: input.name, description: input.description })
      .returning();
    return toBrandView(inserted[0]!);
  }

  async update(id: string, input: UpdateBrandInput): Promise<BrandView> {
    if (Object.keys(input).length === 0) {
      return this.getById(id);
    }
    const updated = await this.db
      .update(brands)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
        updatedAt: new Date()
      })
      .where(eq(brands.id, id))
      .returning();
    const brand = updated[0];
    if (!brand) {
      throw AppError.notFound("品牌不存在");
    }
    return toBrandView(brand);
  }

  async remove(id: string): Promise<void> {
    const deleted = await this.db.delete(brands).where(eq(brands.id, id)).returning({ id: brands.id });
    if (deleted.length === 0) {
      throw AppError.notFound("品牌不存在");
    }
  }
}

function toBrandView(brand: Brand): BrandView {
  return {
    id: brand.id,
    name: brand.name,
    description: brand.description,
    created_at: brand.createdAt.toISOString(),
    updated_at: brand.updatedAt.toISOString()
  };
}
