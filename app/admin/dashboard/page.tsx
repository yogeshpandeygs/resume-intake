import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CopyInviteLink } from '@/components/CopyInviteLink'
import { isAdminAuthenticated } from '@/lib/auth/admin'
import { EXPERIENCE_BANDS, INDUSTRY_GROUPS } from '@/lib/domain/constants'
import { monthsToExpiry, toIstIso } from '@/lib/domain/dates'
import { countSubmissions, listSubmissions, parseFilters } from '@/lib/queries'
import { storageBackend } from '@/lib/storage'

export const metadata = { title: 'Submissions' }

const PAGE_SIZE = 50

/** Rebuild the current query string with one value changed. */
function withParam(params: URLSearchParams, key: string, value: string): string {
  const next = new URLSearchParams(params)
  if (value === '') next.delete(key)
  else next.set(key, value)
  next.delete('page')
  return `?${next.toString()}`
}

const DUPLICATE_LABELS: Record<string, string> = {
  none: '',
  email_match: 'Email seen before',
  name_match: 'Name seen before',
}

export default async function DashboardPage(props: PageProps<'/admin/dashboard'>) {
  if (!(await isAdminAuthenticated())) {
    redirect('/admin')
  }

  const searchParams = await props.searchParams
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === 'string') params.set(key, value)
    else if (Array.isArray(value) && value[0]) params.set(key, value[0])
  }

  const filters = parseFilters(params)
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1)

  const [rows, total] = await Promise.all([
    listSubmissions(filters, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
      sort: (params.get('sort') as 'newest' | 'oldest' | 'expiring') ?? 'newest',
    }),
    countSubmissions(filters),
  ])

  const now = new Date()
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // The export carries the exact query string in front of the admin, which is
  // what makes "what is on screen is what downloads" true.
  const exportHref = `/admin/export.csv?${params.toString()}`

  return (
    <main className="mx-auto w-full max-w-[95rem] px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Submissions</h1>
          <p className="mt-1 text-sm text-slate-600">
            {total.toLocaleString('en-IN')}{' '}
            {total === 1 ? 'record matches' : 'records match'} the current filters. This view is
            read-only.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <CopyInviteLink />
          <a
            href={exportHref}
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Export CSV
          </a>
        </div>
      </header>

      {/* Filters submit as a plain GET, so the URL is the state and the export
          link picks up exactly the same query string. */}
      <form method="GET" className="mt-6 rounded-lg border border-slate-300 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Search
            <input
              name="q"
              defaultValue={filters.q ?? ''}
              placeholder="Name, email or skill"
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Experience band
            <select
              name="band"
              defaultValue={filters.band ?? ''}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            >
              <option value="">All</option>
              {EXPERIENCE_BANDS.map((band) => (
                <option key={band} value={band}>
                  {band}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Industry group
            <select
              name="industry"
              defaultValue={filters.industry ?? ''}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            >
              <option value="">All</option>
              {INDUSTRY_GROUPS.map((industry) => (
                <option key={industry} value={industry}>
                  {industry}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Year level
            <select
              name="yearLevel"
              defaultValue={filters.yearLevel ?? 'graduation'}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            >
              <option value="graduation">Graduation</option>
              <option value="postgraduation">Post-graduation</option>
              <option value="doctoral">Doctoral</option>
            </select>
          </label>

          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
              Year from
              <input
                name="yearFrom"
                type="number"
                defaultValue={filters.yearFrom ?? ''}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-slate-700">
              to
              <input
                name="yearTo"
                type="number"
                defaultValue={filters.yearTo ?? ''}
                className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Institution
            <input
              name="institution"
              defaultValue={filters.institution ?? ''}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Campaign code
            <input
              name="refCode"
              defaultValue={filters.refCode ?? ''}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
            Sort by
            <select
              name="sort"
              defaultValue={params.get('sort') ?? 'newest'}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm font-normal"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="expiring">Expiring soonest</option>
            </select>
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900"
          >
            Apply filters
          </button>
          <Link
            href="/admin/dashboard"
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear
          </Link>
        </div>
      </form>

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full min-w-[70rem] text-left text-sm">
          <caption className="sr-only">
            Candidate submissions matching the current filters
          </caption>
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-3 py-2">Reference</th>
              <th scope="col" className="px-3 py-2">Name</th>
              <th scope="col" className="px-3 py-2">Band</th>
              <th scope="col" className="px-3 py-2">Industry</th>
              <th scope="col" className="px-3 py-2">Function</th>
              <th scope="col" className="px-3 py-2">Institution</th>
              <th scope="col" className="px-3 py-2">Year</th>
              <th scope="col" className="px-3 py-2">Submitted</th>
              <th scope="col" className="px-3 py-2">Expires in</th>
              <th scope="col" className="px-3 py-2">Flag</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-slate-500">
                  No submissions match these filters.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const months = monthsToExpiry(row.retentionExpiryDate, now)
              return (
                <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link className="text-blue-700 underline" href={`/admin/s/${row.id}`}>
                      {row.submissionId}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {row.firstName} {row.lastName}
                    <span className="block text-xs text-slate-500">{row.email}</span>
                  </td>
                  <td className="px-3 py-2">{row.experienceBand}</td>
                  <td className="px-3 py-2">{row.industryGroup}</td>
                  <td className="px-3 py-2">{row.organisationFunction}</td>
                  <td className="px-3 py-2">{row.graduationInstitution}</td>
                  <td className="px-3 py-2">{row.graduationYear}</td>
                  <td className="px-3 py-2 text-xs">{toIstIso(row.submittedAt).slice(0, 10)}</td>
                  <td className="px-3 py-2">
                    <span className={months <= 1 ? 'font-semibold text-red-700' : ''}>
                      {months} mo
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-amber-800">
                    {DUPLICATE_LABELS[row.duplicateFlag]}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
          <span className="text-slate-600">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
                href={withParam(params, 'page', String(page - 1))}
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
                href={withParam(params, 'page', String(page + 1))}
              >
                Next
              </Link>
            )}
          </div>
        </nav>
      )}

      <footer className="mt-8 text-xs text-slate-500">
        Resume storage: {storageBackend}. Every CSV export is logged with its filters and row
        count.
      </footer>
    </main>
  )
}
