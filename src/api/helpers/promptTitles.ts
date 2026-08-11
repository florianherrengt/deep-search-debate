const MAX_SLUG_LENGTH = 80
const MAX_TITLE_LENGTH = 80

export type PromptIdentity = {
  title: string
  slug: string
}

export function slugifyPromptTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "")

  return slug || "untitled"
}

function appendSlugNumber(baseSlug: string, number: number): string {
  const suffix = `-${number}`
  const prefix = baseSlug
    .slice(0, MAX_SLUG_LENGTH - suffix.length)
    .replace(/-+$/g, "")
  return `${prefix}${suffix}`
}

function appendTitleNumber(title: string, number: number): string {
  const suffix = ` ${number}`
  return `${title.slice(0, MAX_TITLE_LENGTH - suffix.length).trimEnd()}${suffix}`
}

/** Chooses the first readable title/slug pair not already used by this user. */
export function createPromptIdentity(
  generatedTitle: string,
  usedSlugs: Iterable<string>,
): PromptIdentity {
  const title = generatedTitle.trim().slice(0, MAX_TITLE_LENGTH).trimEnd()
  const baseSlug = slugifyPromptTitle(title)
  const occupied = new Set(usedSlugs)
  if (!occupied.has(baseSlug)) return { title, slug: baseSlug }

  for (let number = 2; ; number += 1) {
    const slug = appendSlugNumber(baseSlug, number)
    if (!occupied.has(slug)) {
      return { title: appendTitleNumber(title, number), slug }
    }
  }
}
