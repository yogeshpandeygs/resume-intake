import { CONSENT_NOTICE_VERSION } from '@/lib/domain/constants'
import { dpoEmail, organisationName } from '@/lib/env'

/**
 * The DPDP consent notice.
 *
 * Reproduces the notice from the PRD appendix. It stands alone — it is not
 * bundled with any other agreement — and the checkbox that accompanies it is
 * unticked by default, with submission blocked until it is ticked.
 *
 * `CONSENT_NOTICE_VERSION` is recorded against every submission, so the exact
 * wording a candidate agreed to can be identified later. Change the text here and
 * you must bump that constant.
 */
export function ConsentNotice() {
  return (
    <section
      aria-labelledby="consent-notice-heading"
      className="rounded-lg border border-slate-300 bg-white p-5 text-sm leading-relaxed text-slate-700"
    >
      <h2 id="consent-notice-heading" className="text-base font-semibold text-slate-900">
        Notice
      </h2>

      <p className="mt-3">
        {organisationName} is the Data Fiduciary for this application.
      </p>

      <p className="mt-3">
        <strong className="font-medium text-slate-900">
          Personal data we collect from you:
        </strong>{' '}
        name, email address, phone number, highest qualification, the institutions you
        studied at and your years of passing, current location, current organisation,
        designation, start date of current role, total years of experience, industry group,
        organisation function, key skills, your experience summary, your achievements and
        certifications, and the resume file you upload.
      </p>

      <p className="mt-3">
        <strong className="font-medium text-slate-900">
          Purposes for which we will process it:
        </strong>
      </p>
      <ol className="mt-1 list-inside space-y-1 pl-1">
        <li>
          (a) to assess your suitability for current and future openings at{' '}
          {organisationName}, and to contact you about them; and
        </li>
        <li>
          (b) to maintain your details on our talent database and share them with
          organisations within {organisationName}&rsquo;s network of clients, so that you may
          be considered for suitable opportunities with them.
        </li>
      </ol>

      <p className="mt-3">
        <strong className="font-medium text-slate-900">How long we keep it:</strong> 36 months
        from the date of your submission. We will write to you 30 days before that date so you
        may renew your consent. If you do not renew, your details are erased.
      </p>

      <p className="mt-3">
        <strong className="font-medium text-slate-900">Your rights:</strong> you may withdraw
        your consent at any time using the link in your confirmation email, and may seek access
        to, correction of, or erasure of your personal data by writing to{' '}
        <a className="text-blue-700 underline" href={`mailto:${dpoEmail}`}>
          {dpoEmail}
        </a>
        . Withdrawal is as easy as giving consent. You may make a complaint to the Data
        Protection Board of India.
      </p>

      <p className="mt-4 text-xs text-slate-500">Notice version {CONSENT_NOTICE_VERSION}</p>
    </section>
  )
}
