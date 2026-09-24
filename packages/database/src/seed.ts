import { eq } from "drizzle-orm";
import { createDb, resolveDatabaseUrl } from "./client.js";
import { loadRepoEnv } from "./env.js";
import { brands, users } from "./schema/index.js";
import { hashPassword } from "./password.js";

export interface SeedResult {
  brandId: string;
  adminEmail: string;
  adminCreated: boolean;
}

export async function seed(connectionString: string, options?: {
  adminEmail?: string;
  adminPassword?: string;
  adminName?: string;
}): Promise<SeedResult> {
  const adminEmail = (options?.adminEmail ?? process.env.BOOTSTRAP_ADMIN_EMAIL ?? "949412546@qq.com").toLowerCase();
  const adminPassword = options?.adminPassword ?? process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "ChangeMe_123456";
  const adminName = options?.adminName ?? "龙德记管理员";

  const handle = createDb({ connectionString, max: 1 });
  try {
    const existingBrand = await handle.db.select().from(brands).where(eq(brands.name, "龙德记")).limit(1);
    let brandId = existingBrand[0]?.id;
    if (!brandId) {
      const inserted = await handle.db
        .insert(brands)
        .values({ name: "龙德记", description: "龙德记自有品牌（Phase 1 默认品牌）" })
        .returning({ id: brands.id });
      brandId = inserted[0]!.id;
    }

    const existingUser = await handle.db.select().from(users).where(eq(users.email, adminEmail)).limit(1);
    let adminCreated = false;
    if (existingUser.length === 0) {
      await handle.db.insert(users).values({
        email: adminEmail,
        name: adminName,
        role: "ADMIN",
        status: "ACTIVE",
        passwordHash: hashPassword(adminPassword)
      });
      adminCreated = true;
    }

    return { brandId, adminEmail, adminCreated };
  } finally {
    await handle.close();
  }
}

async function main(): Promise<void> {
  loadRepoEnv();
  const result = await seed(resolveDatabaseUrl());
  console.log(
    `[seed] brand=${result.brandId} admin=${result.adminEmail} created=${result.adminCreated}`
  );
}

const isDirectRun = process.argv[1]?.includes("seed");
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error("[seed] failed", error);
    process.exitCode = 1;
  });
}
