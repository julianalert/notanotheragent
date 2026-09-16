'use client'

import type { RadarView, RunView } from '@/lib/radars'
import { useEffect, useState, type FormEvent } from 'react'
import { DeskEmailForm, DeskWebsiteForm } from './forms'
import { minutesAgo, relativeMoment } from './lib'

/* ------------------------------ Searching ------------------------------- */

/**
 * The research backend only reports two in-progress states (running, processing), which
 * would make for a very static screen on a run that takes a minute or more. So the
 * "running" state is presented as three steps here, and Searching below fakes movement
 * through them on a timer — cosmetic only, not read from anywhere else.
 */
export const STEPS = [
  { label: 'Website received', detail: 'Your research job is saved. You can close this tab.' },
  { label: 'Reading your website', detail: 'Understanding what you sell, who you serve and how you talk about it.' },
  { label: 'Searching for buying signals', detail: 'Scanning public posts and requests for people who need this right now.' },
  { label: 'Matching signals to your services', detail: 'Comparing what we found against your offer to keep only real fits.' },
  { label: 'Checking every claim against its source', detail: 'Opening sources, checking dates, removing duplicates and preparing first messages.' },
  { label: 'Your leads are ready', detail: 'Opening your results.' },
]

const RUNNING_SUBSTEPS = 3
const PERCENT_BY_ACTIVE: Record<number, number> = { 1: 10, 2: 28, 3: 46, 4: 75, 6: 100 }

/** Observable backend states only; the running sub-steps are faked on top of this in Searching. */
export function stageFor(run: RunView | null): { active: number; percent: number } {
  switch (run?.status) {
    case 'running':
      return { active: 1, percent: PERCENT_BY_ACTIVE[1] }
    case 'processing':
      return { active: 4, percent: PERCENT_BY_ACTIVE[4] }
    case 'completed':
      return { active: 6, percent: PERCENT_BY_ACTIVE[6] }
    default:
      return { active: 1, percent: PERCENT_BY_ACTIVE[1] }
  }
}

