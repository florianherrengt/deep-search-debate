import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import { config } from "./config.ts"
import { db } from "./db/index.ts"
import * as schema from "./db/schema/index.ts"

export const auth = betterAuth({
  appName: "RethinkLoop",
  baseURL: config.auth.baseUrl,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
  }),
  emailAndPassword: {
    enabled: config.auth.debugUser.enabled,
  },
  secret: config.auth.secret,
  socialProviders: {
    github: {
      clientId: config.auth.github.clientId,
      clientSecret: config.auth.github.clientSecret,
    },
  },
  trustedOrigins: [config.auth.trustedOrigin],
})
