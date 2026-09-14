'use client'

import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import { Squares2StackedIcon } from '@/components/icons/squares-2-stacked-icon'
import { clsx } from 'clsx/lite'
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'

const LOCALE = 'en-US'

export function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  }).format(new Date(value))
}

export function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone }).format(
    new Date(value),
  )
}

/** Publication dates are calendar dates (YYYY-MM-DD) and must not shift across timezones. */
export function formatCalendarDate(value: string) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`),
  )
}

export function localDateKey(value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(
    new Date(value),
  )
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

export function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    copied,
    async copy(text: string) {
      if (await copyText(text)) {
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 2000)
      }
    },
  }
}

export function CopyButton({
  text,
  label,
  copiedLabel = 'Copied',
  variant = 'soft',
  className,
  onCopied,
}: {
  text: string
  label: ReactNode
  copiedLabel?: ReactNode
  variant?: 'soft' | 'solid'
  className?: string
  onCopied?: () => void
}) {
  const { copied, copy } = useCopy()
  return (
    <button
      type="button"
      onClick={async () => {
        await copy(text)
        onCopied?.()
      }}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-full px-3 py-1 text-sm/7 font-medium',
        variant === 'soft' &&
          'bg-mist-950/10 text-mist-950 hover:bg-mist-950/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/20',
        variant === 'solid' &&
          'bg-mist-950 text-white hover:bg-mist-800 dark:bg-mist-300 dark:text-mist-950 dark:hover:bg-mist-200',
        className,
      )}
    >
      {copied ? <CheckmarkIcon className="shrink-0" /> : <Squares2StackedIcon className="shrink-0" />}
      <span aria-live="polite">{copied ? copiedLabel : label}</span>
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={clsx('size-4 motion-safe:animate-spin', className)} aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity={0.2} strokeWidth={1.5} />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

export function Badge({ className, tone = 'soft', ...props }: ComponentProps<'span'> & { tone?: 'soft' | 'solid' | 'outline' }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2 text-xs/6 font-medium whitespace-nowrap',
        tone === 'soft' && 'bg-mist-950/10 text-mist-950 dark:bg-white/10 dark:text-white',
        tone === 'solid' && 'bg-mist-950 text-white dark:bg-white dark:text-mist-950',
        tone === 'outline' && 'text-mist-700 inset-ring-1 inset-ring-mist-950/15 dark:text-mist-300 dark:inset-ring-white/15',
        className,
      )}
      {...props}
    />
  )
}

export function Panel({ className, ...props }: ComponentProps<'div'>) {
  return <div className={clsx('rounded-xl bg-mist-950/2.5 p-6 dark:bg-white/5', className)} {...props} />
}

export function ExternalLink({ href, className, ...props }: { href: string } & Omit<ComponentProps<'a'>, 'href'>) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      referrerPolicy="no-referrer"
      className={clsx(
        'font-medium text-mist-950 underline decoration-mist-950/20 underline-offset-4 hover:decoration-mist-950 dark:text-white dark:decoration-white/20 dark:hover:decoration-white',
        className,
      )}
      {...props}
    />
  )
}
