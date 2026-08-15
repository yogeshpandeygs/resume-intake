import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzleNodePostgres } from 'drizzle-orm/node-postgres'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import { databaseUrl, isProduction, missingProductionConfig, pgliteDataDir } from '../env'
import { markPgliteOwner } from './pglite-lock'
import * as schema from './schema'

export { schema }

/**
 * Database handle.
 *
 * Locally this is PGlite — real Postgres compiled to WebAssembly, running in
 * process. It gives genuine Postgres semantics (transactions, unique indexes,
 * `UPDATE ... RETURNING`) with nothing to install, which matters here because the
 * duplicate-block rule and the submission-id counter both depend on those
 * semantics being real rather than emulated.
 *
 * In production, `DATABASE_URL` points at Neon and the same Drizzle schema and
 * queries are used unchanged.
 */
export type Database = PgliteDatabase<typeof schema>

/**
 * Next.js reloads modules on every edit in development. Without a global cache
 * each reload would open a second PGlite instance against the same data
 * directory, so the handle is stashed on `globalThis`.
 */
const globalForDb = globalThis as unknown as {
  __resumeIntakeDb?: Database
  __resumeIntakeClient?: PGlite
}

function createDatabase(): Database {
  if (databaseUrl) {
    // Neon and any other Postgres speak the same wire protocol, so the driver is
    // swapped here and nothing downstream needs to know which one it is. Both
    // drivers are imported statically because the bundler resolves this module
    // for every route regardless of which branch runs.
    return drizzleNodePostgres(databaseUrl, { schema }) as unknown as Database
  }

  if (isProduction) {
    throw missingProductionConfig(
      'DATABASE_URL',
      'The application has no database to connect to.',
    )
  }

  // Advisory only: records that the app has the directory open so command-line
  // scripts refuse to run against it. Never blocks the app itself, because
  // Next.js in development legitimately spans several processes.
  markPgliteOwner(pgliteDataDir, 'the dev server')

  const client = new PGlite(pgliteDataDir)
  globalForDb.__resumeIntakeClient = client
  return drizzlePglite(client, { schema })
}

/**
 * Resolve the handle, building it on first use.
 *
 * Deliberately lazy. `next build` runs with NODE_ENV=production, so creating the
 * connection at module load would make the production guard above fail the build
 * over variables that are only needed at runtime.
 */
function resolveDatabase(): Database {
  if (!globalForDb.__resumeIntakeDb) {
    globalForDb.__resumeIntakeDb = createDatabase()
  }
  return globalForDb.__resumeIntakeDb
}

/**
 * The database handle.
 *
 * A proxy so that `db.select(...)` reads exactly as it would on a real handle
 * while the connection is still created on first use. Methods are bound to the
 * underlying instance, since Drizzle's builders rely on `this`.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const instance = resolveDatabase()
    const value = Reflect.get(instance as object, property, receiver)
    return typeof value === 'function' ? value.bind(instance) : value
  },
  has(_target, property) {
    return Reflect.has(resolveDatabase() as object, property)
  },
})

/** The underlying PGlite client, when running embedded. Used by the migrator. */
export function pgliteClient(): PGlite | undefined {
  return globalForDb.__resumeIntakeClient
}
