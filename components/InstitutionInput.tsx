'use client'

import { useEffect, useId, useState } from 'react'
import { inputClass } from './form-controls'

/**
 * Institution name with type-ahead.
 *
 * Backed by a seeded list of Indian universities and colleges, but the field is
 * always free text: a candidate whose institution is not on the list must still be
 * able to apply. The suggestions exist to keep spellings consistent enough for the
 * admin's institution filter to be useful, not to constrain the answer.
 */
export function InstitutionInput({
  value,
  onChange,
  id,
  ...rest
}: {
  value: string
  /** Receives the new text, not the event — `onChange` is deliberately narrowed. */
  onChange: (value: string) => void
  id?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'list'>) {
  const listId = useId()
  const [suggestions, setSuggestions] = useState<string[]>([])

  const query = value.trim()

  /**
   * Whether to show suggestions is derived during render rather than pushed into
   * state from the effect: clearing state synchronously inside an effect
   * triggers a second render pass for something already known at render time.
   */
  const visibleSuggestions = query.length >= 2 ? suggestions : []

  useEffect(() => {
    if (query.length < 2) return

    // Debounced so typing a long institution name is one request, not fifteen.
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/institutions?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        })
        if (!response.ok) return
        const body = (await response.json()) as { institutions?: string[] }
        setSuggestions(body.institutions ?? [])
      } catch {
        // A failed lookup just means no suggestions; the field still works.
      }
    }, 200)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  return (
    <>
      <input
        {...rest}
        id={id}
        type="text"
        className={inputClass}
        list={listId}
        value={value}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      <datalist id={listId}>
        {visibleSuggestions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  )
}
