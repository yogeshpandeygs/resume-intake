'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Field, inputClass, WordCounter } from './form-controls'
import { InstitutionInput } from './InstitutionInput'
import { Turnstile } from './Turnstile'
import {
  ACHIEVEMENTS_MAX_WORDS,
  EARLIEST_GRADUATION_YEAR,
  EXPERIENCE_SUMMARY_MAX_WORDS,
  FRESHERS,
  INDUSTRY_GROUPS,
  MAX_RESUME_SIZE_KB,
  ORGANISATION_FUNCTIONS,
} from '@/lib/domain/constants'
import type { ParseMethod } from '@/lib/domain/constants'

/**
 * The application form.
 *
 * Two stages on one page: attach a resume, then review the details read out of
 * it. The second stage is always editable and always reachable — if parsing
 * fails, or the file is a legacy `.doc` we cannot read, the candidate simply gets
 * an empty form rather than a dead end. Nothing already typed is lost when a
 * different file is attached.
 */

interface FormState {
  firstName: string
  lastName: string
  email: string
  phone: string
  highestQualification: string
  graduationInstitution: string
  graduationYear: string
  postgraduationInstitution: string
  postgraduationYear: string
  doctoralInstitution: string
  doctoralYear: string
  currentLocation: string
  currentOrganisation: string
  designation: string
  currentRoleStartDate: string
  organisationFunction: string
  totalYearsExperience: string
  industryGroup: string
  experienceSummary: string
  keySkills: string
  achievementsCertifications: string
}

const EMPTY_FORM: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  highestQualification: '',
  graduationInstitution: '',
  graduationYear: '',
  postgraduationInstitution: '',
  postgraduationYear: '',
  doctoralInstitution: '',
  doctoralYear: '',
  currentLocation: '',
  currentOrganisation: '',
  designation: '',
  currentRoleStartDate: '',
  organisationFunction: '',
  totalYearsExperience: '',
  industryGroup: '',
  experienceSummary: '',
  keySkills: '',
  achievementsCertifications: '',
}

interface UploadInfo {
  path: string
  filename: string
  sizeKb: number
}

/** Shapes returned by the API routes. Every field optional: a crashed or
 *  proxy-truncated response may carry none of them. */
interface UploadResponseBody {
  path?: string
  filename?: string
  sizeKb?: number
  error?: string
}

interface ParseResponseBody {
  parseMethod?: ParseMethod
  prefill?: Record<string, unknown>
  notice?: string
  extractionNotes?: string
  error?: string
}

