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
  'globalThis'
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
  'match'
])

function assertSafeExpression(expr: string): void {
  const tokenPattern = new RegExp(`\\b(${BANNED_TOKENS.join('|')})\\b`)
  if (tokenPattern.test(expr)) {
    throw new Error('Blocked token in expression')
  }

  if (/=>|;|\bnew\b|\?\?|\?\./.test(expr)) {
    throw new Error('Unsupported syntax in expression')
  }

  if (!/^[\w\s.$()[\]'"`:+\-*/%<>=!&|?,]*$/.test(expr)) {
    throw new Error('Unsupported characters in expression')
  }

  for (const methodMatch of expr.matchAll(/\.([a-zA-Z_][a-zA-Z0-9_]*)\(/g)) {
    const methodName = methodMatch[1]
    if (!ALLOWED_METHODS.has(methodName)) {
      throw new Error(`Method not allowed: ${methodName}`)
    }
  }
}

export function safeEval(expression: string, context: Record<string, unknown>): unknown {
  assertSafeExpression(expression)

  const sandbox = vm.createContext(Object.assign(Object.create(null), context))
  const script = new vm.Script(`(${expression})`)
  return script.runInContext(sandbox, { timeout: 30 })
}
