'use client'

import { Container } from '@/components/elements/container'
import { Eyebrow } from '@/components/elements/eyebrow'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import type { LeadView, RadarView } from '@/lib/radars'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { EmailForm } from '../../email-form'
import { WebsiteForm } from '../../website-form'
import { ResearchProgress, stageFor } from './progress'
import { Results } from './results'
import { Framed } from './ui'

const ACTIVE_POLL_MS = 3000
const IDLE_POLL_MS = 60000
const READY_HOLD_MS = 1200

function isInProgress(status: string | undefined) {
  return status === 'queued' || status === 'running' || status === 'processing'
}

export function RadarClient({ token, initialView }: { token: string; initialView: RadarView }) {
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
  const lastStage = useRef<string>('')
  const sawProgress = useRef(isInProgress(initialView.initialRun?.status))

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
  const dailyStatus = view.latestDailyRun?.status
  const busy = isInProgress(initialStatus) || isInProgress(dailyStatus)

  // Poll saved state. Fast while research is in progress; slow otherwise so morning results appear.
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

  // Briefly show the completed checklist when results arrive during this visit.
  useEffect(() => {
    if (isInProgress(initialStatus)) sawProgress.current = true
    if (initialStatus === 'completed' && sawProgress.current) {
      sawProgress.current = false
      setHoldReady(true)
      const timer = setTimeout(() => setHoldReady(false), READY_HOLD_MS)
      return () => clearTimeout(timer)
    }
  }, [initialStatus])

  // Announce stage changes to assistive technology.
  useEffect(() => {
    const run = view.initialRun
    let message = ''
    if (run?.status === 'failed') message = 'Research could not be completed.'
    else if (run?.retrying) message = 'Research is being retried.'
    else if (run) {
      const { active } = stageFor(run)
      message = ['Website received', 'Researching your business and opportunities', 'Checking and preparing your leads', 'Your leads are ready', 'Your leads are ready'][active]
    }
    if (message && message !== lastStage.current) {
      lastStage.current = message
      setAnnouncement(message)
    }
  }, [view.initialRun])

  const actions = {
    setLeadStatus: async (leadId: string, status: LeadView['status']) => {
      setView((current) => ({
        ...current,
        leads: current.leads.map((lead) => (lead.id === leadId ? { ...lead, status } : lead)),
      }))
      const response = await api(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify({ status }) }).catch(() => null)
      if (!response?.ok) refresh()
    },
    saveFocus: async (focus: { services: string[]; market: string } | null) => {
      const response = await api('/focus', {
        method: 'PATCH',
        body: JSON.stringify(focus ?? { reset: true }),
      }).catch(() => null)
      if (!response) return 'We couldn’t save your focus. Check your connection.'
      if (!response.ok) return (await response.json().catch(() => ({}))).error ?? 'We couldn’t save your focus.'
      await refresh()
      return null
    },
    setTimezone: async (timezone: string) => {
      await api('/timezone', { method: 'PATCH', body: JSON.stringify({ timezone }) }).catch(() => null)
      await refresh()
    },
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

  const run = view.initialRun
  const slow = run ? now - Date.parse(run.createdAt) > view.slowRunThresholdMs : false
  let content

  if (!view.hasEmail) {
    content = (
      <section className="py-16">
        <Container className="flex flex-col gap-10">
          <div className="flex max-w-2xl flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Eyebrow>Private radar · {view.websiteHost}</Eyebrow>
              <Subheading>Where should we send your leads?</Subheading>
            </div>
            <Text className="text-pretty">
              Your research has already started. Add your email and we’ll send your first leads as soon as they’re
              ready, then new matches every morning.
            </Text>
          </div>
          <Framed color="blue" className="max-w-3xl" surfaceClassName="p-6 sm:p-10">
            <EmailForm token={token} onSaved={refresh} />
          </Framed>
        </Container>
      </section>
    )
  } else if (!run || run.status !== 'completed' || holdReady) {
    content = (
      <ResearchProgress
        run={holdReady && run ? { ...run, status: 'completed' } : run}
        websiteHost={view.websiteHost}
        slow={slow}
        privateUrl={privateUrl}
        onRetry={retry}
        retrying={retrying}
        retryError={retryError}
        expired={view.expired}
      />
    )
  } else if (run.outcome === 'website_unreadable' || (run.outcome === 'validation_failed' && !view.profileServices.length)) {
    content = (
      <DeadEnd
        host={view.websiteHost}
        title="We couldn’t read enough of this website to find relevant leads. Try a services-page URL."
        body={`We tried ${view.websiteHost} but couldn’t confirm a concrete service from its pages. Enter the page that describes what you sell.`}
      />
    )
  } else if (run.outcome === 'unsupported_business') {
    content = (
      <DeadEnd
        host={view.websiteHost}
        title="This website isn’t a good fit for lead research"
        body={
          run.limitations[0] ||
          'Lead Radar works for agencies, consultants and other B2B service businesses whose buyers post public requests.'
        }
      />
    )
  } else {
    content = <Results view={view} privateUrl={privateUrl} actions={actions} />
  }

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      {content}
    </>
  )
}

function DeadEnd({ host, title, body }: { host: string; title: string; body: string }) {
  return (
    <section className="py-16">
      <Container className="flex flex-col gap-10">
        <div className="flex max-w-3xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Eyebrow>Private radar · {host}</Eyebrow>
            <Subheading>{title}</Subheading>
          </div>
          <Text className="text-pretty">{body}</Text>
        </div>
        <Framed color="brown" className="max-w-3xl" surfaceClassName="p-6 sm:p-8">
          <WebsiteForm />
        </Framed>
      </Container>
    </section>
  )
}
