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

/** Chooses the first readable title/slug pair whose slug does not exist. */
export function createPromptIdentity(
  generatedTitle: string,
  slugExists: (slug: string) => boolean,
): PromptIdentity {
  const title = generatedTitle.trim().slice(0, MAX_TITLE_LENGTH).trimEnd()
  const baseSlug = slugifyPromptTitle(title)
  if (!slugExists(baseSlug)) return { title, slug: baseSlug }

  for (let number = 2; ; number += 1) {
    const slug = appendSlugNumber(baseSlug, number)
    if (!slugExists(slug)) {
      return { title: appendTitleNumber(title, number), slug }
    }
  }
}
