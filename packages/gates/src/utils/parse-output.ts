function tryParse(candidate: string): unknown | null {
  try {
    return JSON.parse(candidate)
  } catch {
    return null
  }
}

function extractBalancedJson(raw: string): string | null {
  const start = raw.search(/[\[{]/)
  if (start < 0) return null

  const openChar = raw[start]
  const closeChar = openChar === '{' ? '}' : ']'

  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (ch === '"') {
      inString = true
      continue
    }

    if (ch === openChar) depth += 1
    if (ch === closeChar) depth -= 1

    if (depth === 0) {
      return raw.slice(start, i + 1)
    }
  }

  return null
}

export function parseOutput(raw: string): unknown {
  const trimmed = raw.trim()
  const direct = tryParse(trimmed)
  if (direct !== null) return direct

  for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = tryParse(match[1].trim())
    if (parsed !== null) return parsed
  }

  const balanced = extractBalancedJson(trimmed)
  if (balanced) {
    const parsed = tryParse(balanced)
    if (parsed !== null) return parsed
    throw new Error('Invalid JSON found in output')
  }

  throw new Error('No JSON found in output')
}
