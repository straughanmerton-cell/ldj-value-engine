import { z } from "zod";

/**
 * API / Worker 共用的环境变量解析。
 * 第三方 Key 允许为空：缺失时对应能力回退到 Mock Provider（见 @ldj/ai、@ldj/search）。
 */
export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(4400),
  API_PUBLIC_URL: z.string().default("http://127.0.0.1:4400"),
  CORS_ORIGINS: z.string().default("http://127.0.0.1:4401"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL 必填"),
  TEST_DATABASE_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16, "JWT_SECRET 至少 16 字符"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).optional(),

  AI_PROVIDER: z.enum(["mock", "openai", "deepseek"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4.1"),

  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().default("https://api.deepseek.com/v1"),
  DEEPSEEK_MODEL: z.string().default("deepseek-v4-pro"),

  SEARCH_PROVIDER: z.enum(["mock", "tavily"]).default("mock"),
  TAVILY_API_KEY: z.string().optional()
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`环境变量校验失败 -> ${issues}`);
  }
  return parsed.data;
}

export function parseCorsOrigins(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
