import { defineConfig } from 'drizzle-kit'

/**
 * Used for `drizzle-kit generate` only — it reads the schema and emits SQL, and
 * needs no live database. Migrations are applied programmatically by
 * `scripts/migrate.ts`, which works against both PGlite and Neon.
 */
export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
})
