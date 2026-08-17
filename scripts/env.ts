/**
 * Loads local configuration for the CLI scripts.
 *
 * Next.js reads `.env.local` on its own; plain Node does not, and `dotenv/config`
 * loads `.env` only. So before this existed, the scripts ignored `.env.local` —
 * which is exactly where the documented setup puts `DATABASE_URL` and
 * `MIGRATE_DATABASE_URL`.
 *
 * The failure was silent and worse than a crash: `db:migrate` found no connection
 * string, fell through to the embedded development database, and printed
 * "Migrations applied" while the real database stayed empty.
 *
 * `.env.local` is loaded first because dotenv never overwrites a variable that is
 * already set — so loading it first is what gives it precedence over `.env`. This
 * is the same order Next.js uses, and a variable exported in the shell still wins
 * over both.
 */
import { config } from 'dotenv'

config({ path: '.env.local', quiet: true })
config({ path: '.env', quiet: true })
