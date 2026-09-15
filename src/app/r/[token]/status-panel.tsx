'use client'

import { PlainButton } from '@/components/elements/button'
import { Wallpaper } from '@/components/elements/wallpaper'
import { ClockIcon } from '@/components/icons/clock-icon'
import { LockIcon } from '@/components/icons/lock-icon'
import { MailIcon } from '@/components/icons/mail-icon'
import type { RadarView } from '@/lib/radars'
import { clsx } from 'clsx/lite'
import { useMemo, useState } from 'react'
import { CopyButton, formatDateTime, localDateKey, Spinner } from './ui'

export function PrivateLinkBox({
  privateUrl,
  headline,
  bare = false,
}: {
  privateUrl: string
  headline: string
  bare?: boolean
}) {
  return (
    <div className={clsx('flex flex-col gap-3', !bare && 'rounded-lg bg-mist-950/2.5 p-6 dark:bg-white/5')}>
      <p className="flex items-center gap-2 text-sm/7 font-medium text-mist-950 dark:text-white">
        <LockIcon className="shrink-0" />
        {headline}
      </p>
      <p className="text-sm/6 text-mist-700 dark:text-mist-400">
        Anyone with this link can see your results, so keep it private. It’s also in every lead email we send you.
      </p>
      <code className="truncate rounded-full bg-white px-3 py-1 font-mono text-xs/7 text-mist-600 inset-ring-1 inset-ring-black/10 dark:bg-white/10 dark:text-mist-300 dark:inset-ring-white/10">
        {privateUrl}
      </code>
      <CopyButton text={privateUrl} label="Copy private link" copiedLabel="Link copied" variant="accent" />
    </div>
  )
}

function DailyRunStatus({ view }: { view: RadarView }) {
  const run = view.latestDailyRun
  if (!run) return null
  const today = localDateKey(new Date(view.now), view.timezone)
  const isToday = run.runKey === today
  const prefix = isToday ? 'Today’s search' : 'The latest search'
  const newLeads = view.leads.filter((lead) => lead.runId === run.id).length

  let message: string
  let busy = false
  if (run.retrying) message = `${prefix} is delayed. We’re retrying.`
  else if (run.status === 'queued' || run.status === 'running' || run.status === 'processing') {
    message = `${prefix} is in progress.`
    busy = true
  } else if (run.status === 'failed') message = `${prefix} didn’t complete. We’ll search again at the next scheduled time.`
  else if (run.status === 'cancelled') return null
  else if (newLeads > 0) message = `${prefix} is complete. ${newLeads} new ${newLeads === 1 ? 'match' : 'matches'} added.`
  else if (run.outcome === 'insufficient_coverage') message = `${prefix} couldn’t reach enough sources. No new matches were added.`
  else if (run.outcome === 'validation_failed') message = `${prefix} found possible matches, but none passed the evidence checks.`
  else message = `${prefix} is complete. No new verified matches ${isToday ? 'today' : 'that day'}.`

  return (
    <p className="flex items-start gap-2 text-sm/6 text-mist-950 dark:text-white" role="status">
      {busy && <Spinner className="mt-1 shrink-0" />}
      {message}
    </p>
  )
}

export function StatusPanel({
  view,
  privateUrl,
  onTimezoneChange,
}: {
  view: RadarView
  privateUrl: string
  onTimezoneChange: (timezone: string) => Promise<void>
}) {
  const [editingTz, setEditingTz] = useState(false)
  const [savingTz, setSavingTz] = useState(false)
  const zones = useMemo(() => (editingTz ? Intl.supportedValuesOf('timeZone') : []), [editingTz])
  const msLeft = Date.parse(view.researchEndsAt) - Date.parse(view.now)
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000))

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg bg-mist-950/2.5 p-2 dark:bg-white/5">
        <Wallpaper color={view.expired ? 'brown' : 'green'} className="rounded-sm px-6 py-5">
          <p className="text-sm/7 font-medium text-white/80">
            {view.expired ? 'Research complete' : 'Free research active'}
          </p>
          <p className="font-display text-4xl/10 tracking-tight text-white">
            {view.expired ? 'Leads saved' : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`}
          </p>
          {!view.expired && (
            <p className="mt-1 text-sm/6 text-white/80">Until {formatDateTime(view.researchEndsAt, view.timezone)}</p>
          )}
        </Wallpaper>

        <div className="flex flex-col gap-4 p-6">
          {view.expired ? (
            <p className="text-sm/7 text-mist-950 dark:text-white">
              Your 14 days of research are complete. Your leads are still available here.
            </p>
          ) : (
            <>
              <p className="text-sm/6 text-mist-700 dark:text-mist-400">
                We search every day for 14 days. The number of new matches varies with available opportunities.
              </p>
              <DailyRunStatus view={view} />
              {view.emailMasked && (
                <p className="flex items-center gap-2 text-sm/6 text-mist-700 dark:text-mist-400">
                  <MailIcon className="shrink-0" />
                  {view.emailUnsubscribed ? 'Email updates are off.' : <>New leads are emailed to {view.emailMasked}</>}
                </p>
              )}
              {view.nextRunAt && (
                <div className="flex flex-col gap-1 border-t border-mist-950/10 pt-4 dark:border-white/10">
                  <p className="flex items-center gap-2 text-sm/7 text-mist-950 dark:text-white">
                    <ClockIcon className="shrink-0" />
                    <span>
                      <span className="font-medium">Next search:</span> {formatDateTime(view.nextRunAt, view.timezone)}
                    </span>
                  </p>
                  {!editingTz ? (
                    <p className="flex flex-wrap items-center gap-x-2 text-sm/6 text-mist-700 dark:text-mist-400">
                      <span>
                        {view.timezone}
                        {view.timezone === 'UTC' && view.timezoneInferred && ' (browser timezone unavailable)'}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingTz(true)}
                        className="font-medium text-mist-950 underline decoration-mist-950/20 underline-offset-4 hover:decoration-mist-950 dark:text-white dark:decoration-white/20"
                      >
                        Change
                      </button>
                    </p>
                  ) : (
                    <form
                      className="mt-1 flex flex-col gap-2"
                      onSubmit={async (event) => {
                        event.preventDefault()
                        const value = new FormData(event.currentTarget).get('timezone') as string
                        setSavingTz(true)
                        await onTimezoneChange(value)
                        setSavingTz(false)
                        setEditingTz(false)
                      }}
                    >
                      <label htmlFor="timezone" className="text-sm/6 text-mist-700 dark:text-mist-400">
                        Morning searches run at 08:00 in
                      </label>
                      <select
                        id="timezone"
                        name="timezone"
                        defaultValue={view.timezone}
                        className="rounded-full bg-white px-3 py-1.5 text-sm/6 text-mist-950 inset-ring-1 inset-ring-black/10 dark:bg-white/10 dark:text-white dark:inset-ring-white/10"
                      >
                        {!zones.includes(view.timezone) && <option value={view.timezone}>{view.timezone}</option>}
                        {zones.map((zone) => (
                          <option key={zone} value={zone}>
                            {zone}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={savingTz}
                          className="rounded-full bg-mist-950 px-3 py-1 text-sm/7 font-medium text-white hover:bg-mist-800 disabled:opacity-70 dark:bg-mist-300 dark:text-mist-950"
                        >
                          {savingTz ? 'Saving…' : 'Save'}
                        </button>
                        <PlainButton onClick={() => setEditingTz(false)}>Cancel</PlainButton>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <PrivateLinkBox privateUrl={privateUrl} headline="Bookmark your private link" />
    </div>
  )
}
