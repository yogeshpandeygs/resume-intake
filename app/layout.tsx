import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Apply — Resume Intake',
  description: 'Submit your resume to be considered for current and future openings.',
  // The link is public and forwardable, but the pages behind it are a form for a
  // named individual; there is nothing here that belongs in a search index.
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      {/*
        Browser extensions — Grammarly, password managers, translation tools —
        add attributes to <body> before React hydrates, which React then reports
        as a mismatch against the server HTML. Nothing here causes it and nothing
        here can prevent it, so the warning is suppressed at the one element it
        happens on.

        `suppressHydrationWarning` applies one level deep: it covers this
        element's own attributes and text, not its subtree. Genuine mismatches
        inside the application still surface as normal.
      */}
      <body
        suppressHydrationWarning
        className="min-h-full flex flex-col bg-slate-50 text-slate-900"
      >
        {children}
      </body>
    </html>
  )
}
