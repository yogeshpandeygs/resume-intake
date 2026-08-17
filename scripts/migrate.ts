/**
 * Applies the generated migrations. Works against both backends:
 * PGlite locally, Postgres/Neon when `DATABASE_URL` is set.
 *
 *   npm run db:migrate
 */
import './env'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { assertPgliteAvailable } from '../lib/db/pglite-lock'
import { pgliteDataDir } from '../lib/env'
import { resolveMigrationUrl, warnIfPooled } from './connection'

async function main() {
  const target = resolveMigrationUrl()

  if (target) {
    warnIfPooled(target)

    const { drizzle: drizzlePg } = await import('drizzle-orm/node-postgres')
    const { migrate: migratePg } = await import('drizzle-orm/node-postgres/migrator')
    const db = drizzlePg(target.url)
    await migratePg(db, { migrationsFolder: './drizzle' })
    // Never print the URL itself — it carries the password.
    console.log(`Migrations applied to Postgres (connection from ${target.source})`)
    process.exit(0)
  }

  assertPgliteAvailable(pgliteDataDir)
  const client = new PGlite(pgliteDataDir)
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: './drizzle' })
  await client.close()
  console.log(`Migrations applied to embedded Postgres at ${pgliteDataDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
