'use client'

import { Button } from '@/components/elements/button'
import { saveEmail } from '@/lib/client/radar-forms'
import { clsx } from 'clsx/lite'
import { useId, useState, type FormEvent } from 'react'

/** Step 2: where to send leads. Research is already running while the visitor types. */
export function EmailForm({
  token,
  onSaved,
  className,
}: {
  token: string
  onSaved: () => void
  className?: string
}) {
  const id = useId()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!value.trim()) {
      setError('Enter the email address where we should send your leads.')
      return
    }
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
    <form onSubmit={submit} noValidate className={clsx('flex w-full max-w-lg flex-col gap-2', className)}>
      <label htmlFor={`${id}-email`} className="sr-only">
        Your email address
      </label>
      <div
        className={clsx(
          'flex rounded-full bg-white p-1 inset-ring-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-mist-950 dark:bg-white/10 dark:focus-within:outline-white',
          error ? 'inset-ring-red-600/60 dark:inset-ring-red-400/60' : 'inset-ring-black/10 dark:inset-ring-white/10',
        )}
      >
        <input
          id={`${id}-email`}
          name="email"
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
          className="min-w-0 flex-1 bg-transparent px-4 text-base/7 text-mist-950 placeholder:text-mist-500 focus:outline-hidden sm:text-sm/7 dark:text-white"
        />
        <Button type="submit" size="lg" color="accent" disabled={pending} aria-disabled={pending} className="disabled:opacity-70">
          {pending ? 'Saving…' : 'Send me my leads'}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="px-4 text-sm/6 text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <p id={`${id}-hint`} className="px-4 text-xs/5 text-mist-600 italic dark:text-mist-400">
        We’ll email your best matches every morning for 14 days. Unsubscribe anytime.
      </p>
    </form>
  )
}
