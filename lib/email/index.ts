import { db } from '../db'
import { outbox } from '../db/schema'
import { appBaseUrl, dpoEmail, organisationName, recruitmentEmail } from '../env'

/**
 * Outbound mail.
 *
 * No provider is wired up: messages are rendered and persisted to the `outbox`
 * table instead of being sent. That keeps the withdrawal and re-consent flows
 * complete and testable — the link is generated, stored and inspectable — while
 * leaving the choice of provider open.
 *
 * To go live, implement `EmailTransport` against a provider and swap the export
 * at the bottom of this file. Nothing else changes: callers only ever see
 * `sendEmail`.
 *
 * Until that happens, candidates do not actually receive their withdrawal link,
 * so the DPDP obligation to make withdrawal "as easy as giving consent" is not
 * yet met in production.
 */

export interface EmailMessage {
  kind: 'submission_receipt' | 'reconsent_invitation'
  to: string
  subject: string
  body: string
  submissionRef?: string
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>
}

/** Writes the message to the database and logs it. Never contacts a mail server. */
const outboxTransport: EmailTransport = {
  async send(message) {
    await db.insert(outbox).values({
      kind: message.kind,
      toEmail: message.to,
      subject: message.subject,
      body: message.body,
      submissionRef: message.submissionRef ?? null,
      // Deliberately null: nothing has been sent. The expiry sweep and the admin
      // outbox view both rely on this being honest.
      sentAt: null,
    })

    if (process.env.NODE_ENV !== 'test') {
      console.info(
        `[outbox] ${message.kind} for ${message.to} — not sent (no email provider configured)`,
      )
    }
  },
}

export const emailTransport: EmailTransport = outboxTransport

export async function sendEmail(message: EmailMessage): Promise<void> {
  await emailTransport.send(message)
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

export function withdrawalUrl(token: string): string {
  return `${appBaseUrl.replace(/\/$/, '')}/withdraw/${encodeURIComponent(token)}`
}

export function submissionReceipt(params: {
  to: string
  firstName: string
  submissionId: string
  withdrawalToken: string
  retentionExpiryDate: string
}): EmailMessage {
  return {
    kind: 'submission_receipt',
    to: params.to,
    subject: `Your application has been received (${params.submissionId})`,
    submissionRef: params.submissionId,
    body: [
      `Dear ${params.firstName},`,
      '',
      `Thank you for your application to ${organisationName}. Your reference is ${params.submissionId}.`,
      '',
      `We will hold your details until ${params.retentionExpiryDate} so that you can be considered for current and future openings, and for suitable roles across our network of client organisations. We will write to you 30 days before that date so you can renew your consent.`,
      '',
      'You can withdraw your consent at any time, which erases your record immediately:',
      withdrawalUrl(params.withdrawalToken),
      '',
      `To ask about access to, or correction of, your personal data, write to ${dpoEmail}.`,
      `For questions about your application, write to ${recruitmentEmail}.`,
      '',
      organisationName,
    ].join('\n'),
  }
}

/**
 * The T-30 renewal invitation.
 *
 * A single link serves both choices: the page it opens offers "keep my details"
 * and "erase them now" side by side. That satisfies the PRD's requirement that
 * the same mail carries the withdrawal link, without asking the candidate to
 * distinguish between two similar-looking URLs.
 */
export function reconsentInvitation(params: {
  to: string
  firstName: string
  submissionId: string
  withdrawalToken: string
  retentionExpiryDate: string
}): EmailMessage {
  return {
    kind: 'reconsent_invitation',
    to: params.to,
    subject: `Your details are due to be erased on ${params.retentionExpiryDate}`,
    submissionRef: params.submissionId,
    body: [
      `Dear ${params.firstName},`,
      '',
      `You applied to ${organisationName} and asked us to keep your details on file. That period ends on ${params.retentionExpiryDate}, when your record will be erased automatically.`,
      '',
      'Use this link to keep your details for a further 36 months, or to erase them straight away:',
      withdrawalUrl(params.withdrawalToken),
      '',
      'If you do nothing, your details will be erased on the date above.',
      '',
      `To ask about access to, or correction of, your personal data, write to ${dpoEmail}.`,
      '',
      organisationName,
    ].join('\n'),
  }
}
