import { defineConfig } from "drizzle-kit";
import { resolveRuntimeDefaults } from "./runtimeDefaults.ts";

const runtimeDefaults = resolveRuntimeDefaults(process.env.NODE_ENV);

export default defineConfig({
  schema: "./db/schema/index.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? runtimeDefaults.databaseUrl,
  },
});
