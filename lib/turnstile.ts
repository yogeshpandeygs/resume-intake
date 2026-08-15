import { turnstileSecretKey } from './env'

/**
 * Cloudflare Turnstile verification.
 *
 * The application link is public and forwardable by design, so the submit
 * endpoint needs a bot control that does not put a puzzle in front of a genuine
 * candidate. In development the documented always-passes test keys are used, so
 * this code path runs for real rather than being stubbed out — the integration is
 * exercised on every local submission.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileResult {
  success: boolean
  /** Cloudflare's machine-readable reasons, useful in logs when this rejects. */
  errorCodes?: string[]
}

export async function verifyTurnstile(
  token: string | undefined,
  remoteIp?: string,
): Promise<TurnstileResult> {
  if (!token) {
    return { success: false, errorCodes: ['missing-input-response'] }
  }

  const form = new URLSearchParams()
  form.set('secret', turnstileSecretKey)
  form.set('response', token)
  if (remoteIp && remoteIp !== 'unknown') form.set('remoteip', remoteIp)

  try {
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      body: form,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return { success: false, errorCodes: [`http-${response.status}`] }
    }

    const body = (await response.json()) as {
      success?: boolean
      'error-codes'?: string[]
    }
    return { success: body.success === true, errorCodes: body['error-codes'] }
  } catch (error) {
    // A Cloudflare outage must not silently disable the check, so this fails
    // closed: the candidate is asked to retry rather than waved through.
    console.error('Turnstile verification failed', error)
    return { success: false, errorCodes: ['verification-unavailable'] }
  }
}
