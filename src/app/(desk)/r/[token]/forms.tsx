'use client'

import { createRadar, saveEmail } from '@/lib/client/radar-forms'
import { useRouter } from 'next/navigation'
import { useId, useState, type FormEvent } from 'react'

/** Research another (or a more specific) page, emailing results to the address this browser already gave. */
export function DeskWebsiteForm({ placeholder = 'youragency.com/services', cta = 'Search this page' }: { placeholder?: string; cta?: string }) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!value.trim()) return setError('Enter the page that describes what you sell.')
    setPending(true)
    setError(null)
    const result = await createRadar(value)
    if (!result.ok) {
      setError(result.field === 'email' ? 'Start a new search from the home page to add where we should email your leads.' : result.error)
      setPending(false)
      return
    }
    router.push(`/r/${result.token}`)
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="inline-form">
        <label htmlFor={`${id}-url`} className="sr-only">
          Website to research
        </label>
        <input
          id={`${id}-url`}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        <button type="submit" className="btn btn--brand" disabled={pending}>
          {pending ? 'Starting…' : cta}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  )
}

export function DeskEmailForm({ token, onSaved }: { token: string; onSaved: () => void }) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!value.trim()) return setError('Enter the email address where we should send your leads.')
    setPending(true)
    setError(null)
    const result = await saveEmail(token, value)
    if (!result.ok) {
      setError(result.error)
      setPending(false)
      return
    }
    onSaved()
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="inline-form">
        <label htmlFor={`${id}-email`} className="sr-only">
          Your email address
        </label>
        <input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          placeholder="you@youragency.com"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : `${id}-hint`}
        />
        <button type="submit" className="btn btn--brand" disabled={pending}>
          {pending ? 'Saving…' : 'Send me my leads'}
        </button>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="form-error">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="form-hint">
          We’ll email your best matches every morning for 14 days. Unsubscribe anytime.
        </p>
      )}
    </form>
  )
}
