import { eq } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import { db } from "../db/index.ts"
import { waitlistEntries } from "../db/schema/index.ts"
import { app } from "../index.ts"

const testEmail = "waitlist-route@example.com"

afterEach(() => {
  db.delete(waitlistEntries)
    .where(eq(waitlistEntries.email, testEmail))
    .run()
})

function joinWaitlist(email: string, origin = "http://localhost:5173") {
  return app.request("/api/waitlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({ email }),
  })
}

describe("POST /api/waitlist", () => {
  it("is public and persists a normalized email", async () => {
    const response = await joinWaitlist("  WAITLIST-ROUTE@EXAMPLE.COM  ")

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ joined: true })

    const persisted = db.select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, testEmail))
      .get()
    expect(persisted).toMatchObject({ email: testEmail })
    expect(persisted?.waitlistEntryId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(persisted?.createdAt).toBeInstanceOf(Date)
  })

  it("treats differently normalized duplicate submissions as success", async () => {
    const firstResponse = await joinWaitlist(testEmail)
    const firstEntry = db.select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, testEmail))
      .get()

    const duplicateResponse = await joinWaitlist(" WAITLIST-ROUTE@EXAMPLE.COM ")
    const entries = db.select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, testEmail))
      .all()

    expect(firstResponse.status).toBe(200)
    await expect(firstResponse.json()).resolves.toEqual({ joined: true })
    expect(duplicateResponse.status).toBe(200)
    await expect(duplicateResponse.json()).resolves.toEqual({ joined: true })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.waitlistEntryId).toBe(firstEntry?.waitlistEntryId)
  })

  it.each([
    "not-an-email",
    `${"a".repeat(244)}@example.com`,
  ])("rejects invalid email input: %s", async (email) => {
    const response = await joinWaitlist(email)

    expect(response.status).toBe(400)
  })

  it("rejects cross-site submissions", async () => {
    const response = await joinWaitlist(
      testEmail,
      "https://attacker.example",
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: "Forbidden" })
    expect(
      db.select()
        .from(waitlistEntries)
        .where(eq(waitlistEntries.email, testEmail))
        .get(),
    ).toBeUndefined()
  })
})
