export function parseOutput(text: string): unknown | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  // 1. Try parsing as clean JSON first
  try {
    return JSON.parse(trimmed)
  } catch {
    // Not clean JSON, continue
  }

  // 2. Try extracting from code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/)
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim())
    } catch {
      // Invalid JSON inside fence, continue
    }
  }

  // 3. Try finding a JSON object or array in the text
  const jsonMatch = trimmed.match(/(\{[\s\S]*\})/)
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1])
    } catch {
      // Not valid JSON
    }
  }

  const arrayMatch = trimmed.match(/(\[[\s\S]*\])/)
  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[1])
    } catch {
      // Not valid JSON
    }
  }

  return null
}
