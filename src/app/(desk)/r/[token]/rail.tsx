'use client'

import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import type { RadarView } from '@/lib/radars'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { clock, relativeDay } from './lib'

export type DeskView = 'today' | 'contacted' | 'dismissed'

export function Rail({
  view,
  currentView,
  counts,
  foundToday,
  viewsEnabled,
  activating,
  onView,
  onCopyLink,
  onTimezoneChange,
  onActivate,
  onPortal,
  onWebhook,
}: {
  view: RadarView
  currentView: DeskView
  counts: Record<DeskView, number>
  foundToday: number
  viewsEnabled: boolean
  activating: boolean
  onView: (view: DeskView) => void
  onCopyLink: () => void
  onTimezoneChange: (timezone: string) => Promise<void>
  onActivate: () => void
  onPortal: () => void
  onWebhook: (url: string) => Promise<string | null>
}) {
  const [editingTz, setEditingTz] = useState(false)
  const [editingHook, setEditingHook] = useState(false)
  const [hookError, setHookError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const zones = useMemo(() => (editingTz ? Intl.supportedValuesOf('timeZone') : []), [editingTz])
  const firstSearchDone = view.initialRun?.status === 'completed' && Boolean(view.profileServices.length)
  const canActivate = view.billingConfigured && firstSearchDone && view.plan !== 'active'
  const canManageBilling = view.billingConfigured && view.plan !== 'free'
  const nextSearch = view.nextRunAt ? `${relativeDay(view.nextRunAt, view.now, view.timezone)} ${clock(view.nextRunAt, view.timezone)}` : null
  // The free trial: the agent is live without a plan until `trial.endsAt`, then asleep until it is activated.
  const trialLive = Boolean(view.trial?.active)
  const trialOver = Boolean(view.trial && !view.trial.active)
  const trialEnd = view.trial ? `${relativeDay(view.trial.endsAt, view.now, view.timezone)} ${clock(view.trial.endsAt, view.timezone)}` : null
  const liveSummary = `lead${foundToday === 1 ? '' : 's'} found today${nextSearch ? `, next search ${nextSearch}, ${view.timezone}` : ''}`

  // Close the mobile/tablet burger menu when clicking anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  const nav: Array<{ id: DeskView; label: string }> = [
    { id: 'today', label: 'Leads' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'dismissed', label: 'Dismissed' },
  ]

  // Shared between the desktop rail card and the mobile/tablet sticky bar below —
  // the bar just presents this same content compactly via CSS.
  const agentCard = view.agentLive ? (
    <>
      <span className="live">
        <i aria-hidden="true" />
        {view.plan === 'past_due' ? 'Agent live · payment failed' : trialLive ? 'Agent live · free trial' : 'Agent live'}
      </span>
      <p className="days">
        {foundToday}
        <small>
          {liveSummary}
          {nextSearch && (
            <>
              {' '}
              <button type="button" className="link" onClick={() => setEditingTz((value) => !value)}>
                {editingTz ? 'Cancel' : 'Change'}
              </button>
            </>
          )}
        </small>
      </p>
      {editingTz && (
        <>
          <label htmlFor="desk-timezone" className="sr-only">
            Timezone for the morning search
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
      {view.plan === 'past_due' && (
        <>
          <p className="rail-warn">Your last payment failed. Update your card to keep the agent running.</p>
          <button type="button" className="btn btn--line btn--sm" onClick={onPortal}>
            Update card
          </button>
        </>
      )}
      {trialLive && (
        <>
          <p className="rail-trial">
            Free until <b>{trialEnd}</b>, no card needed. After that your agent sleeps until you activate it.
          </p>
          {canActivate && (
            <button type="button" className="btn btn--brand btn--sm" onClick={onActivate} disabled={activating}>
              {activating ? 'Opening checkout…' : `Keep my agent · $${view.priceUsd}/month`}
            </button>
          )}
        </>
      )}
    </>
  ) : (
    <>
      <span className="pitch__badge">
        <span aria-hidden="true">😴</span>
        {view.plan === 'cancelled' || view.plan === 'past_due' ? 'Agent stopped' : trialOver ? 'Trial ended · agent asleep' : 'Agent asleep'}
      </span>
      <p className="pitch__title">{trialOver ? 'Your free trial is over. Wake your agent for fresh leads every morning' : 'Wake it up for fresh leads every morning'}</p>
      <ul className="pitch__list">
        {['New leads every morning', 'Watches where buyers post', 'Learns from your choices'].map((item) => (
          <li key={item}>
            <CheckmarkIcon width={10} height={10} strokeWidth={1.8} />
            {item}
          </li>
        ))}
      </ul>
      <p className="pitch__price">
        ${view.priceUsd}
        <small>/ month</small>
      </p>
      {canActivate ? (
        <>
          <button type="button" className="btn btn--brand pitch__cta" onClick={onActivate} disabled={activating}>
            {activating ? 'Opening checkout…' : view.plan === 'free' ? 'Activate my agent' : 'Reactivate my agent'}
            {!activating && <span aria-hidden="true">→</span>}
          </button>
          <p className="pitch__fine">Cancel any time</p>
        </>
      ) : (
        <p className="rail-muted">{firstSearchDone ? 'Activation is not available yet.' : 'Available once your first search is done.'}</p>
      )}
    </>
  )

  return (
    <>
      <aside className="rail" aria-label="Radar">
        <Link href="/" className="brand">
          <span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="" />
          </span>
          <span className="brand__name">Not Another Agent</span>
        </Link>

        {viewsEnabled && (
          <nav className="rail-nav" aria-label="Lead views">
            {nav.map((item) => (
              <button key={item.id} type="button" aria-current={currentView === item.id} onClick={() => onView(item.id)}>
                {item.label} <em>{counts[item.id]}</em>
              </button>
            ))}
          </nav>
        )}

        {/* Mobile/tablet only: nav + account actions combined into one menu (see desk.css breakpoints). */}
        <div className="rail-burger" ref={menuRef}>
          <button
            type="button"
            className="burger-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Menu"
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>
          {menuOpen && (
            <div className="user-menu" role="menu">
              {viewsEnabled && (
                <>
                  <nav className="rail-nav" aria-label="Lead views">
                    {nav.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={currentView === item.id}
                        onClick={() => {
                          onView(item.id)
                          setMenuOpen(false)
                        }}
                      >
                        {item.label} <em>{counts[item.id]}</em>
                      </button>
                    ))}
                  </nav>
                  <div className="sep" aria-hidden="true" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onCopyLink()
                }}
              >
                Copy private link
                <small className="menu-hint">Your way back to these leads, no password needed</small>
              </button>
              {canManageBilling && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false)
                    onPortal()
                  }}
                >
                  Manage billing
                </button>
              )}
              <Link href="/#start" role="menuitem" onClick={() => setMenuOpen(false)}>
                New search
              </Link>
            </div>
          )}
        </div>

        {viewsEnabled && view.agentLive && (
          <div className="rail-facts rail-facts--hook">
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
          </div>
        )}

        <div className={view.agentLive ? 'rail-card' : 'rail-card rail-card--pitch'} id="activate">
          {agentCard}
        </div>
      </aside>

      {view.agentLive ? (
        <div className="mobile-agent-bar">
          <span className="mobile-agent-bar__text">
            {view.plan === 'past_due'
              ? 'Payment failed — update your card to keep the agent running.'
              : trialLive
                ? `Free trial until ${trialEnd}`
                : `${foundToday} ${liveSummary}`}
          </span>
          {trialLive && canActivate && (
            <button type="button" className="btn btn--brand btn--sm" onClick={onActivate} disabled={activating}>
              {activating ? 'Opening checkout…' : `Keep agent · $${view.priceUsd}`}
            </button>
          )}
          {view.plan === 'past_due' && (
            <button type="button" className="btn btn--line btn--sm" onClick={onPortal}>
              Update card
            </button>
          )}
        </div>
      ) : (
        canActivate && (
          <div className="mobile-agent-bar">
            <span className="mobile-agent-bar__text">{trialOver ? 'Your free trial is over. Wake your agent' : 'Get new leads every morning in your inbox'}</span>
            <button type="button" className="btn btn--brand btn--sm" onClick={onActivate} disabled={activating}>
              {activating ? 'Opening checkout…' : `${view.plan === 'free' ? 'Activate' : 'Reactivate'} agent · $${view.priceUsd}`}
            </button>
          </div>
        )
      )}
    </>
  )
}