export function ApplyForm({
  siteKey,
  refCode,
  consentNotice,
}: {
  siteKey: string
  refCode?: string
  /**
   * The DPDP notice, rendered on the server and passed in as a slot.
   *
   * It names the Data Fiduciary and the DPO from environment configuration,
   * which is not present in the browser bundle. Rendering it inside this client
   * component would hydrate those values to their placeholder defaults, quietly
   * showing the candidate the wrong organisation on the notice they are
   * consenting to.
   */
  consentNotice: ReactNode
}) {
  const router = useRouter()

  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [upload, setUpload] = useState<UploadInfo | undefined>()
  const [parseMethod, setParseMethod] = useState<ParseMethod>('manual')
  const [notice, setNotice] = useState<string | undefined>()
  const [consent, setConsent] = useState(false)
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>()

  /**
   * What the parse actually wrote into the form.
   *
   * Kept so that removing the attachment can clear the values it filled in while
   * leaving anything the candidate typed or corrected untouched — a field is only
   * cleared if it still holds exactly what the parse put there.
   */
  const [appliedPrefill, setAppliedPrefill] = useState<Partial<FormState>>({})

  const [uploadState, setUploadState] = useState<
    'idle' | 'uploading' | 'parsing' | 'removing' | 'ready'
  >('idle')
  const [uploadError, setUploadError] = useState<string | undefined>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const errorSummaryRef = useRef<HTMLDivElement>(null)

  const isFresher = form.organisationFunction === FRESHERS
  const maxYear = useMemo(() => new Date().getFullYear() + 1, [])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    // Clear the error as soon as the candidate starts fixing the field.
    setFieldErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  /**
   * Read a JSON body without assuming there is one.
   *
   * A crashed or misconfigured server answers with an HTML error page, and a
   * platform-level rejection (a body over the host's request limit) may send no
   * body at all. Calling `.json()` on either throws, which previously surfaced as
   * a generic "something went wrong" that said nothing about the real cause.
   */
  async function readJson<T extends object>(response: Response): Promise<T> {
    const text = await response.text().catch(() => '')
    try {
      return text ? (JSON.parse(text) as T) : ({} as T)
    } catch {
      return {} as T
    }
  }

  function describeFailure(response: Response, body: { error?: string }): string {
    if (typeof body.error === 'string') return body.error
    if (response.status === 413) {
      return 'That file is too large to upload. Please use a file under 5 MB.'
    }
    if (response.status >= 500) {
      return `The server could not accept the upload (error ${response.status}). This usually means the application is missing configuration. Please contact us if it continues.`
    }
    return `That file could not be uploaded (error ${response.status}).`
  }

  async function handleFile(file: File) {
    setUploadError(undefined)
    setNotice(undefined)
    setUploadState('uploading')

    try {
      const body = new FormData()
      body.set('file', file)
      const uploadResponse = await fetch('/api/upload', { method: 'POST', body })
      const uploadBody = await readJson<UploadResponseBody>(uploadResponse)

      if (!uploadResponse.ok) {
        setUploadError(describeFailure(uploadResponse, uploadBody))
        setUploadState('idle')
        return
      }

      // A 200 that is missing these means something between us and the route
      // rewrote the response. Treat it as a failure rather than carrying an
      // undefined path into the submit step.
      if (!uploadBody.path || !uploadBody.filename) {
        setUploadError('The upload did not complete correctly. Please try again.')
        setUploadState('idle')
        return
      }

      setUpload({
        path: uploadBody.path,
        filename: uploadBody.filename,
        sizeKb: uploadBody.sizeKb ?? 0,
      })
      setUploadState('parsing')

      const parseResponse = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: uploadBody.path }),
      })
      const parseBody = await readJson<ParseResponseBody>(parseResponse)

      if (!parseResponse.ok) {
        // The file is stored and usable; only the automatic reading failed, so
        // the candidate continues with an empty form rather than starting over.
        setUploadError(
          typeof parseBody.error === 'string'
            ? parseBody.error
            : 'We could not read that file automatically. Please fill in the details below.',
        )
        setParseMethod('manual')
        setUploadState('ready')
        return
      }

      setParseMethod(parseBody.parseMethod ?? 'manual')
      setNotice(parseBody.notice)

      // Merge rather than replace: anything already typed wins over the parse.
      const applied: Partial<FormState> = {}
      setForm((current) => {
        const next = { ...current }
        for (const [key, value] of Object.entries(parseBody.prefill ?? {})) {
          if (value === undefined || value === null || value === '') continue
          const field = key as keyof FormState
          if (next[field] === '') {
            next[field] = String(value)
            applied[field] = String(value)
          }
        }
        return next
      })
      setAppliedPrefill(applied)
      setUploadState('ready')
    } catch {
      setUploadError('Something went wrong uploading your file. Please try again.')
      setUploadState('idle')
    }
  }

  /**
   * Detach the current resume.
   *
   * Removes the stored file, then clears any field the parse filled in that the
   * candidate has not since changed. Anything they typed themselves stays — a
   * candidate who attached the wrong file should not lose the work of correcting
   * it, and the PRD is explicit that retrying must not cost them what they have
   * already entered.
   */
  async function handleRemove() {
    if (!upload || submitting) return

    setUploadState('removing')
    setUploadError(undefined)

    try {
      await fetch('/api/upload', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: upload.path }),
      })
    } catch {
      // The file is orphaned at worst, and the daily sweep collects it. Detaching
      // in the interface should not fail because the network did.
    }

    setForm((current) => {
      const next = { ...current }
      for (const [key, filledValue] of Object.entries(appliedPrefill)) {
        const field = key as keyof FormState
        // Untouched since the parse wrote it, so it belongs to the removed file.
        if (next[field] === filledValue) next[field] = ''
      }
      return next
    })

    setAppliedPrefill({})
    setUpload(undefined)
    setParseMethod('manual')
    setNotice(undefined)
    setFieldErrors({})
    setUploadState('idle')

    // Clear the input so re-selecting the same file still fires a change event.
    if (fileInputRef.current) fileInputRef.current.value = ''
    fileInputRef.current?.focus()
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting) return

    setFormError(undefined)
    setFieldErrors({})

    if (!upload) {
      setFormError('Please attach your resume before submitting.')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uploadPath: upload.path,
          parseMethod,
          turnstileToken,
          refCode,
          form: {
            ...form,
            graduationYear: form.graduationYear ? Number(form.graduationYear) : undefined,
            postgraduationYear: form.postgraduationYear
              ? Number(form.postgraduationYear)
              : undefined,
            doctoralYear: form.doctoralYear ? Number(form.doctoralYear) : undefined,
            totalYearsExperience: form.totalYearsExperience
              ? Number(form.totalYearsExperience)
              : undefined,
            consent,
          },
        }),
      })

      const body = await response.json()

      if (!response.ok) {
        setFormError(body.error ?? 'Your application could not be submitted.')
        if (body.fieldErrors) setFieldErrors(body.fieldErrors)
        // Turnstile tokens are single-use; force a fresh one for the retry.
        setTurnstileToken(undefined)
        errorSummaryRef.current?.focus()
        return
      }

      const params = new URLSearchParams({ ref: body.submissionId })
      if (refCode) params.set('code', refCode)
      router.push(`/apply/done?${params.toString()}`)
    } catch {
      setFormError('Something went wrong. Please check your connection and try again.')
      errorSummaryRef.current?.focus()
    } finally {
      setSubmitting(false)
    }
  }

  const busy =
    uploadState === 'uploading' || uploadState === 'parsing' || uploadState === 'removing'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8" noValidate>
      {/* ---------------------------------------------------------- Resume */}
      <section className="rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Your resume</h2>
        <p className="mt-1 text-sm text-slate-600">
          PDF, DOCX or DOC, up to {Math.round(MAX_RESUME_SIZE_KB / 1024)} MB. We read your
          details from it so you only have to check them.
        </p>

        {/* Hidden once a file is attached: the attachment row below takes over,
            so there is one obvious control rather than two competing ones. */}
        {!upload && (
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.doc"
            className="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-800"
            disabled={busy || submitting}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
        )}

        {upload && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm text-slate-700">
              <span aria-hidden="true">📄</span>{' '}
              <strong className="font-medium">{upload.filename}</strong>{' '}
              <span className="text-slate-500">({upload.sizeKb} KB)</span>
            </p>
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy || submitting}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-300 disabled:text-slate-500"
            >
              {uploadState === 'removing' ? 'Removing…' : 'Remove'}
            </button>
          </div>
        )}

        <div aria-live="polite" className="mt-3 text-sm">
          {uploadState === 'uploading' && <p className="text-slate-600">Uploading…</p>}
          {uploadState === 'parsing' && (
            <p className="text-slate-600">Reading your resume — this can take a few seconds.</p>
          )}
          {uploadState === 'removing' && (
            <p className="text-slate-600">Removing your attachment…</p>
          )}
          {upload && uploadState === 'ready' && (
            <p className="text-slate-600">
              Attached. To use a different file, remove this one first.
            </p>
          )}
          {uploadError && <p className="font-medium text-red-700">{uploadError}</p>}
          {notice && <p className="text-amber-800">{notice}</p>}
        </div>
      </section>

      {/* ------------------------------------------------------ Your details */}
      <section className="rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Your details</h2>
        <p className="mt-1 text-sm text-slate-600">
          Please check everything below and correct anything we have read incorrectly.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="First name" required error={fieldErrors.firstName}>
            {(props) => (
              <input
                {...props}
                className={inputClass}
                autoComplete="given-name"
                value={form.firstName}
                onChange={(e) => set('firstName', e.target.value)}
              />
            )}
          </Field>

          <Field label="Last name" required error={fieldErrors.lastName}>
            {(props) => (
              <input
                {...props}
                className={inputClass}
                autoComplete="family-name"
                value={form.lastName}
                onChange={(e) => set('lastName', e.target.value)}
              />
            )}
          </Field>

          <Field label="Email" required error={fieldErrors.email}>
            {(props) => (
              <input
                {...props}
                type="email"
                className={inputClass}
                autoComplete="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Phone"
            required
            error={fieldErrors.phone}
            hint="Include your country code, for example +91 98765 43210."
          >
            {(props) => (
              <input
                {...props}
                type="tel"
                className={inputClass}
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
              />
            )}
          </Field>

          <Field label="Current location" required error={fieldErrors.currentLocation}>
            {(props) => (
              <input
                {...props}
                className={inputClass}
                value={form.currentLocation}
                onChange={(e) => set('currentLocation', e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Highest qualification"
            required
            error={fieldErrors.highestQualification}
            hint="For example B.Tech, MBA, PhD."
          >
            {(props) => (
              <input
                {...props}
                className={inputClass}
                value={form.highestQualification}
                onChange={(e) => set('highestQualification', e.target.value)}
              />
            )}
          </Field>
        </div>
      </section>

      {/* -------------------------------------------------------- Education */}
      <section className="rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Education</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Graduation institution" required error={fieldErrors.graduationInstitution}>
              {(props) => (
                <InstitutionInput
                  {...props}
                  value={form.graduationInstitution}
                  onChange={(v) => set('graduationInstitution', v)}
                />
              )}
            </Field>
          </div>
          <Field label="Year of passing" required error={fieldErrors.graduationYear}>
            {(props) => (
              <input
                {...props}
                type="number"
                inputMode="numeric"
                min={EARLIEST_GRADUATION_YEAR}
                max={maxYear}
                className={inputClass}
                value={form.graduationYear}
                onChange={(e) => set('graduationYear', e.target.value)}
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Post-graduation institution"
              error={fieldErrors.postgraduationInstitution}
              hint="Leave blank if this does not apply."
            >
              {(props) => (
                <InstitutionInput
                  {...props}
                  value={form.postgraduationInstitution}
                  onChange={(v) => set('postgraduationInstitution', v)}
                />
              )}
            </Field>
          </div>
          <Field
            label="Year of passing"
            required={form.postgraduationInstitution.trim() !== ''}
            error={fieldErrors.postgraduationYear}
          >
            {(props) => (
              <input
                {...props}
                type="number"
                inputMode="numeric"
                min={EARLIEST_GRADUATION_YEAR}
                max={maxYear}
                className={inputClass}
                value={form.postgraduationYear}
                onChange={(e) => set('postgraduationYear', e.target.value)}
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <Field
              label="Doctoral (PhD) institution"
              error={fieldErrors.doctoralInstitution}
              hint="Leave blank if this does not apply."
            >
              {(props) => (
                <InstitutionInput
                  {...props}
                  value={form.doctoralInstitution}
                  onChange={(v) => set('doctoralInstitution', v)}
                />
              )}
            </Field>
          </div>
          <Field
            label="Year of passing"
            required={form.doctoralInstitution.trim() !== ''}
            error={fieldErrors.doctoralYear}
          >
            {(props) => (
              <input
                {...props}
                type="number"
                inputMode="numeric"
                min={EARLIEST_GRADUATION_YEAR}
                max={maxYear}
                className={inputClass}
                value={form.doctoralYear}
                onChange={(e) => set('doctoralYear', e.target.value)}
              />
            )}
          </Field>
        </div>
      </section>

      {/* ------------------------------------------------------- Experience */}
      <section className="rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="text-base font-semibold text-slate-900">Experience</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Organisation function" required error={fieldErrors.organisationFunction}>
            {(props) => (
              <select
                {...props}
                className={inputClass}
                value={form.organisationFunction}
                onChange={(e) => set('organisationFunction', e.target.value)}
              >
                <option value="">Select…</option>
                {ORGANISATION_FUNCTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Industry group" required error={fieldErrors.industryGroup}>
            {(props) => (
              <select
                {...props}
                className={inputClass}
                value={form.industryGroup}
                onChange={(e) => set('industryGroup', e.target.value)}
              >
                <option value="">Select…</option>
                {INDUSTRY_GROUPS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Total years of experience"
            required
            error={fieldErrors.totalYearsExperience}
            hint="To one decimal place, for example 8.5."
          >
            {(props) => (
              <input
                {...props}
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                className={inputClass}
                value={form.totalYearsExperience}
                onChange={(e) => set('totalYearsExperience', e.target.value)}
              />
            )}
          </Field>

          {!isFresher && (
            <>
              <Field
                label="Current organisation"
                required
                error={fieldErrors.currentOrganisation}
              >
                {(props) => (
                  <input
                    {...props}
                    className={inputClass}
                    value={form.currentOrganisation}
                    onChange={(e) => set('currentOrganisation', e.target.value)}
                  />
                )}
              </Field>

              <Field label="Designation" required error={fieldErrors.designation}>
                {(props) => (
                  <input
                    {...props}
                    className={inputClass}
                    value={form.designation}
                    onChange={(e) => set('designation', e.target.value)}
                  />
                )}
              </Field>

              <Field
                label="Start date of current role"
                required
                error={fieldErrors.currentRoleStartDate}
              >
                {(props) => (
                  <input
                    {...props}
                    type="date"
                    className={inputClass}
                    value={form.currentRoleStartDate}
                    onChange={(e) => set('currentRoleStartDate', e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </div>

        {isFresher && (
          <p className="mt-3 rounded-md bg-slate-100 p-3 text-sm text-slate-700">
            You have selected {FRESHERS}, so we will not ask for your current employer.
          </p>
        )}

        <div className="mt-4 grid gap-4">
          <Field
            label="Experience summary"
            required
            error={fieldErrors.experienceSummary}
            hint={
              <WordCounter value={form.experienceSummary} limit={EXPERIENCE_SUMMARY_MAX_WORDS} />
            }
          >
            {(props) => (
              <textarea
                {...props}
                rows={4}
                className={inputClass}
                value={form.experienceSummary}
                onChange={(e) => set('experienceSummary', e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Key skills"
            required
            error={fieldErrors.keySkills}
            hint="Separate each skill with a semicolon, for example Python; SQL; Airflow."
          >
            {(props) => (
              <textarea
                {...props}
                rows={2}
                className={inputClass}
                value={form.keySkills}
                onChange={(e) => set('keySkills', e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Key achievements and certifications"
            error={fieldErrors.achievementsCertifications}
            hint={
              <WordCounter
                value={form.achievementsCertifications}
                limit={ACHIEVEMENTS_MAX_WORDS}
              />
            }
          >
            {(props) => (
              <textarea
                {...props}
                rows={4}
                className={inputClass}
                value={form.achievementsCertifications}
                onChange={(e) => set('achievementsCertifications', e.target.value)}
              />
            )}
          </Field>
        </div>
      </section>

      {/* ----------------------------------------------------------- Consent */}
      {consentNotice}

      <div className="rounded-lg border border-slate-300 bg-white p-5">
        <label className="flex items-start gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          <span>
            I have read the notice above and I consent to the processing of my personal data for
            the purposes stated at (a) and (b).
          </span>
        </label>
        {fieldErrors.consent && (
          <p className="mt-2 text-xs font-medium text-red-700">{fieldErrors.consent}</p>
        )}

        <Turnstile siteKey={siteKey} onToken={setTurnstileToken} />

        <div
          ref={errorSummaryRef}
          tabIndex={-1}
          aria-live="assertive"
          className="mt-3 empty:hidden"
        >
          {formError && (
            <p className="rounded-md bg-red-50 p-3 text-sm font-medium text-red-800">
              {formError}
            </p>
          )}
        </div>

        <button
          type="submit"
          // Consent gates submission, exactly as the notice says it does.
          disabled={submitting || busy || !consent || !upload}
          className="mt-4 rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600"
        >
          {submitting ? 'Submitting…' : 'Submit application'}
        </button>

        {!consent && (
          <p className="mt-2 text-xs text-slate-500">
            Tick the box above to enable submission.
          </p>
        )}
      </div>
    </form>
  )
}
