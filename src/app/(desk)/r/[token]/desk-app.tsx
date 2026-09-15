'use client'

import type { LeadView, RadarView } from '@/lib/radars'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LeadDrawer, LeadItem, type DrawerAction } from './leads'
import { copyText, countWord, groupLabel, localDateKey, relativeMoment, useToast } from './lib'
import { Rail, type DeskView } from './rail'
import { DeadEnd, EmailStep, FocusEditor, NoResults, Searching, stageFor } from './screens'

const ACTIVE_POLL_MS = 3000
const IDLE_POLL_MS = 60000
const READY_HOLD_MS = 1200

const isInProgress = (status: string | undefined) => status === 'queued' || status === 'running' || status === 'processing'

type Screen = 'email' | 'searching' | 'unreadable' | 'unsupported' | 'empty' | 'leads'

export function DeskApp({ token, initialView }: { token: string; initialView: RadarView }) {
  const [view, setView] = useState(initialView)
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => '',
  )
  const privateUrl = `${origin}/r/${token}`
  const [clockOffset, setClockOffset] = useState(0)
  const [now, setNow] = useState(() => Date.parse(initialView.now))
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [holdReady, setHoldReady] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [deskView, setDeskView] = useState<DeskView>('today')
  const [cursor, setCursor] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [editingFocus, setEditingFocus] = useState(false)
  const lastStage = useRef('')
  const sawProgress = useRef(isInProgress(initialView.initialRun?.status))
  const { toast, show: showToast, hide: hideToast } = useToast()

  /* ------------------------------ Data ------------------------------ */

  const api = useCallback(
    (path: string, init?: RequestInit) =>
      fetch(`/api/radar${path}`, {
        ...init,
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-radar-token': token, ...init?.headers },
      }),
    [token],
  )

  const refresh = useCallback(async () => {
    try {
      const response = await api('')
      if (!response.ok) return
      const next = (await response.json()) as RadarView
      setClockOffset(Date.parse(next.now) - Date.now())
      setView(next)
    } catch {
      // Network hiccup: keep showing saved state and try again on the next poll.
    }
  }, [api])

  const initialStatus = view.initialRun?.status
  const busy = isInProgress(initialStatus) || isInProgress(view.latestDailyRun?.status) || isInProgress(view.followUpRun?.status)

  // Poll saved state. Fast while research runs; slow otherwise so morning results still appear.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let cancelled = false
    const loop = async () => {
      if (document.visibilityState === 'visible') await refresh()
      if (!cancelled) timer = setTimeout(loop, busy ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    }
    timer = setTimeout(loop, busy ? ACTIVE_POLL_MS : IDLE_POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [busy, refresh])

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now() + clockOffset), 5000)
    return () => clearInterval(interval)
  }, [clockOffset])

  // Briefly show the finished checklist when results arrive during this visit.
  useEffect(() => {
    if (isInProgress(initialStatus)) sawProgress.current = true
    if (initialStatus === 'completed' && sawProgress.current) {
      sawProgress.current = false
      setHoldReady(true)
      const timer = setTimeout(() => setHoldReady(false), READY_HOLD_MS)
      return () => clearTimeout(timer)
    }
  }, [initialStatus])

  // Announce research stage changes to assistive technology.
  useEffect(() => {
    const run = view.initialRun
    let message = ''
    if (run?.status === 'failed') message = 'Research could not be completed.'
    else if (run?.retrying) message = 'Research is being retried.'
    else if (run) message = ['Website received', 'Researching your business', 'Checking every claim', 'Your leads are ready', 'Your leads are ready'][stageFor(run).active]
    if (message && message !== lastStage.current) {
      lastStage.current = message
      setAnnouncement(message)
    }
  }, [view.initialRun])

  /* ----------------------------- Screens ---------------------------- */

  const run = view.initialRun
  let screen: Screen
  if (!view.hasEmail) screen = 'email'
  else if (!run || run.status !== 'completed' || holdReady) screen = 'searching'
  else if (run.outcome === 'website_unreadable' || (run.outcome === 'validation_failed' && !view.profileServices.length)) screen = 'unreadable'
  else if (run.outcome === 'unsupported_business') screen = 'unsupported'
  else if (view.leads.length === 0) screen = 'empty'
  else screen = 'leads'

  const counts = useMemo(
    () => ({
      today: view.leads.filter((lead) => lead.status === 'new').length,
      contacted: view.leads.filter((lead) => lead.status === 'contacted').length,
      dismissed: view.leads.filter((lead) => lead.status === 'dismissed').length,
    }),
    [view.leads],
  )
  const statusFor: Record<DeskView, LeadView['status']> = { today: 'new', contacted: 'contacted', dismissed: 'dismissed' }
  const rows = useMemo(() => view.leads.filter((lead) => lead.status === statusFor[deskView]), [view.leads, deskView]) // eslint-disable-line react-hooks/exhaustive-deps
  const safeCursor = Math.min(cursor, Math.max(0, rows.length - 1))
  const openLead = openId ? (view.leads.find((lead) => lead.id === openId) ?? null) : null
  const openIndex = openLead ? rows.findIndex((lead) => lead.id === openLead.id) : -1
  const drawerOpen = screen === 'leads' && openIndex >= 0

  // Deep link from emails: /r/<token>#lead-<id> opens that lead.
  const deepLinked = useRef(false)
  useEffect(() => {
    if (deepLinked.current || screen !== 'leads') return
    const id = window.location.hash.match(/^#lead-(.+)$/)?.[1]
    const lead = id && view.leads.find((item) => item.id === id)
    if (!lead) return
    const target: DeskView = lead.status === 'new' ? 'today' : lead.status
    // Deferred so the server-rendered list hydrates first, then the linked lead slides open.
    const timer = setTimeout(() => {
      deepLinked.current = true
      setDeskView(target)
      setOpenId(lead.id)
    }, 0)
    return () => clearTimeout(timer)
  }, [screen, view.leads])

  // Lock page scroll behind the drawer.
  useEffect(() => {
    if (!drawerOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [drawerOpen])

  /* ----------------------------- Actions ---------------------------- */

  const persistStatus = useCallback(
    async (leadId: string, status: LeadView['status']) => {
      setView((current) => ({
        ...current,
        leads: current.leads.map((lead) =>
          lead.id === leadId ? { ...lead, status, statusAt: status === 'new' ? null : new Date().toISOString() } : lead,
        ),
      }))
      const response = await api(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify({ status }) }).catch(() => null)
      if (!response?.ok) {
        showToast('We couldn’t save that change. Try again.')
        refresh()
      }
    },
    [api, refresh, showToast],
  )

  const setStatus = useCallback(
    (lead: LeadView, status: LeadView['status'], message: string) => {
      const previous = lead.status
      const index = rows.findIndex((item) => item.id === lead.id)
      const remaining = rows.filter((item) => item.id !== lead.id)
      void persistStatus(lead.id, status)
      // Keep working through the list: the drawer moves to the next lead in this view.
      if (openId === lead.id) {
        const next = remaining[Math.min(index, remaining.length - 1)]
        setOpenId(next ? next.id : null)
      }
      setCursor(Math.max(0, Math.min(index, remaining.length - 1)))
      showToast(message, () => {
        void persistStatus(lead.id, previous)
        hideToast()
      })
    },
    [rows, openId, persistStatus, showToast, hideToast],
  )

  const onDrawerAction = useCallback(
    async (action: DrawerAction, draft?: string) => {
      if (!openLead) return
      if (action === 'copy') {
        if (await copyText(draft ?? openLead.data.outreach_message)) showToast('Message copied')
        return
      }
      if (action === 'source') {
        window.open(openLead.data.source_url, '_blank', 'noopener,noreferrer')
        return
      }
      if (action === 'contact') return setStatus(openLead, 'contacted', 'Marked contacted')
      if (action === 'dismiss') return setStatus(openLead, 'dismissed', 'Lead dismissed')
      if (action === 'restore') return setStatus(openLead, 'new', 'Moved back to Today')
    },
    [openLead, setStatus, showToast],
  )

  const step = useCallback(
    (delta: number) => {
      if (!rows.length) return
      const base = openId ? Math.max(0, rows.findIndex((lead) => lead.id === openId)) : safeCursor
      const next = Math.min(rows.length - 1, Math.max(0, base + delta))
      setCursor(next)
      if (openId) setOpenId(rows[next].id)
      else document.querySelector(`[data-lead-id="${rows[next].id}"]`)?.scrollIntoView({ block: 'nearest' })
    },
    [rows, safeCursor, openId],
  )

  // j / k move, Enter or o opens, c marks contacted, x dismisses, Esc closes.
  useEffect(() => {
    if (screen !== 'leads') return
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (/^(input|textarea|select)$/i.test((event.target as HTMLElement).tagName)) return
      if (event.key === 'Escape' && openId) return setOpenId(null)
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault()
        return step(1)
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault()
        return step(-1)
      }
      if (!rows.length) return
      if ((event.key === 'Enter' || event.key === 'o') && !(event.target as HTMLElement).closest('button, a, [role="button"]')) {
        event.preventDefault()
        return setOpenId(openId ? null : rows[safeCursor].id)
      }
      const target = openLead ?? rows[safeCursor]
      if (event.key === 'c' && target.status === 'new') {
        event.preventDefault()
        setStatus(target, 'contacted', 'Marked contacted')
      }
      if (event.key === 'x' && target.status === 'new') {
        event.preventDefault()
        setStatus(target, 'dismissed', 'Lead dismissed')
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [screen, openId, openLead, rows, safeCursor, step, setStatus])

  async function saveFocus(focus: { services: string[]; market: string } | null) {
    const response = await api('/focus', { method: 'PATCH', body: JSON.stringify(focus ?? { reset: true }) }).catch(() => null)
    if (!response) return 'We couldn’t save your focus. Check your connection.'
    if (!response.ok) return (await response.json().catch(() => ({}))).error ?? 'We couldn’t save your focus.'
    await refresh()
    return null
  }

  async function setTimezone(timezone: string) {
    await api('/timezone', { method: 'PATCH', body: JSON.stringify({ timezone }) }).catch(() => null)
    await refresh()
  }

  async function retry() {
    setRetrying(true)
    setRetryError(null)
    const response = await api('/retry', { method: 'POST' }).catch(() => null)
    if (!response?.ok) {
      setRetryError((await response?.json().catch(() => ({})))?.error ?? 'We couldn’t restart the research. Try again.')
    }
    await refresh()
    setRetrying(false)
  }

  /* ----------------------------- Header ----------------------------- */

  const todayKey = localDateKey(view.now, view.timezone)
  const foundToday = view.leads.some((lead) => lead.status === 'new' && localDateKey(lead.discoveredAt, view.timezone) === todayKey)

  let title: string
  if (screen === 'email') title = 'Your research has started'
  else if (screen === 'searching') title = 'Finding opportunities for your business'
  else if (screen === 'unreadable' || screen === 'unsupported') title = 'We couldn’t research this website yet'
  else if (screen === 'empty') title = 'No verified matches yet'
  else if (deskView === 'contacted') title = 'Leads you have reached out to'
  else if (deskView === 'dismissed') title = 'Leads you set aside'
  else if (counts.today === 0) title = 'Everything has been handled'
  else title = `${countWord(counts.today)} strong match${counts.today === 1 ? '' : 'es'} ${foundToday ? 'today' : 'to review'}`

  const showFocus = view.focus && (screen === 'leads' || screen === 'empty')
  const lastRunWithCandidates = [view.followUpRun, view.latestDailyRun, view.initialRun]
    .filter((item) => item?.status === 'completed' && item.candidates)
    .sort((a, b) => Date.parse(b!.createdAt) - Date.parse(a!.createdAt))[0]
  // A follow-up continues the search before it, so report both together.
  const searchRuns = lastRunWithCandidates
    ? lastRunWithCandidates.kind === 'follow_up'
      ? [
          lastRunWithCandidates,
          ...[view.latestDailyRun, view.initialRun]
            .filter((item) => item?.status === 'completed' && Date.parse(item.createdAt) < Date.parse(lastRunWithCandidates.createdAt))
            .sort((a, b) => Date.parse(b!.createdAt) - Date.parse(a!.createdAt))
            .slice(0, 1),
        ]
      : [lastRunWithCandidates]
    : []
  const searchRunIds = new Set(searchRuns.map((item) => item!.id))
  const publishedInThatRun = view.leads.filter((lead) => searchRunIds.has(lead.runId)).length
  const candidatesInThatRun = searchRuns.reduce((sum, item) => sum + (item!.candidates ?? 0), 0)
  const daily = view.latestDailyRun
  const dailyNote = isInProgress(view.followUpRun?.status)
    ? 'Checking more angles for new leads'
    : daily?.retrying
      ? 'Today’s search is delayed. We’re retrying.'
      : isInProgress(daily?.status)
        ? 'Today’s search is in progress'
        : null

  const groups = useMemo(() => {
    if (deskView !== 'today') return [{ key: deskView, label: deskView === 'contacted' ? 'Contacted' : 'Dismissed', leads: rows }]
    const map = new Map<string, LeadView[]>()
    for (const lead of rows) {
      const key = localDateKey(lead.discoveredAt, view.timezone)
      map.set(key, [...(map.get(key) ?? []), lead])
    }
    return [...map.entries()].map(([key, leads]) => ({ key, label: groupLabel(leads[0].discoveredAt, view.now, view.timezone), leads }))
  }, [deskView, rows, view.now, view.timezone])

  const viewLabel = deskView === 'today' ? (openLead ? groupLabel(openLead.discoveredAt, view.now, view.timezone) : 'Today') : deskView === 'contacted' ? 'Contacted' : 'Dismissed'

  /* ----------------------------- Render ----------------------------- */

  return (
    <div className="desk" data-drawer-open={drawerOpen ? '' : undefined}>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="app">
        <Rail
          view={view}
          privateUrl={privateUrl}
          currentView={deskView}
          counts={counts}
          viewsEnabled={screen === 'leads'}
          onView={(next) => {
            setDeskView(next)
            setCursor(0)
            setOpenId(null)
          }}
          onCopyLink={async () => {
            if (await copyText(privateUrl)) showToast('Private link copied')
          }}
          onTimezoneChange={setTimezone}
        />

        <main className="work">
          <p className="site">Private radar — {view.websiteHost}</p>
          <h1>{title}</h1>

          {showFocus && view.focus && (
            <div className="focus">
              {view.focus.services.split(' · ').map((service) => (
                <span key={service} className="chip">
                  {service}
                </span>
              ))}
              <span className="chip">{view.focus.customerType}</span>
              <span className="chip">{view.focus.market}</span>
              {!view.expired && (
                <button type="button" className="chip chip--edit" onClick={() => setEditingFocus((value) => !value)} aria-expanded={editingFocus}>
                  Adjust focus
                </button>
              )}
            </div>
          )}
          {showFocus && editingFocus && <FocusEditor view={view} onSave={saveFocus} onClose={() => setEditingFocus(false)} />}

          {screen === 'email' && <EmailStep view={view} token={token} onSaved={refresh} />}

          {screen === 'searching' && (
            <Searching
              run={holdReady && run ? { ...run, status: 'completed' } : run}
              now={now}
              slow={run ? now - Date.parse(run.createdAt) > view.slowRunThresholdMs : false}
              expired={view.expired}
              retrying={retrying}
              retryError={retryError}
              onRetry={retry}
            />
          )}

          {screen === 'unreadable' && <DeadEnd view={view} kind="unreadable" />}
          {screen === 'unsupported' && <DeadEnd view={view} kind="unsupported" />}
          {screen === 'empty' && <NoResults view={view} />}

          {screen === 'leads' && (
            <>
              <div className="summary">
                {deskView === 'today' ? (
                  <>
                    {view.lastResearchAt && (
                      <span>
                        Research finished <b>{relativeMoment(view.lastResearchAt, view.now, view.timezone)}</b>
                      </span>
                    )}
                    {lastRunWithCandidates && (
                      <>
                        <span className="sep" aria-hidden="true" />
                        <span>
                          <b>{publishedInThatRun}</b> of {candidatesInThatRun} findings cleared the evidence check
                        </span>
                      </>
                    )}
                    <span className="sep" aria-hidden="true" />
                    {view.expired ? (
                      <span>Research period ended</span>
                    ) : dailyNote ? (
                      <span>{dailyNote}</span>
                    ) : view.nextRunAt ? (
                      <span>
                        Next search <b>{relativeMoment(view.nextRunAt, view.now, view.timezone)}</b>
                      </span>
                    ) : null}
                  </>
                ) : deskView === 'contacted' ? (
                  <>
                    <span>
                      We never contact anyone for you — <b>you marked these yourself</b>
                    </span>
                    <span className="sep" aria-hidden="true" />
                    <span>Future searches won’t bring back the same posts</span>
                  </>
                ) : (
                  <>
                    <span>Dismissed leads won’t come back in future searches</span>
                    <span className="sep" aria-hidden="true" />
                    <span>Restore one and it returns to Today</span>
                  </>
                )}
              </div>
              {view.sampleData && (
                <p className="note">Development mode: these leads come from the sample research provider, not real research.</p>
              )}

              {rows.length === 0 ? (
                <div className="nothing" style={{ marginTop: 34 }}>
                  <h3>
                    {deskView === 'today'
                      ? 'You have worked through your list'
                      : deskView === 'contacted'
                        ? 'Nothing marked contacted yet'
                        : 'Nothing dismissed yet'}
                  </h3>
                  <p>
                    {deskView === 'today'
                      ? view.expired
                        ? 'Your research period has ended. Contacted and dismissed leads are still here.'
                        : 'New matches land here after the next morning search, and in your inbox at the same time.'
                      : deskView === 'contacted'
                        ? 'Open a lead and mark it contacted once you have sent your message. It then leaves Today.'
                        : 'Dismiss a lead when it isn’t a fit. It leaves Today, and you can restore it here.'}
                  </p>
                </div>
              ) : (
                groups.map((group) => (
                  <Fragment key={group.key}>
                    <div className="group">
                      <h2>{group.label}</h2>
                      <span>{group.leads.length === 1 ? '1 lead' : `${group.leads.length} leads`}</span>
                    </div>
                    <div className="items">
                      {group.leads.map((lead) => {
                        const index = rows.findIndex((item) => item.id === lead.id)
                        return (
                          <LeadItem
                            key={lead.id}
                            lead={lead}
                            now={view.now}
                            timezone={view.timezone}
                            current={index === safeCursor}
                            onOpen={() => {
                              setCursor(index)
                              setOpenId(lead.id)
                            }}
                            onRestore={() => setStatus(lead, 'new', 'Moved back to Today')}
                          />
                        )
                      })}
                    </div>
                  </Fragment>
                ))
              )}
            </>
          )}
        </main>
      </div>

      {screen === 'leads' && rows.length > 0 && (
        <div className="hints" aria-hidden="true">
          <span>
            <kbd>j</kbd>
            <kbd>k</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          {deskView === 'today' && (
            <>
              <span>
                <kbd>c</kbd> contacted
              </span>
              <span>
                <kbd>x</kbd> dismiss
              </span>
            </>
          )}
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      )}

      <div className="scrim" onClick={() => setOpenId(null)} aria-hidden="true" />
      <LeadDrawer
        lead={drawerOpen ? openLead : null}
        open={drawerOpen}
        where={openIndex >= 0 ? `${viewLabel} — ${openIndex + 1} of ${rows.length}` : ''}
        now={view.now}
        timezone={view.timezone}
        hasPrev={openIndex > 0}
        hasNext={openIndex >= 0 && openIndex < rows.length - 1}
        onPrev={() => step(-1)}
        onNext={() => step(1)}
        onClose={() => setOpenId(null)}
        onAction={onDrawerAction}
      />

      <div className={`toast ${toast ? 'show' : ''}`} role="status">
        <span>{toast?.text}</span>
        {toast?.undo && (
          <button type="button" onClick={toast.undo}>
            Undo
          </button>
        )}
      </div>
    </div>
  )
}
