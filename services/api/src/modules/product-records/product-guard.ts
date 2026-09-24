import { eq } from "drizzle-orm";
import type { Database } from "@ldj/database";
import { products } from "@ldj/database";
import { AppError } from "@ldj/shared";

/** 子资源统一校验：产品不存在时返回 404，避免子资源被写入不存在的产品。 */
export async function assertProductExists(db: Database, productId: string): Promise<void> {
  const rows = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (rows.length === 0) {
    throw AppError.notFound("产品不存在");
  }
}
