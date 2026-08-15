'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { inputClass } from './form-controls'

export function AdminLoginForm() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const body = await response.json()
      if (!response.ok) {
        setError(body.error ?? 'Sign in failed.')
        return
      }
      router.push('/admin/dashboard')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label htmlFor="admin-password" className="text-sm font-medium text-slate-800">
        Admin password
      </label>
      <input
        id="admin-password"
        type="password"
        autoComplete="current-password"
        className={inputClass}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />

      {error && (
        <p role="alert" className="rounded-md bg-red-50 p-3 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || password === ''}
        className="rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:bg-slate-300"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
