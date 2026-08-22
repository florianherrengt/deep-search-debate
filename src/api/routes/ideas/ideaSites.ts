import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { config } from "../../config.ts"

export function ideaSitePath(ideaId: string): string {
  return join(config.ideaSites.dir, ideaId, "websites", "index.html")
}

export function buildIdeaSitePrompt(
  prompt: string,
  researchSummary: string,
  idea: { refinedTitle: string; refinedDescription: string },
): string {
  return [
    "<user_request>",
    prompt,
    "</user_request>",
    "<research_briefing>",
    researchSummary,
    "</research_briefing>",
    "<improved_idea>",
    JSON.stringify({
      title: idea.refinedTitle,
      description: idea.refinedDescription,
    }),
    "</improved_idea>",
  ].join("\n")
}

/** Persists one generated idea website as a single self-contained page. */
export async function writeIdeaSite(
  ideaId: string,
  html: string,
): Promise<void> {
  const path = ideaSitePath(ideaId)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, html, "utf-8")
}

/** Returns the stored website, or undefined when it was never generated. */
export async function readIdeaSite(
  ideaId: string,
): Promise<string | undefined> {
  try {
    return await readFile(ideaSitePath(ideaId), "utf-8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return
    throw error
  }
}
