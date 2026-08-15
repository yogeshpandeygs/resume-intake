import Link from 'next/link'
import { ShareButtons } from '@/components/ShareButtons'
import { RETENTION_MONTHS } from '@/lib/domain/constants'
import { appBaseUrl, organisationName, recruitmentEmail } from '@/lib/env'

export const metadata = {
  title: 'Application received',
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function DonePage(props: PageProps<'/apply/done'>) {
  const searchParams = await props.searchParams
  const submissionId = firstValue(searchParams.ref)
  const campaignCode = firstValue(searchParams.code)

  const shareUrl = campaignCode
    ? `${appBaseUrl.replace(/\/$/, '')}/apply?ref=${encodeURIComponent(campaignCode)}`
    : `${appBaseUrl.replace(/\/$/, '')}/apply`

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <div className="rounded-lg border border-green-300 bg-green-50 p-6">
        <h1 className="text-2xl font-semibold text-green-900">Application received</h1>
        {submissionId && (
          <p className="mt-3 text-green-900">
            Your reference is{' '}
            <strong className="font-mono font-semibold">{submissionId}</strong>. Please keep it
            for your records.
          </p>
        )}
        <p className="mt-3 text-sm text-green-900">
          We have emailed you a confirmation. It contains a link you can use at any time to
          withdraw your consent and erase your details.
        </p>
      </div>

      <section className="mt-8 rounded-lg border border-slate-300 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">What happens next</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
          <li>
            Our hiring team will review your details against current openings at{' '}
            {organisationName}.
          </li>
          <li>
            We will keep your details for {RETENTION_MONTHS} months so you can be considered for
            future roles, including with organisations in our client network.
          </li>
          <li>
            Thirty days before that period ends we will write to you so you can renew your
            consent. If you do not renew, your details are erased.
          </li>
          <li>
            Questions about your application? Write to{' '}
            <a className="text-blue-700 underline" href={`mailto:${recruitmentEmail}`}>
              {recruitmentEmail}
            </a>
            .
          </li>
        </ul>
      </section>

      <section className="mt-8 rounded-lg border border-slate-300 bg-white p-6">
        <h2 className="text-base font-semibold text-slate-900">Share with your network</h2>
        <p className="mt-1 text-sm text-slate-600">
          Know someone who would be a good fit? Pass this link on — anyone can apply with it.
        </p>
        <div className="mt-4">
          <ShareButtons
            shareUrl={shareUrl}
            message={`I just applied to ${organisationName} — you might be a good fit too.`}
          />
        </div>
        <p className="mt-3 break-all text-xs text-slate-500">{shareUrl}</p>
      </section>

      <p className="mt-8 text-center text-sm">
        <Link className="text-blue-700 underline" href="/apply">
          Submit another application
        </Link>
      </p>
    </main>
  )
}
