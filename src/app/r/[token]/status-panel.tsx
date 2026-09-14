'use client'

import { PlainButton } from '@/components/elements/button'
import type { RadarView } from '@/lib/radars'
import { useMemo, useState } from 'react'
import { CopyButton, formatDateTime, localDateKey, Panel, Spinner } from './ui'

export function PrivateLinkBox({ privateUrl, headline }: { privateUrl: string; headline: string }) {
  return (
    <Panel className="flex flex-col gap-3">
      <p className="text-sm/6 font-medium text-mist-950 dark:text-white">{headline}</p>
      <p className="text-sm/6 text-mist-700 dark:text-mist-400">
        Anyone with this link can see your results. Keep this link private. There’s no account or email recovery.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-stretch">
        <code className="min-w-0 truncate rounded-full bg-white px-3 py-1 font-mono text-xs/7 text-mist-600 inset-ring-1 inset-ring-black/10 dark:bg-white/10 dark:text-mist-300 dark:inset-ring-white/10">
          {privateUrl}
        </code>
        <CopyButton text={privateUrl} label="Copy private link" copiedLabel="Link copied" variant="solid" />
      </div>
    </Panel>
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
  else if (run.outcome === 'insufficient_coverage')
    message = `${prefix} couldn’t reach enough sources. No new matches were added.`
  else if (run.outcome === 'validation_failed')
    message = `${prefix} found possible matches, but none passed the evidence checks.`
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

  return (
    <div className="flex flex-col gap-2">
      <Panel className="flex flex-col gap-4">
        <h2 className="text-base/7 font-medium text-mist-950 dark:text-white">Research status</h2>

        {view.expired ? (
          <p className="text-sm/6 text-mist-950 dark:text-white">
            Your 14 days of research are complete. Your leads are still available here.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-sm/6 font-medium text-mist-950 dark:text-white">
                Free research active until {formatDateTime(view.researchEndsAt, view.timezone)}
              </p>
              <p className="text-sm/6 text-mist-700 dark:text-mist-400">
                We search every day for 14 days. The number of new matches varies with available opportunities.
              </p>
            </div>

            <DailyRunStatus view={view} />

            {view.nextRunAt && (
              <div className="flex flex-col gap-1 border-t border-mist-950/10 pt-4 dark:border-white/10">
                <p className="text-sm/6 text-mist-950 dark:text-white">
                  <span className="font-medium">Next search:</span> {formatDateTime(view.nextRunAt, view.timezone)}
                </p>
                {!editingTz ? (
                  <p className="flex flex-wrap items-center gap-x-2 text-sm/6 text-mist-700 dark:text-mist-400">
                    <span>
                      Timezone: {view.timezone}
                      {view.timezone === 'UTC' && view.timezoneInferred && ' (your browser timezone was unavailable)'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingTz(true)}
                      className="font-medium text-mist-950 underline decoration-mist-950/20 underline-offset-4 dark:text-white dark:decoration-white/20"
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
      </Panel>

      <PrivateLinkBox privateUrl={privateUrl} headline="Bookmark your private link" />
    </div>
  )
}
