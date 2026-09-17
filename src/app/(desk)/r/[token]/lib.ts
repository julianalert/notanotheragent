'use client'

import { useEffect, useRef, useState } from 'react'

const LOCALE = 'en-US'
const DAY_MS = 86_400_000

export function localDateKey(value: string | Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(
    new Date(value),
  )
}

function dayDiff(value: string | Date, now: string, timeZone: string) {
  const a = Date.parse(`${localDateKey(value, timeZone)}T00:00:00Z`)
  const b = Date.parse(`${localDateKey(now, timeZone)}T00:00:00Z`)
  return Math.round((b - a) / DAY_MS)
}

export function clock(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(value))
}

export function shortDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone }).format(new Date(value))
}

export function longDay(value: string, timeZone: string) {
  return new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(
    new Date(value),
  )
}

/** Publication dates are calendar dates (YYYY-MM-DD) and must not shift across timezones. */
export function calendarDate(value: string) {
  return new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${value.slice(0, 10)}T00:00:00Z`),
  )
}

/** "published this morning / yesterday / 3 days ago / Sep 2" */
export function publishedAgo(date: string, now: string) {
  const days = Math.round((Date.parse(`${now.slice(0, 10)}T00:00:00Z`) - Date.parse(`${date.slice(0, 10)}T00:00:00Z`)) / DAY_MS)
  if (days <= 0) return 'published today'
  if (days === 1) return 'published yesterday'
  if (days < 7) return `published ${days} days ago`
  return `published ${calendarDate(date)}`
}

/** "today at 10:59", "yesterday at 8:02", "Sep 13 at 8:00" */
/** "today", "tomorrow", "yesterday" or "Sep 13" */
export function relativeDay(value: string, now: string, timeZone: string) {
  const days = dayDiff(value, now, timeZone)
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : days === -1 ? 'tomorrow' : shortDate(value, timeZone)
}

export function relativeMoment(value: string, now: string, timeZone: string) {
  return `${relativeDay(value, now, timeZone)} at ${clock(value, timeZone)}`
}

export function groupLabel(value: string, now: string, timeZone: string) {
  const days = dayDiff(value, now, timeZone)
  if (days === 0) return 'Found today'
  if (days === 1) return 'Found yesterday'
  return `Found ${longDay(value, timeZone)}`
}

export function minutesAgo(value: string, now: number) {
  const minutes = Math.max(0, Math.round((now - Date.parse(value)) / 60_000))
  if (minutes < 1) return 'started just now'
  return `started ${minutes} minute${minutes === 1 ? '' : 's'} ago`
}

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
export const countWord = (n: number) => WORDS[n] ?? String(n)

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

export type ToastChoices = { options: Array<{ label: string; value: string }>; onChoose: (value: string) => void }

export function useToast() {
  const [toast, setToast] = useState<{ text: string; undo?: () => void; choices?: ToastChoices } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return {
    toast,
    show(text: string, undo?: () => void, choices?: ToastChoices) {
      setToast({ text, undo, choices })
      clearTimeout(timer.current)
      // A question (why was this dismissed?) stays a little longer than a confirmation.
      timer.current = setTimeout(() => setToast(null), choices ? 9000 : 4000)
    },
    hide() {
      clearTimeout(timer.current)
      setToast(null)
    },
  }
}
