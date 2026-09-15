'use client'

import { Button } from '@/components/elements/button'
import { clsx } from 'clsx/lite'
import { useRouter } from 'next/navigation'
import { useId, useState, type FormEvent } from 'react'

export function WebsiteForm({ defaultValue = '' }: { defaultValue?: string }) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!value.trim()) {
      setError('Enter your business website, for example youragency.com.')
      return
    }
    setPending(true)
    setError(null)
    try {
      const response = await fetch('/api/radars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          website: value,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: navigator.language,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.token) {
        setError(body.error ?? 'Something went wrong. Please try again.')
        setPending(false)
        return
      }
      router.push(`/r/${body.token}`)
    } catch {
      setError('We could not reach the server. Check your connection and try again.')
      setPending(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex w-full max-w-lg flex-col gap-3">
      <label htmlFor={`${id}-website`} className="sr-only">
        Your business website
      </label>
      <div
        className={clsx(
          'flex rounded-full bg-white p-1 inset-ring-1 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-mist-950 dark:bg-white/10 dark:focus-within:outline-white',
          error ? 'inset-ring-red-600/60 dark:inset-ring-red-400/60' : 'inset-ring-black/10 dark:inset-ring-white/10',
        )}
      >
        <input
          id={`${id}-website`}
          name="website"
          type="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="youragency.com"
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
          {pending ? 'Starting…' : 'Find my first leads'}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="px-4 text-sm/6 text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <p id={`${id}-hint`} className="px-4 text-sm/6 text-mist-600 dark:text-mist-400">
        Free lead research for 14 days. No account needed.
      </p>
    </form>
  )
}
