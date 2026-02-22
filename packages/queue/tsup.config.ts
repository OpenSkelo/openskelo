import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ['better-sqlite3'],
    noExternal: ['@openskelo/adapters', '@openskelo/gates'],
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    sourcemap: true,
    external: ['better-sqlite3'],
    noExternal: ['@openskelo/adapters', '@openskelo/gates'],
    banner: { js: '#!/usr/bin/env node' },
  },
])
