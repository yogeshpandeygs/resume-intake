'use client'

import { useState } from 'react'

/**
 * Share controls on the confirmation page.
 *
 * The link is meant to travel: a candidate passing it into their own network is
 * an intended route in, not a leak. Every share carries the same campaign code
 * the candidate arrived with, so the channel can be attributed without the link
 * ever identifying who forwarded it.
 */
export function ShareButtons({ shareUrl, message }: { shareUrl: string; message: string }) {
  const [copied, setCopied] = useState(false)

  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${message} ${shareUrl}`)}`
  const mailHref = `mailto:?subject=${encodeURIComponent(
    'A role you might be interested in',
  )}&body=${encodeURIComponent(`${message}\n\n${shareUrl}\n`)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    } catch {
      // Clipboard access can be refused; the link is on screen to copy by hand.
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a
        href={whatsappHref}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
      >
        Share on WhatsApp
      </a>
      <a
        href={mailHref}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
      >
        Share by email
      </a>
      <button
        type="button"
        onClick={copy}
        className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
      >
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Link copied to clipboard' : ''}
      </span>
    </div>
  )
}
