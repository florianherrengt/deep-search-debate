export interface RuntimeDefaults {
  databaseUrl: string
  betterAuthUrl: string
}

export function resolveRuntimeDefaults(
  environment: string | undefined,
): RuntimeDefaults {
  return environment === "production"
    ? {
        databaseUrl: "/app/data/data.db",
        betterAuthUrl: "https://rethinkloop.com",
      }
    : {
        databaseUrl: "data.db",
        betterAuthUrl: "http://localhost:5173",
      }
}
