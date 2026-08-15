import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { localStorageDir } from '../env'
import { assertSafeStorageKey, type ResumeStorage } from './types'

/**
 * Filesystem-backed resume storage, used when Vercel Blob is not configured.
 *
 * The storage root is resolved lazily rather than at module scope. A
 * `path.resolve(process.cwd(), ...)` evaluated during module initialisation
 * makes the bundler trace the entire project into the serverless output, on the
 * assumption that any file might be read at runtime — which bloats every
 * deployment with source files it will never use.
 */

let cachedRoot: string | undefined

function storageRoot(): string {
  cachedRoot ??= resolve(/* turbopackIgnore: true */ process.cwd(), localStorageDir)
  return cachedRoot
}

/**
 * Resolve a storage key to an absolute path, refusing anything that escapes the
 * storage root. Keys are server-generated, so this should never fire — it is here
 * so that a future change which starts trusting client input fails closed.
 */
function resolveWithinRoot(key: string): string {
  assertSafeStorageKey(key)
  const root = storageRoot()
  const target = resolve(/* turbopackIgnore: true */ root, key)
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error('Storage key escapes the storage root')
  }
  return target
}

export const localStorage: ResumeStorage = {
  async put(key, data, _contentType) {
    const target = resolveWithinRoot(key)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, data)
    return { path: key }
  },

  async get(path) {
    const buffer = await readFile(resolveWithinRoot(path))
    return new Uint8Array(buffer)
  },

  async delete(path) {
    // `force` so erasing an already-missing file is not an error: withdrawal must
    // succeed even if the blob was removed by an earlier partial run.
    await rm(resolveWithinRoot(path), { force: true })
  },
}

export { storageRoot as localStorageRoot }
