/**
 * The storage contract, kept separate from the module that selects a backend so
 * that the implementations can depend on it without a cycle.
 */
export interface ResumeStorage {
  /** Store bytes under `key` and return the path recorded on the submission. */
  put(key: string, data: Uint8Array, contentType: string): Promise<{ path: string }>
  /** Read the file back. Only ever called from the authenticated admin download route. */
  get(path: string): Promise<Uint8Array>
  /** Remove the file. Used by withdrawal, the expiry sweep and the orphan sweep. */
  delete(path: string): Promise<void>
}

/**
 * Storage keys are generated server-side, never taken from the client. This guards
 * the boundary anyway: a path that escaped the storage root would let the download
 * route read arbitrary files.
 */
export function assertSafeStorageKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) || key.includes('..')) {
    throw new Error('Unsafe storage key')
  }
}
