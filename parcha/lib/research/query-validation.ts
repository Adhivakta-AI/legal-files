export const INVALID_QUERY_MESSAGE =
  "Please enter a proper legal research query with at least two words—for example, “Supreme Court cases on anticipatory bail under Section 438 CrPC.”"

export function deterministicQueryError(query: string): string | null {
  const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []
  if (tokens.length < 2) return INVALID_QUERY_MESSAGE

  const normalized = tokens.join(" ").toLocaleLowerCase()
  if (
    /^(?:hello|hey|hi|pretty|dumb|test|testing|random|whatever)(?: there)?$/.test(
      normalized
    )
  ) {
    return INVALID_QUERY_MESSAGE
  }

  const looksRandom = tokens.some((token) => {
    const letters = token.toLocaleLowerCase().replace(/[^a-z]/g, "")
    if (letters.length < 8) return false
    const vowelRatio = (letters.match(/[aeiou]/g)?.length ?? 0) / letters.length
    return vowelRatio < 0.18 && /[^aeiou]{5,}/.test(letters)
  })
  return looksRandom ? INVALID_QUERY_MESSAGE : null
}
