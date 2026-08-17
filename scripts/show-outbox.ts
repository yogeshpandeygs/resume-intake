/**
 * Prints the stubbed mailbox.
 *
 *   npm run outbox
 *
 * No email provider is wired up, so withdrawal and re-consent messages are
 * written to the `outbox` table instead of being sent. This is how you read them
 * during development — including the withdrawal links, which exist nowhere else.
 *
 * Deliberately a command-line tool rather than a screen in the admin UI. A
 * withdrawal token erases a record, and the admin session is read-only precisely
 * so the hiring team cannot delete anything; putting these tokens on an admin
 * page would hand back the capability the scope is meant to withhold.
 */
import './env'
import { desc } from 'drizzle-orm'
import { assertPgliteAvailable } from '../lib/db/pglite-lock'
import { outbox } from '../lib/db/schema'
import { pgliteDataDir } from '../lib/env'

async function main() {
  // Checked before `lib/db` is imported: importing it opens the database, and
  // opening one that the dev server already has would corrupt it.
  assertPgliteAvailable(pgliteDataDir)
  const { db } = await import('../lib/db')

  const messages = await db.select().from(outbox).orderBy(desc(outbox.createdAt))

  if (messages.length === 0) {
    console.log('Outbox is empty.')
    return
  }

  for (const message of messages) {
    console.log('─'.repeat(76))
    console.log(`To:      ${message.toEmail}`)
    console.log(`Subject: ${message.subject}`)
    console.log(`Kind:    ${message.kind}`)
    console.log(`Queued:  ${message.createdAt.toISOString()}`)
    console.log(`Sent:    ${message.sentAt?.toISOString() ?? 'never — no email provider configured'}`)
    console.log()
    console.log(message.body)
    console.log()
  }
  console.log('─'.repeat(76))
  console.log(`${messages.length} message(s).`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
