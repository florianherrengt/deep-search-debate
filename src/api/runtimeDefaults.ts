export interface RuntimeDefaults {
  databaseUrl: string
  betterAuthUrl: string
  ideaSitesDir: string
}

export function resolveRuntimeDefaults(
  environment: string | undefined,
): RuntimeDefaults {
  return environment === "production"
    ? {
        databaseUrl: "/app/data/data.db",
        betterAuthUrl: "https://rethinkloop.com",
        ideaSitesDir: "/app/data/ideas",
      }
    : {
        databaseUrl: "data.db",
        betterAuthUrl: "http://localhost:5173",
        // Matches the cwd-relative development database so generated sites sit
        // next to the local database file.
        ideaSitesDir: "data/ideas",
      }
}
