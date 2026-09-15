'use client'

import type { RadarView } from '@/lib/radars'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { longDay, relativeMoment } from './lib'

export type DeskView = 'today' | 'contacted' | 'dismissed'

const RESEARCH_DAYS = 14

export function Rail({
  view,
  privateUrl,
  currentView,
  counts,
  viewsEnabled,
  onView,
  onCopyLink,
  onTimezoneChange,
}: {
  view: RadarView
  privateUrl: string
  currentView: DeskView
  counts: Record<DeskView, number>
  viewsEnabled: boolean
  onView: (view: DeskView) => void
  onCopyLink: () => void
  onTimezoneChange: (timezone: string) => Promise<void>
}) {
  const [editingTz, setEditingTz] = useState(false)
  const zones = useMemo(() => (editingTz ? Intl.supportedValuesOf('timeZone') : []), [editingTz])
  const msLeft = Date.parse(view.researchEndsAt) - Date.parse(view.now)
  const daysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000))
  const remaining = Math.min(1, Math.max(0, msLeft / (RESEARCH_DAYS * 86_400_000)))

  const nav: Array<{ id: DeskView; label: string }> = [
    { id: 'today', label: 'Today' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'dismissed', label: 'Dismissed' },
  ]

  return (
    <aside className="rail" aria-label="Radar">
      <Link href="/" className="brand">
        <i aria-hidden="true" />
        Lead Radar
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

      <div className="rail-card">
        {view.expired ? (
          <>
            <span className="live is-ended">
              <i aria-hidden="true" />
              Research complete
            </span>
            <p className="days">
              Done
              <small>Your leads stay here</small>
            </p>
          </>
        ) : (
          <>
            <span className="live">
              <i aria-hidden="true" />
              Research active
            </span>
            <p className="days">
              {daysLeft}
              <small>
                {daysLeft === 1 ? 'day' : 'days'} left, until {longDay(view.researchEndsAt, view.timezone)}
              </small>
            </p>
            <div className="track" aria-hidden="true">
              <i style={{ width: `${remaining * 100}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="rail-facts">
        {!view.expired && view.nextRunAt && (
          <div>
            <b>{capitalise(relativeMoment(view.nextRunAt, view.now, view.timezone))}</b>
            Next search — {view.timezone},{' '}
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
        {view.emailMasked && (
          <div>
            <b>{view.emailMasked}</b>
            {view.emailUnsubscribed ? 'Email updates are off' : 'Where new leads are emailed'}
          </div>
        )}
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
