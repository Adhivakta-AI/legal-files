export const QUERY_TOO_SHORT_MESSAGE =
  "Please enter at least two words describing the legal question or factual situation."

export const INVALID_QUERY_MESSAGE =
  "Please describe a legal question, case, provision, remedy, or factual situation you want legally assessed."

const CONTEXTUAL_FOLLOW_UP =
  /^(?:and|but|so|why|how|when|where|which|what|does|do|can|could|would|is|are)\b|\b(this|that|it|they|them|those|these|same)\b/i

export function deterministicQueryError(query: string): string | null {
  const tokens = query.normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? []
  if (tokens.length < 2) return QUERY_TOO_SHORT_MESSAGE

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

/**
 * This is the only hard query gate. A model may improve retrieval, but it may
 * not reject a usable multi-word factual scenario merely because the user did
 * not name a statute, section, or legal doctrine.
 */
export function queryGateError(
  query: string,
  hasConversationContext = false
): string | null {
  const error = deterministicQueryError(query)
  if (!error) return null
  if (hasConversationContext && CONTEXTUAL_FOLLOW_UP.test(query)) return null
  return error
}
