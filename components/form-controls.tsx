'use client'

import { useId, type ReactNode } from 'react'
import { countWords } from '@/lib/domain/fields'

/**
 * Shared form controls.
 *
 * Every field wires its label, error and hint together with `aria-describedby`
 * and marks itself `aria-invalid`, so a screen reader reads the same information
 * a sighted candidate gets from the red text.
 */

export function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
  children: (props: {
    id: string
    'aria-describedby'?: string
    'aria-invalid'?: boolean
  }) => ReactNode
}) {
  const id = useId()
  const errorId = `${id}-error`
  const hintId = `${id}-hint`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-800">
        {label}
        {required && (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>

      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
      })}

      {hint && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

export const inputClass =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-blue-600 aria-[invalid=true]:border-red-500'

/** Live word count for the fields the PRD caps by words rather than characters. */
export function WordCounter({ value, limit }: { value: string; limit: number }) {
  const used = countWords(value)
  const over = used > limit
  return (
    <span
      className={over ? 'font-medium text-red-700' : 'text-slate-500'}
      // Announced only when it matters, rather than on every keystroke.
      aria-live={over ? 'polite' : 'off'}
    >
      {used} / {limit} words
    </span>
  )
}
