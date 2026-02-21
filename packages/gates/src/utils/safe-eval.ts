import vm from 'node:vm'

const BANNED_TOKENS = [
  'process',
  'require',
  'import',
  'eval',
  'Function',
  'fetch',
  'constructor',
  '__proto__',
  'prototype',
  'global',
  'globalThis',
  'window',
  'document',
  'Proxy',
  'Reflect',
  'setTimeout',
  'setInterval',
]

const ALLOWED_METHODS = new Set([
  'toLowerCase',
  'toUpperCase',
  'trim',
  'includes',
  'startsWith',
  'endsWith',
  'slice',
  'substring',
  'split',
  'replace',
  'match',
])

// Only allow safe characters — no braces, backticks, or bracket notation
const SAFE_CHARS = /^[\w\s.$()'":+\-*/%<>=!&|?,]*$/

function assertSafeExpression(expr: string): void {
  // 1. Block dangerous tokens
  const tokenPattern = new RegExp(`\\b(${BANNED_TOKENS.join('|')})\\b`)
  if (tokenPattern.test(expr)) {
    throw new Error('Blocked token in expression')
  }

  // 2. Block dangerous syntax patterns
  if (/=>|;|\bnew\b|\?\?|\?\./.test(expr)) {
    throw new Error('Unsupported syntax in expression')
  }

  // 3. Character allowlist
  if (!SAFE_CHARS.test(expr)) {
    throw new Error('Unsupported characters in expression')
  }

  // 4. Method allowlist — only permit known-safe methods
  for (const methodMatch of expr.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_]*)\(/g)) {
    const methodName = methodMatch[1]
    if (!ALLOWED_METHODS.has(methodName)) {
      throw new Error(`Method not allowed: ${methodName}`)
    }
  }
}

export function safeEval(expr: string, context: Record<string, unknown>): unknown {
  assertSafeExpression(expr)

  const sandbox = vm.createContext(Object.assign(Object.create(null), context))
  const script = new vm.Script(`(${expr})`)
  return script.runInContext(sandbox, { timeout: 30 })
}
