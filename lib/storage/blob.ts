import { del, get, put } from '@vercel/blob'
import { blobToken } from '../env'
import { assertSafeStorageKey, type ResumeStorage } from './types'

/**
 * Vercel Blob storage — the production backend from the PRD.
 *
 * **Blobs are private.** A public blob is readable by anyone who has its URL,
 * forever, with no authentication — for a store holding candidate CVs that is a
 * standing personal-data leak, and one URL in a log or a referrer header is
 * enough to expose it. Under a private store the URL alone grants nothing;
 * reading requires the store token, which only the server has.
 *
 * `path` is still the blob's URL, and is still never exported: it identifies a
 * real person's CV, and admins reach the file through the authenticated download
 * route regardless.
 */
export const blobStorage: ResumeStorage = {
  async put(key, data, contentType) {
    assertSafeStorageKey(key)
    // `Buffer`, not the `Uint8Array` we are handed: the SDK's `PutBody` accepts
    // the former and not the latter. This used to be an `as unknown as` cast,
    // which compiled by lying about the type and would have hidden a genuine
    // mismatch if the SDK ever tightened what it accepts at runtime.
    const result = await put(key, Buffer.from(data), {
      access: 'private',
      contentType,
      token: blobToken,
      // Keys already carry a random component; without this the SDK would add
      // a second one and the returned path would not match what we generated.
      addRandomSuffix: false,
    })
    return { path: result.url }
  },

  async get(path) {
    // The token scopes this to our own store, so a tampered `resume_blob_path`
    // cannot turn the admin download route into a general-purpose fetcher.
    const result = await get(path, { access: 'private', token: blobToken })

    // `null` is "no such blob"; a 304 carries no body. Neither can be served.
    if (!result || result.statusCode !== 200) {
      throw new Error('Could not read resume from blob storage.')
    }

    return new Uint8Array(await new Response(result.stream).arrayBuffer())
  },

  async delete(path) {
    await del(path, { token: blobToken })
  },
}
