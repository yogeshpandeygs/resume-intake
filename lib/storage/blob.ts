import { del, head, put } from '@vercel/blob'
import { blobToken } from '../env'
import { assertSafeStorageKey, type ResumeStorage } from './types'

/**
 * Vercel Blob storage — the production backend from the PRD.
 *
 * `path` here is the blob's full URL. It is stored on the submission but never
 * exported: it is an unauthenticated permanent link to a CV, so admins reach the
 * file through the authenticated download route instead.
 */
export const blobStorage: ResumeStorage = {
  async put(key, data, contentType) {
    assertSafeStorageKey(key)
    const result = await put(key, data as unknown as Blob | ArrayBuffer, {
      access: 'public',
      contentType,
      token: blobToken,
      // Keys already carry a random component; without this the SDK would add
      // a second one and the returned path would not match what we generated.
      addRandomSuffix: false,
    })
    return { path: result.url }
  },

  async get(path) {
    // Confirm the blob belongs to this store before fetching, so a tampered
    // `resume_blob_path` cannot turn the download route into a general fetcher.
    await head(path, { token: blobToken })
    const response = await fetch(path)
    if (!response.ok) {
      throw new Error(`Could not read resume from blob storage (${response.status})`)
    }
    return new Uint8Array(await response.arrayBuffer())
  },

  async delete(path) {
    await del(path, { token: blobToken })
  },
}
