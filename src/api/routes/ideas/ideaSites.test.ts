import { existsSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { config } from "../../config.ts"
import { readIdeaSite, writeIdeaSite } from "./ideaSites.ts"

describe("idea sites", () => {
  it("stores each website under its idea directory and reads it back", async () => {
    const ideaId = crypto.randomUUID()
    const html = "<!DOCTYPE html><html><body>Idea site</body></html>"

    await writeIdeaSite(ideaId, html)

    expect(
      existsSync(join(config.ideaSites.dir, ideaId, "websites", "index.html")),
    ).toBe(true)
    await expect(readIdeaSite(ideaId)).resolves.toBe(html)
  })

  it("returns undefined when no website was generated", async () => {
    await expect(readIdeaSite(crypto.randomUUID())).resolves.toBeUndefined()
  })
})
