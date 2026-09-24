import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import type { AiProvider } from "@ldj/ai";
import type { SearchProvider } from "@ldj/search";
import { createDb, type DbHandle } from "@ldj/database";
import { loadConfig } from "../../src/config.js";
import { buildServer } from "../../src/server.js";
import type { CrawlerService } from "../../src/modules/research/crawler.service.js";
import { TEST_ENV, testDatabaseUrl } from "../test-env.js";

export interface TestContext {
  app: FastifyInstance;
  dbHandle: DbHandle;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export interface TestContextOptions {
  /** 注入规则化 Mock，用于验证 AI 输出 schema 校验与「不可回溯即丢弃」（规格 §62-13）。 */
  aiProvider?: AiProvider;
  /** 注入带 fixture 的搜索 Provider，验证 §12 的真实检索链路与 §62-1。 */
  searchProvider?: SearchProvider;
  /** 注入假 fetch 的 Crawler，验证抓取成功 / 失败分支（规格 §41）。 */
  crawler?: CrawlerService;
}

export async function createTestContext(options: TestContextOptions = {}): Promise<TestContext> {
  const config = loadConfig({ ...TEST_ENV, ...process.env, NODE_ENV: "test" } as NodeJS.ProcessEnv);
  const dbHandle = createDb({ connectionString: testDatabaseUrl(), max: 3 });
  const app = buildServer({
    config: {
      ...config,
      ...(options.aiProvider ? { aiProvider: options.aiProvider } : {}),
      ...(options.searchProvider ? { searchProvider: options.searchProvider } : {}),
      ...(options.crawler ? { crawler: options.crawler } : {})
    },
    dbHandle,
    logger: false
  });
  await app.ready();

  return {
    app,
    dbHandle,
    reset: async () => {
      await dbHandle.db.execute(
        sql`truncate table chat_messages, chat_sessions, sessions, claim_evidence, generated_claims, copy_outputs, formula_philosophies, product_architectures, product_value_codes, value_codes, category_creator_profiles, value_anchors, source_extractions, sources, search_plans, research_jobs, market_offers, comparable_candidates, product_facts, tasting_profiles, r_and_d_references, prompt_versions, products, brands, users restart identity cascade`
      );
    },
    close: async () => {
      await app.close();
    }
  };
}

export interface BootstrapResult {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

export async function bootstrapAdmin(
  app: FastifyInstance,
  credentials: { email: string; password: string; name?: string } = {
    email: "admin@longdeji.local",
    password: "AdminPass1234"
  }
): Promise<BootstrapResult> {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/register",
    payload: {
      email: credentials.email,
      password: credentials.password,
      name: credentials.name ?? "测试管理员"
    }
  });
  if (response.statusCode !== 201) {
    throw new Error(`bootstrap 失败：${response.statusCode} ${response.body}`);
  }
  const body = response.json() as {
    user: { id: string };
    tokens: { access_token: string; refresh_token: string };
  };
  return {
    accessToken: body.tokens.access_token,
    refreshToken: body.tokens.refresh_token,
    userId: body.user.id
  };
}

export function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export const SIX_STAR_PEACOCK_FIXTURE = {
  product_name: "龙德记六星孔雀",
  year: 2026,
  tea_type: "普洱生茶",
  tea_subtype: "生茶",
  origin_province: "云南",
  origin_city: "西双版纳",
  origin_region: "勐海",
  mountain: "布朗山",
  weight_g: 357,
  raw_material: "大树春茶",
  season: "春茶",
  dry_leaf_aroma: "烟香明显",
  entry_taste: "浓强",
  huigan: "快",
  salivation: "强",
  cha_qi: "明显",
  benchmark_mode_preference: "AUTO",
  copy_intensity_default: 4
} as const;
