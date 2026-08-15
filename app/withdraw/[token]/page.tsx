import { WithdrawActions } from '@/components/WithdrawActions'
import { findByWithdrawalToken } from '@/lib/consent'
import { dpoEmail, organisationName } from '@/lib/env'

export const metadata = {
  title: 'Your details',
}

/**
 * The tokenised consent page.
 *
 * Rendering this page is a read: it looks the record up and shows the candidate
 * what we hold, but changes nothing. Both actions are POSTs from the client
 * component, so a link preview or mail scanner fetching the URL cannot erase
 * anyone's record.
 */
export default async function WithdrawPage(props: PageProps<'/withdraw/[token]'>) {
  const { token } = await props.params
  const submission = await findByWithdrawalToken(token)

  if (!submission) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 py-16">
        <div className="rounded-lg border border-slate-300 bg-white p-6">
          <h1 className="text-xl font-semibold text-slate-900">This link is no longer valid</h1>
          <p className="mt-3 text-sm text-slate-600">
            It may have already been used, or the record may have been erased. If your details
            were erased, nothing further is needed.
          </p>
          <p className="mt-3 text-sm text-slate-600">
            If you think this is a mistake, write to{' '}
            <a className="text-blue-700 underline" href={`mailto:${dpoEmail}`}>
              {dpoEmail}
            </a>
            .
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">
        Your details at {organisationName}
      </h1>
      <p className="mt-2 text-slate-600">
        Application <span className="font-mono">{submission.submissionId}</span>, submitted by{' '}
        {submission.firstName} {submission.lastName}.
      </p>

      <div className="mt-6">
        <WithdrawActions
          token={token}
          retentionExpiryDate={submission.retentionExpiryDate}
        />
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Withdrawal is as easy as giving consent. You may also seek access to, or correction of,
        your personal data by writing to{' '}
        <a className="text-blue-700 underline" href={`mailto:${dpoEmail}`}>
          {dpoEmail}
        </a>
        , and you may complain to the Data Protection Board of India.
      </p>
    </main>
  )
}
