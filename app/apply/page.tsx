import { ApplyForm } from '@/components/ApplyForm'
import { ConsentNotice } from '@/components/ConsentNotice'
import { organisationName, turnstileSiteKey } from '@/lib/env'

export const metadata = {
  title: 'Apply — submit your resume',
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

export default async function ApplyPage(props: PageProps<'/apply'>) {
  const searchParams = await props.searchParams

  /**
   * `ref` is a campaign or channel tag only — for example `walkin-blr-aug` or
   * `whatsapp`. It does not identify whoever forwarded the link, so no new
   * personal data enters the system when a candidate shares it onward and the
   * consent notice needs no amendment.
   */
  const refCode = firstValue(searchParams.ref)?.slice(0, 64)

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">
          Apply to {organisationName}
        </h1>
        <p className="mt-2 text-slate-600">
          Attach your resume and we will read your details from it. Check them, add a little
          more, and you are done — there is no account to create.
        </p>
      </header>

      {/* The notice is rendered here, on the server, and handed to the form as a
          slot so the organisation and DPO names come from real configuration
          rather than the browser bundle's placeholder defaults. */}
      <ApplyForm
        siteKey={turnstileSiteKey}
        refCode={refCode}
        consentNotice={<ConsentNotice />}
      />
    </main>
  )
}
