import { databaseUrl } from '../lib/env'

/**
 * Which connection string the maintenance scripts should use.
 *
 * Neon publishes two: a pooled one for the application, and a direct, unpooled
 * one. Schema changes belong on the direct connection — DDL and advisory locks
 * depend on session-level state that PgBouncer's transaction pooling does not
 * guarantee between statements, so migrations over the pooled URL fail
 * intermittently and confusingly.
 *
 * Preference order: an explicit override, then Neon's own unpooled variable,
 * then the ordinary runtime URL as a last resort.
 */
export interface MigrationTarget {
  url: string
  /** Which variable it came from. Logged instead of the URL, which carries a password. */
  source: string
}

export function resolveMigrationUrl(): MigrationTarget | undefined {
  const candidates: readonly (readonly [string, string | undefined])[] = [
    ['MIGRATE_DATABASE_URL', process.env.MIGRATE_DATABASE_URL],
    ['DATABASE_URL_UNPOOLED', process.env.DATABASE_URL_UNPOOLED],
    ['DATABASE_URL', databaseUrl],
  ]

  for (const [source, url] of candidates) {
    // `<` catches an unsubstituted placeholder like <your-connection-string>,
    // which otherwise reaches the driver as a baffling parse error.
    if (url && url.trim() !== '' && !url.includes('<')) {
      return { url, source }
    }
  }
  return undefined
}

/** Warn when about to run schema changes over what looks like a pooled connection. */
export function warnIfPooled(target: MigrationTarget): void {
  if (target.source === 'DATABASE_URL' && target.url.includes('-pooler')) {
    console.warn(
      'Warning: this looks like a pooled Neon connection.\n' +
        'If the run fails, set DATABASE_URL_UNPOOLED (or MIGRATE_DATABASE_URL) to the\n' +
        'direct connection string and try again.\n',
    )
  }
}
