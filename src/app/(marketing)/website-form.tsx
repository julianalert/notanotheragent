'use client'

import { Button } from '@/components/elements/button'
import { clsx } from 'clsx/lite'
import { useRouter } from 'next/navigation'
import { useId, useState, type FormEvent } from 'react'
import { checkWebsite } from '@/lib/client/radar-forms'
import { track } from '@/lib/client/track'
import { TRIAL_DAYS } from '@/lib/trial'
import { EmailForm } from './email-form'

export function WebsiteForm({ defaultValue = '' }: { defaultValue?: string }) {
  const router = useRouter()
  const id = useId()
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // The address we warned about (it couldn't be opened): submitting it again unchanged goes ahead.
  const [warnedFor, setWarnedFor] = useState<string | null>(null)
  // Step 2: the website is valid; research starts only once the visitor gives an email.
  const [started, setStarted] = useState<{ website: string; host: string } | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (pending) return
    if (!value.trim()) {
      setError('Enter your business website, for example youragency.com.')
      return
    }
    setPending(true)
    setError(null)
    const result = await checkWebsite(value, warnedFor === value.trim())
    if (!result.ok) {
      setError(result.error)
      setPending(false)
      return
    }
    if (result.warning && !result.existingToken) {
      setWarnedFor(value.trim())
      setError(result.warning)
      setPending(false)
      return
    }
    if (result.existingToken) {
      await track('existing_radar_opened')
      router.push(`/r/${result.existingToken}`)
      return
    }
    void track('website_submitted')
    setStarted({ website: value, host: result.host })
    setPending(false)
  }

  if (started) {
    return (
      <div className="flex w-full max-w-lg flex-col gap-3">
        <p className="px-1 text-sm/7 text-mist-950 dark:text-white" role="status">
          💌 Where should we send your leads?
        </p>
        <EmailForm website={started.website} onCreated={(token) => router.push(`/r/${token}`)} />
      </div>
    )
  }

  return (
    <form onSubmit={submit} noValidate className="flex w-full max-w-lg flex-col gap-2">
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
          {pending ? 'Checking…' : warnedFor !== null && warnedFor === value.trim() ? 'Use it anyway' : 'Get my first leads'}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="px-4 text-sm/6 text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <p id={`${id}-hint`} className="px-4 text-xs/5 text-mist-600 italic dark:text-mist-400">
        🔥 Free for {TRIAL_DAYS} days. No card, no account.
      </p>
    </form>
  )
}
