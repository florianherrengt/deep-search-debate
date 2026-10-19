import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import {
  addUserCredits,
  chargeUserCredits,
  getCreditAccount,
  OutOfCreditsError,
  requirePositiveCreditBalance,
} from "./credits.ts"
import { db } from "./db/index.ts"
import { user } from "./db/schema/index.ts"

const creditTestUserId = "credit-test-user"

afterEach(() => {
  db.delete(user).where(eq(user.id, creditTestUserId)).run()
})

describe("credit accounts", () => {
  it("starts at 500, accepts grants, and permits settled overspend", () => {
    db.insert(user)
      .values({
        id: creditTestUserId,
        name: "Credit Test",
        email: "credit-test@example.com",
      })
      .run()

    expect(getCreditAccount(creditTestUserId).credits).toBe(500)
    expect(() => requirePositiveCreditBalance(creditTestUserId)).not.toThrow()

    chargeUserCredits(creditTestUserId, 500)
    expect(getCreditAccount(creditTestUserId).credits).toBe(0)
    expect(() => requirePositiveCreditBalance(creditTestUserId)).toThrow(
      OutOfCreditsError,
    )

    expect(addUserCredits(creditTestUserId, 2)).toBe(2)
    expect(() => requirePositiveCreditBalance(creditTestUserId)).not.toThrow()

    chargeUserCredits(creditTestUserId, 3)
    expect(getCreditAccount(creditTestUserId).credits).toBe(-1)
    expect(() => requirePositiveCreditBalance(creditTestUserId)).toThrow(
      OutOfCreditsError,
    )
  })

  it("rejects invalid charges and grants without changing the account", () => {
    db.insert(user)
      .values({
        id: creditTestUserId,
        name: "Credit Test",
        email: "credit-test@example.com",
      })
      .run()
    const creditsBefore = getCreditAccount(creditTestUserId).credits

    expect(() => chargeUserCredits(creditTestUserId, -1)).toThrow(
      "Invalid credit charge",
    )
    expect(() => addUserCredits(creditTestUserId, 0)).toThrow(
      "Invalid credit grant",
    )
    expect(() => chargeUserCredits("missing-credit-user", 1)).toThrow(
      "Credit account was not found",
    )

    expect(getCreditAccount(creditTestUserId).credits).toBe(creditsBefore)
  })
})
