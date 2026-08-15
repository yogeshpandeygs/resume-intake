/**
 * Runs before any test module is imported, so the database singleton in
 * `lib/db` picks up an in-memory Postgres rather than the developer's
 * on-disk `.pglite` directory.
 */
process.env.PGLITE_DATA_DIR = 'memory://'
delete process.env.DATABASE_URL

process.env.ADMIN_PASSWORD ??= 'test-admin-password'
process.env.SESSION_SECRET ??= 'test-session-secret-at-least-32-chars-long'
process.env.APP_BASE_URL ??= 'http://localhost:3000'

// Keep test files out of the developer's real .storage directory.
process.env.LOCAL_STORAGE_DIR ??= './.storage-test'
