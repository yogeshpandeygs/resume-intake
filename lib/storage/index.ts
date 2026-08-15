import { blobToken } from '../env'
import { blobStorage } from './blob'
import { localStorage } from './local'
import type { ResumeStorage } from './types'

export { assertSafeStorageKey } from './types'
export type { ResumeStorage } from './types'

/**
 * Where resume files live.
 *
 * The PRD specifies Vercel Blob with client-side direct upload, so the file
 * bypasses the 4.5 MB serverless request limit. That is what runs in production.
 * Locally the same interface is backed by the filesystem, so the whole flow works
 * without a cloud account. Selection is by environment variable only — no caller
 * knows which one it is talking to.
 */
export const storage: ResumeStorage = blobToken ? blobStorage : localStorage

/** Which backend is active — surfaced in the admin footer so it is never a mystery. */
export const storageBackend = blobToken ? 'vercel-blob' : 'local-disk'
