const BLOCKED_PATTERNS = [
  /\bprocess\b/,
  /\brequire\b/,
  /\bimport\b/,
  /\beval\b/,
  /\bFunction\b/,
  /\bfetch\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\b__proto__\b/,
  /\bconstructor\b/,
  /\bprototype\b/,
  /\bProxy\b/,
  /\bReflect\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
]

export function safeEval(expr: string, context: Record<string, unknown>): unknown {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(expr)) {
      throw new Error(`Unsafe expression blocked: contains forbidden token matching ${pattern}`)
    }
  }

  const keys = Object.keys(context)
  const values = keys.map((k) => context[k])

  // The blocklist above is the primary security layer.
  // We also shadow dangerous globals as function parameters
  // to provide defense-in-depth (skipping reserved words like 'import').
  const shadowNames = [
    'process', 'require', 'Function',
    'fetch', 'globalThis', 'global', 'window',
    'document', 'Proxy', 'Reflect',
    'setTimeout', 'setInterval',
  ]

  const fn = new Function(
    ...keys,
    ...shadowNames,
    `return (${expr})`,
  )

  const shadowValues = shadowNames.map(() => undefined)
  return fn(...values, ...shadowValues)
}
