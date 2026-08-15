'use client'

import { useState } from 'react'

/**
 * Builds a shareable application link carrying a campaign code.
 *
 * The code tags a channel or drive — `walkin-blr-aug`, `whatsapp` — so the
 * dashboard can filter by where applicants came from. It never identifies an
 * individual referrer, which is why candidates forwarding the link introduces no
 * new personal data.
 */
export function CopyInviteLink() {
  const [code, setCode] = useState('')
  const [copied, setCopied] = useState(false)

  const link =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/apply${code.trim() ? `?ref=${encodeURIComponent(code.trim())}` : ''}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="invite-code" className="sr-only">
        Campaign code
      </label>
      <input
        id="invite-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="campaign code"
        className="w-40 rounded-md border border-slate-300 px-2 py-2 text-sm"
      />
      <button
        type="button"
        onClick={copy}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
      >
        {copied ? 'Copied' : 'Copy invite link'}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Invite link copied to clipboard' : ''}
      </span>
    </div>
  )
}
