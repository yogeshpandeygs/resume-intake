/**
 * Applies the generated migrations. Works against both backends:
 * PGlite locally, Postgres/Neon when `DATABASE_URL` is set.
 *
 *   npm run db:migrate
 */
import 'dotenv/config'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { assertPgliteAvailable } from '../lib/db/pglite-lock'
import { databaseUrl, pgliteDataDir } from '../lib/env'

async function main() {
  if (databaseUrl) {
    const { drizzle: drizzlePg } = await import('drizzle-orm/node-postgres')
    const { migrate: migratePg } = await import('drizzle-orm/node-postgres/migrator')
    const db = drizzlePg(databaseUrl)
    await migratePg(db, { migrationsFolder: './drizzle' })
    console.log('Migrations applied to Postgres at DATABASE_URL')
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
