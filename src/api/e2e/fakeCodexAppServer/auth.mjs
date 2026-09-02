import { closeSync, constants, existsSync, openSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const loginId = "e2e-device-login"

export function createFakeCodexAuth({ codexHome, fail, notify, respond }) {
  const authPath = join(codexHome, "auth.json")
  let loginTimer
  let loggedIn = existsSync(authPath)

  function writeCredentials() {
    const descriptor = openSync(
      authPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC,
      0o600,
    )
    try {
      writeFileSync(
        descriptor,
        JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            access_token: "e2e-access-token",
            refresh_token: "e2e-refresh-token",
          },
          last_refresh: "2026-08-26T00:00:00.000Z",
        }),
      )
    } finally {
      closeSync(descriptor)
    }
    loggedIn = true
  }

  function completeDeviceLogin() {
    writeCredentials()
    notify("account/login/completed", {
      loginId,
      success: true,
      error: null,
      onboardingEntrypoint: null,
    })
  }

  return {
    handle(method, id, params) {
      switch (method) {
        case "account/login/start":
          if (
            params.type !== "chatgptDeviceCode" ||
            Object.keys(params).length !== 1
          ) {
            fail(id, "unsupported login type", -32602)
            return true
          }
          respond(id, {
            type: "chatgptDeviceCode",
            loginId,
            verificationUrl: "https://auth.openai.com/device",
            userCode: "E2E-CODE",
          })
          loginTimer = setTimeout(completeDeviceLogin, 750)
          return true
        case "account/login/cancel":
          if (loginTimer) clearTimeout(loginTimer)
          respond(id, {})
          return true
        case "account/read":
          respond(id, {
            account: loggedIn
              ? { type: "chatgpt", email: "e2e@example.com", planType: "plus" }
              : null,
            requiresOpenaiAuth: !loggedIn,
          })
          return true
        default:
          return false
      }
    },
    isLoggedIn: () => loggedIn,
    shutdown() {
      if (loginTimer) clearTimeout(loginTimer)
    },
  }
}
