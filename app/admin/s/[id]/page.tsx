import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { isAdminAuthenticated } from '@/lib/auth/admin'
import { monthsToExpiry, toIstIso } from '@/lib/domain/dates'
import { findSubmissionById } from '@/lib/queries'

export const metadata = { title: 'Submission' }

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="grid grid-cols-1 gap-1 border-b border-slate-100 py-3 last:border-0 sm:grid-cols-3">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="text-sm text-slate-900 sm:col-span-2">{value}</dd>
    </div>
  )
}

/**
 * Read-only record view.
 *
 * There is no edit affordance here, and there is no route that would accept one:
 * the admin session is issued read-only scope and every admin route refuses
 * mutating methods.
 */
export default async function SubmissionPage(props: PageProps<'/admin/s/[id]'>) {
  if (!(await isAdminAuthenticated())) {
    redirect('/admin')
  }

  const { id } = await props.params
  const s = await findSubmissionById(id)
  if (!s) notFound()

  const months = monthsToExpiry(s.retentionExpiryDate, new Date())

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link className="text-sm text-blue-700 underline" href="/admin/dashboard">
        ← Back to submissions
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            {s.firstName} {s.lastName}
          </h1>
          <p className="mt-1 font-mono text-sm text-slate-600">{s.submissionId}</p>
        </div>
        <a
          href={`/api/admin/resume/${s.id}`}
          className="rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800"
        >
          Download resume
        </a>
      </header>

      {s.duplicateFlag !== 'none' && (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          {s.duplicateFlag === 'email_match'
            ? 'This email address appears on an earlier submission.'
            : 'This name appears on an earlier submission.'}
        </p>
      )}

      <section className="mt-6 rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="mb-2 text-base font-semibold text-slate-900">Contact</h2>
        <dl>
          <Row label="Email" value={s.email} />
          <Row label="Phone" value={s.phone} />
          <Row label="Current location" value={s.currentLocation} />
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="mb-2 text-base font-semibold text-slate-900">Education</h2>
        <dl>
          <Row label="Highest qualification" value={s.highestQualification} />
          <Row
            label="Graduation"
            value={`${s.graduationInstitution} (${s.graduationYear})`}
          />
          <Row
            label="Post-graduation"
            value={
              s.postgraduationInstitution
                ? `${s.postgraduationInstitution} (${s.postgraduationYear ?? '—'})`
                : null
            }
          />
          <Row
            label="Doctoral"
            value={
              s.doctoralInstitution
                ? `${s.doctoralInstitution} (${s.doctoralYear ?? '—'})`
                : null
            }
          />
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="mb-2 text-base font-semibold text-slate-900">Experience</h2>
        <dl>
          <Row label="Current organisation" value={s.currentOrganisation} />
          <Row label="Designation" value={s.designation} />
          <Row label="Started current role" value={s.currentRoleStartDate} />
          <Row label="Organisation function" value={s.organisationFunction} />
          <Row
            label="Total experience"
            value={`${s.totalYearsExperience.toFixed(1)} years — ${s.experienceBand}`}
          />
          <Row label="Industry group" value={s.industryGroup} />
          <Row label="Summary" value={<p className="whitespace-pre-wrap">{s.experienceSummary}</p>} />
          <Row label="Key skills" value={s.keySkills} />
          <Row
            label="Achievements and certifications"
            value={
              s.achievementsCertifications ? (
                <p className="whitespace-pre-wrap">{s.achievementsCertifications}</p>
              ) : null
            }
          />
        </dl>
      </section>

      <section className="mt-6 rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="mb-2 text-base font-semibold text-slate-900">Record</h2>
        <dl>
          <Row label="Submitted" value={toIstIso(s.submittedAt)} />
          <Row label="Resume file" value={`${s.resumeFilename} (${s.resumeSizeKb} KB)`} />
          <Row
            label="Read by"
            value={
              s.parseMethod === 'text'
                ? 'Text extraction'
                : s.parseMethod === 'vision'
                  ? 'Scanned document, read visually'
                  : 'Entered manually by the candidate'
            }
          />
          <Row label="Campaign code" value={s.refCode} />
          <Row label="Consent given" value={toIstIso(s.consentTimestamp)} />
          <Row label="Consent notice version" value={s.consentNoticeVersion} />
          <Row
            label="Retention"
            value={`Erased on ${s.retentionExpiryDate} — ${months} month${months === 1 ? '' : 's'} remaining`}
          />
          <Row
            label="Consent renewed"
            value={s.renewedAt ? toIstIso(s.renewedAt) : null}
          />
        </dl>
      </section>
    </main>
  )
}
