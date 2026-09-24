export const TEST_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://ldj:ldj_dev_password@127.0.0.1:55433/ldj_test",
  TEST_DATABASE_URL: "postgres://ldj:ldj_dev_password@127.0.0.1:55433/ldj_test",
  JWT_SECRET: "test-secret-value-please-change-1234567890",
  ACCESS_TOKEN_TTL_MINUTES: "30",
  REFRESH_TOKEN_TTL_DAYS: "30",
  CORS_ORIGINS: "http://127.0.0.1:4401",
  API_HOST: "127.0.0.1",
  API_PORT: "4400",
  AI_PROVIDER: "mock",
  SEARCH_PROVIDER: "mock"
};

export function testDatabaseUrl(): string {
  return process.env.TEST_DATABASE_URL ?? TEST_ENV.TEST_DATABASE_URL!;
}
