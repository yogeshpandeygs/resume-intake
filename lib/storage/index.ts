import { blobToken, isProduction, missingProductionConfig } from '../env'
import { blobStorage } from './blob'
import { localStorage } from './local'
import type { ResumeStorage } from './types'

export { assertSafeStorageKey } from './types'
export type { ResumeStorage } from './types'

/**
 * Pick the backend, refusing the local one in production.
 *
 * Resolved per call rather than once at module load, so `next build` — which runs
 * with NODE_ENV=production — is not failed by a variable only needed at runtime.
 */
function activeStorage(): ResumeStorage {
  if (blobToken) return blobStorage

  if (isProduction) {
    throw missingProductionConfig(
      'BLOB_READ_WRITE_TOKEN',
      'Uploaded resumes have nowhere durable to be stored.',
    )
  }

  return localStorage
}

/**
 * Where resume files live.
 *
 * The PRD specifies Vercel Blob with client-side direct upload, so the file
 * bypasses the 4.5 MB serverless request limit. That is what runs in production.
 * Locally the same interface is backed by the filesystem, so the whole flow works
 * without a cloud account. Selection is by environment variable only — no caller
 * knows which one it is talking to.
 */
export const storage: ResumeStorage = {
  put: (key, data, contentType) => activeStorage().put(key, data, contentType),
  get: (path) => activeStorage().get(path),
  delete: (path) => activeStorage().delete(path),
}

/** Which backend is active — surfaced in the admin footer so it is never a mystery. */
export const storageBackend = blobToken ? 'vercel-blob' : 'local-disk'
