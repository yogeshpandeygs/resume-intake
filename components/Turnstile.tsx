'use client'

import { useEffect, useRef } from 'react'

/**
 * Cloudflare Turnstile widget.
 *
 * Renders explicitly rather than via auto-discovery so the token lands in React
 * state instead of a hidden input, and so a expired token can re-issue itself
 * without a page reload.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
          theme?: 'light' | 'dark' | 'auto'
        },
      ) => string
      remove: (widgetId: string) => void
    }
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.turnstile) return Promise.resolve()

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`)
  if (existing) {
    return new Promise((resolve) => existing.addEventListener('load', () => resolve()))
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load the verification widget'))
    document.head.appendChild(script)
  })
}

export function Turnstile({
  siteKey,
  onToken,
}: {
  siteKey: string
  onToken: (token: string | undefined) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  // Held in a ref so the widget is not torn down and rebuilt every time the
  // parent re-renders with a new callback identity. Assigned in an effect rather
  // than during render, because refs must not be written while rendering.
  const onTokenRef = useRef(onToken)
  useEffect(() => {
    onTokenRef.current = onToken
  })

  useEffect(() => {
    let widgetId: string | undefined
    let cancelled = false

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          callback: (token) => onTokenRef.current(token),
          // Clear the token so a stale one is never submitted.
          'expired-callback': () => onTokenRef.current(undefined),
          'error-callback': () => onTokenRef.current(undefined),
        })
      })
      .catch(() => onTokenRef.current(undefined))

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [siteKey])

  return <div ref={containerRef} className="mt-2" />
}
