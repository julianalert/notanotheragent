'use client'

import type { RadarView } from '@/lib/radars'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { longDay, relativeMoment } from './lib'

export type DeskView = 'today' | 'contacted' | 'dismissed'

export function Rail({
  view,
  privateUrl,
  currentView,
  counts,
  viewsEnabled,
  activating,
  onView,
  onCopyLink,
  onTimezoneChange,
  onActivate,
  onPortal,
  onToggleSource,
  onWebhook,
}: {
  view: RadarView
  privateUrl: string
  currentView: DeskView
  counts: Record<DeskView, number>
  viewsEnabled: boolean
  activating: boolean
  onView: (view: DeskView) => void
  onCopyLink: () => void
  onTimezoneChange: (timezone: string) => Promise<void>
  onActivate: () => void
  onPortal: () => void
  onToggleSource: (id: string, enabled: boolean) => Promise<void>
  onWebhook: (url: string) => Promise<string | null>
}) {
  const [editingTz, setEditingTz] = useState(false)
  const [editingHook, setEditingHook] = useState(false)
  const [hookError, setHookError] = useState<string | null>(null)
  const zones = useMemo(() => (editingTz ? Intl.supportedValuesOf('timeZone') : []), [editingTz])
  const firstSearchDone = view.initialRun?.status === 'completed' && Boolean(view.profileServices.length)
  const canActivate = view.billingConfigured && firstSearchDone && view.plan !== 'active'

  const nav: Array<{ id: DeskView; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'dismissed', label: 'Dismissed' },
  ]

  return (
    <aside className="rail" aria-label="Radar">
      <Link href="/" className="brand">
        <span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Not Another Agent" />
        </span>
      </Link>

      <nav className="rail-nav" aria-label="Lead views">
        {viewsEnabled &&
          nav.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={currentView === item.id}
              onClick={() => onView(item.id)}
            >
              {item.label} <em>{counts[item.id]}</em>
            </button>
          ))}
        {viewsEnabled && <div className="sep" aria-hidden="true" />}
        <Link href="/#start">New search</Link>
      </nav>

      <div className="rail-card" id="activate">
        {view.agentLive ? (
          <>
            <span className="live">
              <i aria-hidden="true" />
              {view.plan === 'past_due' ? 'Agent live · payment failed' : 'Agent live'}
            </span>
            <p className="days">
              {view.watchedSources.filter((source) => source.enabled).length || '—'}
              <small>
                {view.watchedSources.length ? 'sources watched through the day' : 'sources: learning where your buyers post'}
                {view.currentPeriodEnd && <>, renews {longDay(view.currentPeriodEnd, view.timezone)}</>}
              </small>
            </p>
            {view.plan === 'past_due' && <p className="rail-warn">Your last payment failed. Update your card to keep the agent running.</p>}
            <button type="button" className="btn btn--line btn--sm" onClick={onPortal}>
              {view.plan === 'past_due' ? 'Update card' : 'Manage billing'}
            </button>
          </>
        ) : (
          <>
            <span className="live is-ended">
              <i aria-hidden="true" />
              {view.plan === 'cancelled' || view.plan === 'past_due' ? 'Agent stopped' : 'Agent asleep'}
            </span>
            <p className="days">
              ${view.priceUsd}
              <small>per month. Searches every morning, watches your buyers’ communities through the day, learns from what you contact.</small>
            </p>
            {canActivate ? (
              <button type="button" className="btn btn--brand btn--sm" onClick={onActivate} disabled={activating}>
                {activating ? 'Opening checkout…' : view.plan === 'free' ? 'Activate my agent' : 'Reactivate my agent'}
              </button>
            ) : (
              <p className="rail-muted">{firstSearchDone ? 'Activation is not available yet.' : 'Available once your first search is done.'}</p>
            )}
            {view.plan !== 'free' && view.billingConfigured && (
              <button type="button" className="link" onClick={onPortal} style={{ marginTop: 8 }}>
                Billing history
              </button>
            )}
          </>
        )}
      </div>

      <div className="rail-facts">
        {view.agentLive && view.nextRunAt && (
          <div>
            <b>{capitalise(relativeMoment(view.nextRunAt, view.now, view.timezone))}</b>
            Next morning search — {view.timezone},{' '}
            <button type="button" className="link" onClick={() => setEditingTz((value) => !value)}>
              {editingTz ? 'cancel' : 'change'}
            </button>
            {editingTz && (
              <>
                <label htmlFor="desk-timezone" className="sr-only">
                  Timezone for the 8:00 search
                </label>
                <select
                  id="desk-timezone"
                  defaultValue={view.timezone}
                  onChange={async (event) => {
                    await onTimezoneChange(event.target.value)
                    setEditingTz(false)
                  }}
                >
                  {!zones.includes(view.timezone) && <option value={view.timezone}>{view.timezone}</option>}
                  {zones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
        {view.agentLive && view.watchedSources.length > 0 && (
          <div>
            <b>Watched sources</b>
            <ul className="rail-sources">
              {view.watchedSources.map((source) => (
                <li key={source.id}>
                  <label>
                    <input type="checkbox" checked={source.enabled} onChange={(event) => onToggleSource(source.id, event.target.checked)} />
                    <span>{source.label}</span>
                    <em>{source.published ? `${source.published} lead${source.published === 1 ? '' : 's'}` : `${source.hits} seen`}</em>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        {view.emailMasked && (
          <div>
            <b>{view.emailMasked}</b>
            {view.emailUnsubscribed ? 'Email updates are off' : 'Where new leads are emailed'}
          </div>
        )}
        <div>
          <b>{view.webhookUrl ? 'Also posted to Slack' : 'Slack or webhook'}</b>
          {view.webhookUrl ? 'New leads go to your webhook too, ' : 'Post new leads to a channel, '}
          <button type="button" className="link" onClick={() => setEditingHook((value) => !value)}>
            {editingHook ? 'cancel' : view.webhookUrl ? 'change' : 'set up'}
          </button>
          {editingHook && (
            <form
              className="rail-form"
              onSubmit={async (event) => {
                event.preventDefault()
                const url = String(new FormData(event.currentTarget).get('url') ?? '').trim()
                const problem = await onWebhook(url)
                setHookError(problem)
                if (!problem) setEditingHook(false)
              }}
            >
              <label htmlFor="desk-webhook" className="sr-only">
                Webhook URL
              </label>
              <input id="desk-webhook" name="url" defaultValue={view.webhookUrl ?? ''} placeholder="https://hooks.slack.com/services/…" inputMode="url" />
              <button type="submit" className="btn btn--line btn--sm">
                Save
              </button>
              {hookError && (
                <p role="alert" className="form-error">
                  {hookError}
                </p>
              )}
            </form>
          )}
        </div>
        <div>
          <b>Public sources only</b>
          We never contact anyone for you
        </div>
      </div>

      <div className="rail-link">
        <p>Your private link. Anyone with it can see your results, so keep it to yourself.</p>
        <div className="row">
          <input value={privateUrl} readOnly aria-label="Your private link" onFocus={(event) => event.target.select()} />
          <button type="button" className="btn btn--brand btn--sm" onClick={onCopyLink}>
            Copy
          </button>
        </div>
      </div>
    </aside>
  )
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
