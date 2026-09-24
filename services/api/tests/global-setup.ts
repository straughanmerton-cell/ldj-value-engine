import { runMigrations } from "@ldj/database";
import { TEST_ENV, testDatabaseUrl } from "./test-env.js";

export default async function globalSetup(): Promise<void> {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  await runMigrations(testDatabaseUrl());
}
