/**
 * `node:sqlite` loader.
 *
 * Imported through `process.getBuiltinModule` rather than a static import
 * because the test runner's bundler (vite 5) predates the builtin and tries
 * to resolve `node:sqlite` as a package. The runtime is Node 22, where the
 * module exists. A static `import ... from 'node:sqlite'` breaks vitest with
 * "Failed to load url sqlite"; this indirection keeps both working.
 */

type SqliteModule = typeof import('node:sqlite')

function load(): SqliteModule {
  const mod = (process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.(
    'node:sqlite',
  )
  if (!mod) throw new Error('node:sqlite is unavailable (need Node >= 22.5)')
  return mod as SqliteModule
}

export const DatabaseSync = load().DatabaseSync
export type SqliteDatabase = InstanceType<SqliteModule['DatabaseSync']>
