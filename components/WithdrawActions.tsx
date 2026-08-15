'use client'

import { useState } from 'react'

/**
 * The confirm step for withdrawal and renewal.
 *
 * Both actions are POSTs issued from here. The page itself is a plain GET that
 * changes nothing, which is what makes the emailed link safe: mail clients, link
 * scanners and chat previews fetch URLs to build previews, and a destructive GET
 * would let any of them erase a candidate's record before they ever opened the
 * message.
 */
export function WithdrawActions({
  token,
  retentionExpiryDate,
}: {
  token: string
  retentionExpiryDate: string
}) {
  const [state, setState] = useState<'idle' | 'working' | 'erased' | 'renewed'>('idle')
  const [newExpiry, setNewExpiry] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)

  async function act(action: 'withdraw' | 'renew') {
    setError(undefined)
    setState('working')
    try {
      const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, action }),
      })
      const body = await response.json()

      if (!response.ok) {
        setError(body.error ?? 'That did not work. Please try again.')
        setState('idle')
        return
      }

      if (action === 'withdraw') {
        setState('erased')
      } else {
        setNewExpiry(body.retentionExpiryDate)
        setState('renewed')
      }
    } catch {
      setError('Something went wrong. Please check your connection and try again.')
      setState('idle')
    }
  }

  if (state === 'erased') {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-300 bg-green-50 p-6 text-green-900"
      >
        <h2 className="text-lg font-semibold">Your details have been erased</h2>
        <p className="mt-2 text-sm">
          Your record and the resume you uploaded have been permanently deleted. Nothing
          identifying you remains, and this link will no longer work.
        </p>
      </div>
    )
  }

  if (state === 'renewed') {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-300 bg-green-50 p-6 text-green-900"
      >
        <h2 className="text-lg font-semibold">Thank you — your consent is renewed</h2>
        <p className="mt-2 text-sm">
          We will keep your details until <strong>{newExpiry}</strong>, and write to you again
          30 days before that date.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">What would you like to do?</h2>
      <p className="mt-2 text-sm text-slate-600">
        We currently plan to keep your details until <strong>{retentionExpiryDate}</strong>.
      </p>

      {error && (
        <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm font-medium text-red-800">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={state === 'working'}
          onClick={() => void act('renew')}
          className="rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:bg-slate-300"
        >
          Keep my details for another 36 months
        </button>

        {confirming ? (
          <button
            type="button"
            disabled={state === 'working'}
            onClick={() => void act('withdraw')}
            className="rounded-md bg-red-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-800 disabled:bg-slate-300"
          >
            {state === 'working' ? 'Erasing…' : 'Yes, erase my details permanently'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-md border border-red-300 bg-white px-5 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-50"
          >
            Withdraw consent and erase my details
          </button>
        )}
      </div>

      {confirming && (
        <p className="mt-3 text-sm text-red-800">
          This cannot be undone. Your record and your uploaded resume will be deleted
          immediately.
        </p>
      )}
    </div>
  )
}
