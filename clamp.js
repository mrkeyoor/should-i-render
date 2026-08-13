// Keep every text response inside the product's approximate 500-token budget.
// Structured content remains small by design and is not used as a text dump.
const MAX_TOKENS = 500
const TAIL = '\n...ask for a specific component to narrow the answer'

export function estimateTokens(text) {
  return Math.ceil(String(text).length / 4)
}

export function clamp(text, maxTokens = MAX_TOKENS) {
  const value = String(text).trim()
  const maxChars = maxTokens * 4
  if (value.length <= maxChars) return value

  const budget = maxChars - TAIL.length
  const head = value.slice(0, budget)
  let cut = -1
  for (const pattern of [/[.!?](?=\s|$)/g, /\n/g]) {
    let match
    while ((match = pattern.exec(head)) !== null) {
      const end = match.index + (match[0] === '\n' ? 0 : 1)
      if (end > cut) cut = end
    }
  }
  if (cut < budget * 0.5) {
    const word = head.lastIndexOf(' ')
    cut = word > budget * 0.5 ? word : budget
  }
  return head.slice(0, cut).trimEnd() + TAIL
}
