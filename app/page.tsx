import { redirect } from 'next/navigation'

/**
 * There is no separate landing page: the application form is the product. Anyone
 * arriving at the root is sent straight to it, preserving a campaign code if one
 * was appended.
 */
export default async function Home(props: PageProps<'/'>) {
  const searchParams = await props.searchParams
  const ref = Array.isArray(searchParams.ref) ? searchParams.ref[0] : searchParams.ref

  redirect(ref ? `/apply?ref=${encodeURIComponent(ref)}` : '/apply')
}