export function Searching({
  run,
  now,
  slow,
  expired,
  retrying,
  retryError,
  onRetry,
}: {
  run: RunView | null
  now: number
  slow: boolean
  expired: boolean
  retrying: boolean
  retryError: string | null
  onRetry: () => void
}) {
  const failed = run?.status === 'failed' || run?.status === 'cancelled'

  // Fake movement through the "researching" sub-steps so a run that takes a while still
  // feels like it's advancing; resets whenever the run isn't in that state, or is a new run.
  const [subStep, setSubStep] = useState(0)
  useEffect(() => {
    if (run?.status !== 'running') {
      setSubStep(0)
      return
    }
    const id = setInterval(() => setSubStep((step) => Math.min(step + 1, RUNNING_SUBSTEPS - 1)), 5000)
    return () => clearInterval(id)
  }, [run?.status, run?.id])

  const base = stageFor(run)
  const active = run?.status === 'running' ? base.active + subStep : base.active
  const percent = run?.status === 'running' ? PERCENT_BY_ACTIVE[base.active + subStep] : base.percent
  const stepNumber = Math.min(active + 1, STEPS.length)

  let helper = STEPS[Math.min(active, STEPS.length - 1)].detail
  if (run?.retrying) helper = 'The research provider had a temporary problem. We’re retrying automatically.'
  else if (slow && active < STEPS.length - 2) helper = 'Still researching. You can close this tab: we’ll email you when your leads are ready.'

  return (
    <>
      <div className="focus-status" role="status">
        {!failed && <span className="spinner" aria-hidden="true" />}
        <span>{failed ? 'Research stopped' : STEPS[Math.min(active, STEPS.length - 1)].label}</span>
      </div>
      <div className="run">
        <div className="run__top">
          <b>{failed ? ' ' : active >= STEPS.length ? 'Done' : `Step ${stepNumber} of ${STEPS.length}`}</b>
          <span>
            {percent}%{run && !failed && ` — ${minutesAgo(run.createdAt, now)}`}
          </span>
        </div>
        <div
          className={`bar-line ${failed ? 'is-failed' : ''}`}
          role="progressbar"
          aria-label="Research progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <i style={{ width: `${percent}%` }} />
        </div>
        <ol>
          {STEPS.map((step, index) => {
            const done = index < active
            const current = index === active
            const errored = failed && current
            const className = done ? 'done' : errored ? 'failed' : current ? 'now' : 'todo'
            return (
              <li key={step.label} className={className}>
                <span className="dot" aria-hidden="true">
                  {done ? '✓' : errored ? '!' : ''}
                </span>
                <div>
                  <b>
                    <span className="sr-only">{done ? 'Completed: ' : errored ? 'Failed: ' : current ? 'In progress: ' : 'Pending: '}</span>
                    {step.label}
                  </b>
                  {current && !errored && <p>{helper}</p>}
                  {errored && (
                    <>
                      <p>
                        {expired
                          ? 'This search couldn’t be completed, and the time to retry it has passed.'
                          : run?.errorCode === 'configuration'
                            ? 'Research is temporarily unavailable on our side. We’ve recorded the problem.'
                            : run?.canRetry
                              ? 'We couldn’t complete the research this time. Nothing was lost.'
                              : 'We couldn’t complete the research for this website.'}
                      </p>
                      {run?.canRetry && (
                        <button type="button" className="btn btn--brand btn--sm" style={{ marginTop: 12 }} onClick={onRetry} disabled={retrying}>
                          {retrying ? 'Retrying…' : 'Retry research'}
                        </button>
                      )}
                      {retryError && (
                        <p role="alert" className="form-error">
                          {retryError}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>
      {!failed && (
        <p className="focus-note">
          <span aria-hidden="true">💌</span>
          Feel free to close this tab. We’ll email you the moment your first leads are ready.
        </p>
      )}
    </>
  )
}

/* ------------------------------ No results ------------------------------ */

const EMPTY_COPY: Record<string, { title: string; body: string }> = {
  no_candidates: {
    title: 'No promising posts found yet',
    body: 'We searched public sources for people describing the problems you solve, and nothing close enough came up in this window.',
  },
  candidates_rejected: {
    title: 'Nothing passed the evidence check',
    body: 'We found possible matches, but each one was a seller, the wrong kind of buyer, closed, too old or outside what you offer. The list stays empty instead of filling up with guesses.',
  },
  candidates_unresolved: {
    title: 'Possible matches are waiting on verification',
    body: 'We found posts that could fit, but couldn’t confirm their date, author or source. We don’t show leads we can’t back up.',
  },
  research_incomplete: {
    title: 'This search didn’t finish cleanly',
    body: 'Too many sources were blocked or unavailable, so the search was incomplete. This is not the same as “no demand”; the next search tries again.',
  },
  // research-v1 outcomes
  no_matches: {
    title: 'Nothing passed the evidence check',
    body: 'We searched public sources. Nothing we found could be tied to a real, dated post that matches what you sell, so the list stays empty instead of filling up with guesses.',
  },
  insufficient_coverage: {
    title: 'We couldn’t reach enough sources',
    body: 'Too many of the sources we needed were blocked or unavailable, so this search was incomplete.',
  },
  validation_failed: {
    title: 'Nothing passed the evidence check',
    body: 'We found possible opportunities, but none had what we require: an original source, a publication date inside the window and a usable contact route.',
  },
}

export function NoResults({ view, onActivate, activating }: { view: RadarView; onActivate: () => void; activating: boolean }) {
  const followUp = view.followUpRun
  const followUpRunning = followUp && ['queued', 'running', 'processing'].includes(followUp.status)
  const latest = followUp?.status === 'completed' ? followUp : view.initialRun
  const copy = EMPTY_COPY[latest?.outcome ?? 'no_candidates'] ?? EMPTY_COPY.no_candidates
  return (
    <div className="blank">
      <h2>{followUpRunning ? 'Checking more angles' : copy.title}</h2>
      {followUpRunning ? (
        <p>
          The first search didn’t find enough verified leads, so we’re running one more search with different angles
          {view.initialRun?.unresolved ? ' and checking the possible matches we couldn’t verify' : ''}. This page updates
          when it’s done.
        </p>
      ) : (
        <p>{copy.body}</p>
      )}
      {view.agentLive && !followUpRunning && (
        <p>
          Your agent searches again every morning and watches your buyers’ communities through the day
          {view.emailUnsubscribed ? ', adding anything that qualifies here.' : ', and emails you as soon as something qualifies.'}
        </p>
      )}
      {!view.agentLive && !followUpRunning && view.profileServices.length > 0 && (
        <p>
          An empty first search is common: most buyer posts appear over weeks, not on one day. Activate your agent and it
          searches every morning, watches the communities where your buyers post, and learns from what you contact.{' '}
          {view.billingConfigured && (
            <button type="button" className="btn btn--brand btn--sm" style={{ marginTop: 10, display: 'block' }} onClick={onActivate} disabled={activating}>
              {activating ? 'Opening checkout…' : `Activate my agent · $${view.priceUsd}/month`}
            </button>
          )}
        </p>
      )}
      <p style={{ marginTop: 20 }}>
        If <b>{view.websiteHost}</b> isn’t the page that describes your services, point us at a more specific one.
      </p>
      <DeskWebsiteForm placeholder={`${view.websiteHost}/services`} />
      <p className="next">
        {view.lastResearchAt && <>Last searched {relativeMoment(view.lastResearchAt, view.now, view.timezone)}. </>}
        {view.agentLive && view.nextRunAt ? `Next search ${relativeMoment(view.nextRunAt, view.now, view.timezone)}, ${view.timezone}.` : ''}
      </p>
    </div>
  )
}

/* ------------------------------ Email step ------------------------------ */

export function EmailStep({ view, token, onSaved }: { view: RadarView; token: string; onSaved: () => void }) {
  return (
    <div className="blank">
      <h2>Where should we send your leads?</h2>
      <p>
        Research for <b>{view.websiteHost}</b> has already started. Add your email and we’ll send your first leads as
        soon as they’re ready, then new matches every morning.
      </p>
      <DeskEmailForm token={token} onSaved={onSaved} />
    </div>
  )
}

/* ------------------------------- Dead ends ------------------------------ */

export function DeadEnd({ view, kind }: { view: RadarView; kind: 'unreadable' | 'unsupported' }) {
  return (
    <div className="blank">
      <h2>{kind === 'unreadable' ? 'We couldn’t read enough of this website' : 'This website isn’t a good fit for lead research'}</h2>
      <p>
        {kind === 'unreadable'
          ? `We tried ${view.websiteHost} but couldn’t confirm a concrete service from its pages. Point us at the page that describes what you sell.`
          : view.initialRun?.limitations[0] ||
            'Not Another Agent works for agencies, consultants and other B2B service businesses whose buyers post public requests.'}
      </p>
      <DeskWebsiteForm placeholder={`${view.websiteHost}/services`} cta="Research this page" />
    </div>
  )
}

/* ------------------------------ Focus editor ---------------------------- */

export function FocusEditor({
  view,
  onSave,
  onClose,
}: {
  view: RadarView
  onSave: (focus: { services: string[]; market: string; wanted: string; avoid: string } | null) => Promise<string | null>
  onClose: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const selected = new Set(view.focusSelection?.services.length ? view.focusSelection.services : view.profileServices)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    setSaving(true)
    const problem = await onSave({
      services: data.getAll('services').map(String),
      market: String(data.get('market') ?? ''),
      wanted: String(data.get('wanted') ?? ''),
      avoid: String(data.get('avoid') ?? ''),
    })
    setSaving(false)
    if (problem) setError(problem)
    else onClose()
  }

  return (
    <form className="editor" onSubmit={submit}>
      <fieldset>
        <legend>Services to search for</legend>
        <div className="options">
          {view.profileServices.map((service) => (
            <label key={service}>
              <input type="checkbox" name="services" value={service} defaultChecked={selected.has(service)} />
              {service}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="title" htmlFor="desk-market">
          Market
        </label>
        <input
          id="desk-market"
          name="market"
          className="field"
          style={{ display: 'block', width: '100%', marginTop: 8 }}
          maxLength={200}
          defaultValue={view.focusSelection?.market ?? view.profileMarkets.slice(0, 2).join(', ')}
          placeholder="e.g. UK and Ireland"
        />
      </div>
      <div>
        <label className="title" htmlFor="desk-wanted">
          Who you want <small style={{ fontWeight: 400, opacity: 0.7 }}>(optional)</small>
        </label>
        <input
          id="desk-wanted"
          name="wanted"
          className="field"
          style={{ display: 'block', width: '100%', marginTop: 8 }}
          maxLength={300}
          defaultValue={view.focusSelection?.wanted ?? ''}
          placeholder="e.g. founders of B2B SaaS with 5–50 people, not freelancers"
        />
      </div>
      <div>
        <label className="title" htmlFor="desk-avoid">
          Who to skip <small style={{ fontWeight: 400, opacity: 0.7 }}>(optional)</small>
        </label>
        <input
          id="desk-avoid"
          name="avoid"
          className="field"
          style={{ display: 'block', width: '100%', marginTop: 8 }}
          maxLength={300}
          defaultValue={view.focusSelection?.avoid ?? ''}
          placeholder="e.g. students, agencies selling the same thing, e-commerce stores"
        />
      </div>
      <p className="form-hint" style={{ marginTop: 0 }}>
        Only services found on your website can be searched. Guidance steers what the agent looks for and accepts; it
        never adds services your website doesn’t document. Changes apply to the next search.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="btn btn--brand btn--sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save focus'}
        </button>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>
          Cancel
        </button>
        {view.focusSelection && (
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            onClick={async () => {
              setSaving(true)
              await onSave(null)
              setSaving(false)
              onClose()
            }}
          >
            Use automatic focus
          </button>
        )}
      </div>
    </form>
  )
}
