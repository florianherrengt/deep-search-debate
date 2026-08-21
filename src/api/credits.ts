import { eq, sql } from "drizzle-orm"

import { config } from "./config.ts"
import { db } from "./db/index.ts"
import { user } from "./db/schema/index.ts"

export const MICRO_USD_PER_CREDIT = 1_000

type CreditTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class OutOfCreditsError extends Error {
  override readonly name = "OutOfCreditsError"
  readonly remainingCredits: number

  constructor(remainingCredits: number) {
    super("Insufficient credits")
    this.remainingCredits = remainingCredits
  }
}

export function hasAdminAccess(account: {
  email: string
  isAdmin: boolean
}): boolean {
  return (
    account.isAdmin ||
    (config.auth.adminEmail !== undefined &&
      account.email.trim().toLowerCase() === config.auth.adminEmail)
  )
}

export function getCreditAccount(userId: string): {
  credits: number
  isAdmin: boolean
} {
  const account = db
    .select({
      credits: user.credits,
      email: user.email,
      isAdmin: user.isAdmin,
    })
    .from(user)
    .where(eq(user.id, userId))
    .get()
  if (!account) throw new Error("Credit account was not found")
  return { credits: account.credits, isAdmin: hasAdminAccess(account) }
}

/** Checks admission only. Concurrent calls may all pass and overspend. */
export function requirePositiveCreditBalance(userId: string): void {
  const { credits } = getCreditAccount(userId)
  if (credits <= 0) throw new OutOfCreditsError(credits)
}

/** Debits a settled resource cost and intentionally permits a negative balance. */
export function debitCredits(
  transaction: CreditTransaction,
  userId: string,
  creditsUsed: number,
): void {
  if (!Number.isSafeInteger(creditsUsed) || creditsUsed < 0) {
    throw new Error(`Invalid credit charge: ${creditsUsed}`)
  }
  if (creditsUsed === 0) return

  const result = transaction
    .update(user)
    .set({ credits: sql`${user.credits} - ${creditsUsed}` })
    .where(eq(user.id, userId))
    .run()
  if (result.changes !== 1) throw new Error("Credit account was not found")
}

export function chargeUserCredits(userId: string, creditsUsed: number): void {
  db.transaction((transaction) => {
    debitCredits(transaction, userId, creditsUsed)
  })
}

export function addUserCredits(userId: string, credits: number): number {
  if (!Number.isSafeInteger(credits) || credits <= 0) {
    throw new Error(`Invalid credit grant: ${credits}`)
  }

  return db.transaction((transaction) => {
    const result = transaction
      .update(user)
      .set({ credits: sql`${user.credits} + ${credits}` })
      .where(eq(user.id, userId))
      .run()
    if (result.changes !== 1) throw new Error("Credit account was not found")
    return transaction
      .select({ credits: user.credits })
      .from(user)
      .where(eq(user.id, userId))
      .get()!.credits
  })
}

/** Converts ScrapingAnt's $19 / 100,000 provider-credit plan to product credits. */
export function calculateScrapingAntCredits(providerCredits: number): number {
  if (!Number.isFinite(providerCredits) || providerCredits < 0) {
    throw new Error(`Invalid ScrapingAnt credit cost: ${providerCredits}`)
  }
  return Math.ceil((providerCredits * 19) / 100)
}
