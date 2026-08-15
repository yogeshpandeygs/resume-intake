import { redirect } from 'next/navigation'
import { AdminLoginForm } from '@/components/AdminLoginForm'
import { isAdminAuthenticated } from '@/lib/auth/admin'

export const metadata = {
  title: 'Admin sign in',
}

export default async function AdminLoginPage() {
  if (await isAdminAuthenticated()) {
    redirect('/admin/dashboard')
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <h1 className="text-xl font-semibold text-slate-900">Hiring team sign in</h1>
      <p className="mt-2 mb-6 text-sm text-slate-600">
        Submissions are read-only. Records cannot be edited or deleted from here.
      </p>
      <AdminLoginForm />
    </main>
  )
}
