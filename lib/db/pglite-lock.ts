import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Advisory ownership marker for the embedded database.
 *
 * PGlite is Postgres compiled to WebAssembly and running in-process. A data
 * directory belongs to one *application* at a time, and opening it from a second
 * one does not fail cleanly — it aborts the WASM runtime and leaves the directory
 * unusable, taking the local data with it. Running `npm run db:seed` or
 * `npm run outbox` while `npm run dev` is up is enough to do it.
 *
 * The protection is deliberately asymmetric:
 *
 *   - The running app *marks* the directory (`markPgliteOwner`) and never
 *     refuses itself. Next.js in development spans several processes — the dev
 *     server, the server renderer, Turbopack workers — and a strict PID lock
 *     produces false positives that break the app it is meant to protect.
 *   - Command-line scripts *check* the mark (`assertPgliteAvailable`) and refuse
 *     to start while a live app holds it.
 *
 * That covers the case that actually corrupts data — a script run against a
 * running server — without the app tripping over itself.
 *
 * None of this applies in production, where `DATABASE_URL` points at Postgres and
 * concurrent connections are the entire point.
 */

const LOCK_FILE = '.owner.lock'

interface OwnerRecord {
  pid: number
  startedAt: string
  role: string
}

/**
 * The `turbopackIgnore` hints stop the bundler concluding that this module reads
 * arbitrary paths and tracing the entire project into the serverless output.
 * These paths only ever point inside the local data directory.
 */
function lockPathFor(dataDir: string): string | undefined {
  // In-memory databases are per-process by construction and need no marker.
  if (dataDir.startsWith('memory://')) return undefined
  return join(resolve(/* turbopackIgnore: true */ process.cwd(), dataDir), LOCK_FILE)
}

function readOwner(lockPath: string): OwnerRecord | undefined {
  if (!existsSync(lockPath)) return undefined
  try {
    const record = JSON.parse(readFileSync(lockPath, 'utf8')) as OwnerRecord
    return Number.isInteger(record?.pid) ? record : undefined
  } catch {
    return undefined
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 performs the existence and permission check without delivering
    // anything.
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Record that this process has the database open. Never throws and never
 * refuses — it exists so that command-line scripts can see the app is running.
 */
export function markPgliteOwner(dataDir: string, role = 'app'): void {
  const lockPath = lockPathFor(dataDir)
  if (!lockPath) return

  try {
    mkdirSync(resolve(/* turbopackIgnore: true */ process.cwd(), dataDir), { recursive: true })
    const record: OwnerRecord = {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      role,
    }
    writeFileSync(lockPath, JSON.stringify(record), 'utf8')

    const release = () => {
      try {
        if (readOwner(lockPath)?.pid === process.pid) rmSync(lockPath, { force: true })
      } catch {
        // Nothing useful to do while the process is exiting.
      }
    }

    process.once('exit', release)
  } catch {
    // The marker is a convenience. Failing to write it must not stop the app.
  }
}

export class PgliteDirectoryBusy extends Error {
  constructor(dataDir: string, owner: OwnerRecord) {
    super(
      `The local database at ${dataDir} is in use by ${owner.role} (process ${owner.pid}, since ${owner.startedAt}).\n\n` +
        'PGlite allows one application at a time, and opening it twice corrupts the data directory.\n' +
        'Stop the dev server and run this again — or set DATABASE_URL to use a real Postgres, which has no such restriction.',
    )
    this.name = 'PgliteDirectoryBusy'
  }
}

/**
 * Refuse to continue if a live application already has the database open.
 * Called by command-line scripts, never by the server.
 */
export function assertPgliteAvailable(dataDir: string): void {
  const lockPath = lockPathFor(dataDir)
  if (!lockPath) return

  const owner = readOwner(lockPath)
  if (!owner) return
  if (owner.pid === process.pid) return

  if (isProcessAlive(owner.pid)) {
    throw new PgliteDirectoryBusy(dataDir, owner)
  }

  // Stale marker left by a process that is no longer running.
  rmSync(lockPath, { force: true })
}
