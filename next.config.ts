import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * PGlite is Postgres compiled to WebAssembly. It loads its `.wasm` and data
   * files at runtime and resolves them through Node's filesystem and `URL`
   * APIs. Bundling it breaks that resolution — the bundled copy ends up with a
   * `URL` class from a different module realm, and Node rejects it with
   * "path must be of type string or an instance of Buffer or URL" on every
   * query.
   *
   * Marking it external leaves it to be required from `node_modules` at
   * runtime, which is how it expects to be loaded. Only affects the local
   * backend; production uses `pg` against Neon.
   */
  serverExternalPackages: ['@electric-sql/pglite'],
}

export default nextConfig
