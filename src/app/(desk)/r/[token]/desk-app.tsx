'use client'

import type { LeadView, RadarView } from '@/lib/radars'
import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import { LinkIcon } from '@/components/icons/link-icon'
import { UserCircleIcon } from '@/components/icons/user-circle-icon'
import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LeadDrawer, LeadItem, replyUrl, type DrawerAction, type RewriteStyle } from './leads'
import { copyText, countWord, groupLabel, localDateKey, useToast } from './lib'
import { Rail, type DeskView } from './rail'
import { DeadEnd, EmailStep, FocusEditor, NoResults, Searching, STEPS, stageFor } from './screens'

const ACTIVE_POLL_MS = 3000
const IDLE_POLL_MS = 60000
const READY_HOLD_MS = 1200

const isInProgress = (status: string | undefined) => status === 'queued' || status === 'running' || status === 'processing'

/** One tap tells the agent why a lead was wrong; the answer shapes the next searches. */
const DISMISS_CHOICES = [
  { label: 'Not a buyer', value: 'not_a_buyer' },
  { label: 'Wrong need', value: 'wrong_need' },
  { label: 'Too old', value: 'too_old' },
  { label: 'Already knew', value: 'already_known' },
]

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
  const [activating, setActivating] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const lastStage = useRef('')
  const sawProgress = useRef(isInProgress(initialView.initialRun?.status))
  const { toast, show: showToast, hide: hideToast } = useToast()

  // Close the account dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!userMenuOpen) return
    const onDocClick = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [userMenuOpen])

  // Close the "Adjust my research" popup on Escape.
  useEffect(() => {
    if (!editingFocus) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditingFocus(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editingFocus])

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
    else if (run) message = STEPS[Math.min(stageFor(run).active, STEPS.length - 1)].label
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

  // Back from Stripe Checkout: one-time confirmation, then a clean URL.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('activated') !== '1') return
    url.searchParams.delete('activated')
    window.history.replaceState(null, '', url.toString())
    const timer = setTimeout(() => {
      showToast('Your agent is live. Its first search starts now.')
      refresh()
    }, 0)
    return () => clearTimeout(timer)
  }, [showToast, refresh])

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
    async (leadId: string, status: LeadView['status'], reason: string | null = null) => {
      setView((current) => ({
        ...current,
        leads: current.leads.map((lead) =>
          lead.id === leadId
            ? { ...lead, status, statusAt: status === 'new' ? null : new Date().toISOString(), dismissReason: status === 'dismissed' ? ((reason ?? lead.dismissReason ?? 'other') as LeadView['dismissReason']) : null }
            : lead,
        ),
      }))
      const response = await api(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }).catch(() => null)
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
      const undo = () => {
        void persistStatus(lead.id, previous)
        hideToast()
      }
      if (status === 'dismissed') {
        showToast(`${message} — why?`, undo, {
          options: DISMISS_CHOICES,
          onChoose: (reason) => {
            void persistStatus(lead.id, 'dismissed', reason)
            showToast('Noted. The next searches will avoid leads like this.')
          },
        })
      } else {
        showToast(message, undo)
      }
    },
    [rows, openId, persistStatus, showToast, hideToast],
  )

  const onDrawerAction = useCallback(
    async (action: DrawerAction, draft?: string, style?: RewriteStyle): Promise<string | void> => {
      if (!openLead) return
      const message = draft ?? openLead.data.outreach_message
      if (action === 'copy') {
        if (await copyText(message)) showToast('Message copied')
        return
      }
      if (action === 'reply') {
        // The message travels in the URL where the platform allows it; otherwise it is on the clipboard.
        const url = replyUrl(openLead, message)
        const prefilled = /reddit\.com\/message\/compose|^mailto:/i.test(url)
        if (!prefilled) await copyText(message)
        window.open(url, '_blank', 'noopener,noreferrer')
        if (openLead.status === 'new') setStatus(openLead, 'contacted', prefilled ? 'Marked contacted' : 'Message copied, marked contacted')
        return
      }
      if (action === 'rewrite' && style) {
        const response = await api(`/leads/${openLead.id}/draft`, { method: 'POST', body: JSON.stringify({ style }) }).catch(() => null)
        const body = (await response?.json().catch(() => ({}))) ?? {}
        if (!response?.ok || !body.draft) {
          showToast(body.error ?? 'We couldn’t rewrite the message. Try again.')
          return
        }
        setView((current) => ({
          ...current,
          leads: current.leads.map((lead) =>
            lead.id === openLead.id
              ? { ...lead, data: { ...lead.data, outreach_drafts: [...(lead.data.outreach_drafts ?? []).filter((item) => item.style !== style), body.draft] } }
              : lead,
          ),
        }))
        return body.draft.message as string
      }
      if (action === 'source') {
        window.open(openLead.data.source_url, '_blank', 'noopener,noreferrer')
        return
      }
      if (action === 'contact') return setStatus(openLead, 'contacted', 'Marked contacted')
      if (action === 'dismiss') return setStatus(openLead, 'dismissed', 'Lead dismissed')
      if (action === 'restore') return setStatus(openLead, 'new', 'Moved back to Today')
    },
    [openLead, setStatus, showToast, api],
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

  // Esc closes the open lead.
  useEffect(() => {
    if (screen !== 'leads' || !openId) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpenId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [screen, openId])

  async function saveFocus(focus: { services: string[]; market: string; wanted: string; avoid: string } | null) {
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

  /** Stripe Checkout (activation) and the Customer Portal (billing) are hosted pages: the browser goes there. */
  async function billing(path: '/checkout' | '/billing-portal') {
    setActivating(true)
    const response = await api(path, { method: 'POST' }).catch(() => null)
    const body = (await response?.json().catch(() => ({}))) ?? {}
    if (response?.ok && typeof body.url === 'string') {
      window.location.assign(body.url)
      return
    }
    setActivating(false)
    showToast(body.error ?? 'We couldn’t open the billing page. Try again.')
  }

  async function saveWebhook(url: string) {
    const response = await api('/webhook', { method: 'PATCH', body: JSON.stringify({ url }) }).catch(() => null)
    if (!response) return 'Check your connection and try again.'
    if (!response.ok) return ((await response.json().catch(() => ({}))).error as string | undefined) ?? 'We couldn’t save that.'
    await refresh()
    showToast(url ? 'New leads will also be posted there' : 'Webhook removed')
    return null
  }

  async function copyPrivateLink() {
    if (!(await copyText(privateUrl))) return
    showToast('Link copied. Save it somewhere safe to come back anytime.')
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
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
  const foundTodayCount = view.leads.filter((lead) => localDateKey(lead.discoveredAt, view.timezone) === todayKey).length

  let title: string
  if (screen === 'email') title = 'Your research has started'
  else if (screen === 'searching') title = 'Finding opportunities for your business'
  else if (screen === 'unreadable' || screen === 'unsupported') title = 'We couldn’t research this website yet'
  else if (screen === 'empty') title = 'No verified matches yet'
  else if (deskView === 'contacted') title = 'Leads you have reached out to'
  else if (deskView === 'dismissed') title = 'Leads you set aside'
  else if (counts.today === 0) title = 'Everything has been handled'
  else title = `${countWord(counts.today)} lead${counts.today === 1 ? '' : 's'} to review`

  const showFocus = view.focus && (screen === 'leads' || screen === 'empty')

  const groups = useMemo(() => {
    if (deskView !== 'today') return [{ key: deskView, label: deskView === 'contacted' ? 'Contacted' : 'Dismissed', leads: rows }]
    const map = new Map<string, LeadView[]>()
    for (const lead of rows) {
      const key = localDateKey(lead.discoveredAt, view.timezone)
      map.set(key, [...(map.get(key) ?? []), lead])
    }
    return [...map.entries()].map(([key, leads]) => ({ key, label: groupLabel(leads[0].discoveredAt, view.now, view.timezone), leads }))
  }, [deskView, rows, view.now, view.timezone])


  /* ----------------------------- Render ----------------------------- */

  if (screen === 'searching') {
    return (
      <div className="desk desk--focus">
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
        <header className="focus-nav">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="brand-mark">
            <img src="/logo.png" alt="Not Another Agent" />
          </span>
        </header>
        <main className="focus-main">
          <div className="focus-card">
            <p className="eyebrow">{view.websiteHost}</p>
            <h1>{title}</h1>
            <Searching
              run={holdReady && run ? { ...run, status: 'completed' } : run}
              now={now}
              slow={run ? now - Date.parse(run.createdAt) > view.slowRunThresholdMs : false}
              expired={view.expired}
              retrying={retrying}
              retryError={retryError}
              onRetry={retry}
            />
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="desk" data-drawer-open={drawerOpen ? '' : undefined}>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <div className="app">
        <Rail
          view={view}
          currentView={deskView}
          counts={counts}
          foundToday={foundTodayCount}
          viewsEnabled={screen === 'leads'}
          activating={activating}
          onActivate={() => billing('/checkout')}
          onPortal={() => billing('/billing-portal')}
          onWebhook={saveWebhook}
          onCopyLink={copyPrivateLink}
          onView={(next) => {
            setDeskView(next)
            setCursor(0)
            setOpenId(null)
          }}
          onTimezoneChange={setTimezone}
        />

        <div className="workspace">
          <header className="topbar">
            <div className="work-top__left">
              <span className="work-top__site">{view.websiteHost}</span>
              <div className="copy-link">
                <button
                  type="button"
                  className="copy-link-btn"
                  data-copied={linkCopied || undefined}
                  aria-describedby="copy-link-tip"
                  onClick={copyPrivateLink}
                >
                  {linkCopied ? <CheckmarkIcon width={12} height={12} strokeWidth={1.6} /> : <LinkIcon width={15} height={15} />}
                  {linkCopied ? 'Copied' : 'Copy private link'}
                </button>
                <div id="copy-link-tip" role="tooltip" className="copy-link-tip">
                  <b>This link is your way back</b>
                  <p>There’s no account or password. Bookmark this link or save it somewhere safe to open your leads again, from any device.</p>
                  <p className="copy-link-tip__note">It’s also in every email we send you. Anyone who has it can see your leads, so keep it private.</p>
                </div>
              </div>
            </div>
            <div className="work-top__user" ref={userMenuRef}>
              {view.emailMasked && <span className="work-top__email">{view.emailMasked}</span>}
              <button
                type="button"
                className="user-btn"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                aria-label="Account menu"
                onClick={() => setUserMenuOpen((value) => !value)}
              >
                <UserCircleIcon width={18} height={18} />
              </button>
              {userMenuOpen && (
                <div className="user-menu" role="menu">
                  {showFocus && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false)
                        setEditingFocus(true)
                      }}
                    >
                      Adjust my research
                    </button>
                  )}
                  {view.billingConfigured && view.plan !== 'free' && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setUserMenuOpen(false)
                        billing('/billing-portal')
                      }}
                    >
                      Manage billing
                    </button>
                  )}
                  <Link href="/#start" role="menuitem" onClick={() => setUserMenuOpen(false)}>
                    New search
                  </Link>
                </div>
              )}
            </div>
          </header>

          <main className="work">
            <h1>{title}</h1>

          {screen === 'email' && <EmailStep view={view} token={token} onSaved={refresh} />}

          {screen === 'unreadable' && <DeadEnd view={view} kind="unreadable" />}
          {screen === 'unsupported' && <DeadEnd view={view} kind="unsupported" />}
          {screen === 'empty' && <NoResults view={view} onActivate={() => billing('/checkout')} activating={activating} />}

          {screen === 'leads' && (
            <>
              {deskView !== 'today' && (
              <div className="summary">
                {deskView === 'contacted' ? (
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
              )}
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
                      ? view.agentLive
                        ? 'New matches land here from the morning search and from your watched sources through the day, and in your inbox.'
                        : 'Your agent is asleep. Activate it and new matches land here every morning and through the day.'
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
      </div>


      {editingFocus && showFocus && (
        <div className="focus-modal-scrim" onClick={() => setEditingFocus(false)}>
          <div className="focus-modal" onClick={(event) => event.stopPropagation()}>
            <FocusEditor view={view} onSave={saveFocus} onClose={() => setEditingFocus(false)} />
          </div>
        </div>
      )}

      <div className="scrim" onClick={() => setOpenId(null)} aria-hidden="true" />
      <LeadDrawer
        lead={drawerOpen ? openLead : null}
        open={drawerOpen}
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
        {toast?.choices && (
          <span className="choices">
            {toast.choices.options.map((option) => (
              <button key={option.value} type="button" className="choice" onClick={() => toast.choices!.onChoose(option.value)}>
                {option.label}
              </button>
            ))}
          </span>
        )}
        {toast?.undo && (
          <button type="button" onClick={toast.undo}>
            Undo
          </button>
        )}
      </div>
    </div>
  )
}
