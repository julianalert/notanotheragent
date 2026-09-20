'use client'

import type { RadarView, RunView } from '@/lib/radars'
import type { RunProgress } from '@/lib/research/provider'
import { useState, type FormEvent } from 'react'
import { DeskEmailForm, DeskWebsiteForm } from './forms'
import { minutesAgo, relativeMoment } from './lib'

/* ------------------------------ Searching ------------------------------- */

/**
 * The waiting page follows the run's real steps. The discovery pipeline reports which step it is on and what the
 * finished ones produced (pages read, posts found, posts worth reading); those numbers are shown as they arrive.
 * Inside a step the bar eases towards the step's end from the time the step really started, so it keeps moving
 * without claiming work that hasn't happened. Providers that can't report steps get the plain three-state version.
 */
export const STEPS = [
  { label: 'Website received' },
  { label: 'Reading your website' },
  { label: 'Searching for buying signals' },
  { label: 'Sorting buyers from noise' },
  { label: 'Reading the most promising posts' },
  { label: 'Checking every claim against its source' },
  { label: 'Your leads are ready' },
]

const STEP_INDEX: Record<RunProgress['step'], number> = { brief: 1, search: 2, triage: 3, read: 4, qualify: 5 }
/** Where each step starts on the bar, and how long it usually takes (seconds) for the easing inside it. */
const BAR_START = [0, 4, 16, 32, 44, 58, 100]
const TYPICAL_SECONDS = [5, 45, 25, 30, 45, 150, 1]

export function stageFor(run: RunView | null): { active: number } {
  if (run?.status === 'completed') return { active: STEPS.length }
  if (run?.status === 'processing') return { active: 5 }
  if (run?.status === 'running') return { active: run.progress ? STEP_INDEX[run.progress.step] : 2 }
  return { active: 0 }
}

function barPercent(run: RunView | null, active: number, now: number) {
  if (active >= STEPS.length) return 100
  const from = BAR_START[active]
  const to = active === 5 ? 96 : BAR_START[active + 1]
  const since = run?.progress?.stepStartedAt ?? run?.startedAt ?? run?.createdAt
  const elapsed = since ? Math.max(0, (now - Date.parse(since)) / 1000) : 0
  let share = 1 - Math.exp(-elapsed / TYPICAL_SECONDS[active])
  // Qualification runs in groups: each finished group is real progress.
  const batches = run?.progress?.batches
  if (active === 5 && batches?.total) share = Math.max(share * 0.9, batches.done / batches.total)
  return Math.round(from + (to - from) * Math.min(share, 0.97))
}

const count = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`

/** What the current step is doing, with what the finished steps found. */
function stepDetail(active: number, host: string, progress: RunProgress | null) {
  const pages = progress?.websitePages
  const hits = progress?.hits
  const sources = progress?.sources
  switch (active) {
    case 0:
      return 'Your search is saved and starts in a moment.'
    case 1:
      return `Reading ${host} to understand what you sell, who you serve and how you talk about it.`
    case 2:
      return `${pages ? `Read ${count(pages, 'page', 'pages')} of your site. ` : ''}Scanning public posts and requests for people who need this right now.`
    case 3:
      return `${hits ? `Found ${count(hits, 'post', 'posts')}. ` : ''}Setting aside sellers, job ads and anything off-topic.`
    case 4:
      return `${sources ? `${count(sources, 'post looks', 'posts look')} like a real buyer. ` : ''}Opening each one to read it in full.`
    case 5: {
      const groups = progress?.batches && progress.batches.total > 1 ? ` ${progress.batches.done} of ${progress.batches.total} groups checked.` : ''
      return `${sources ? `Read ${count(sources, 'post', 'posts')} in full. ` : ''}Checking dates, authors and fit, and writing your first messages. This is the longest step, usually two to four minutes.${groups}`
    }
    default:
      return 'Opening your results.'
  }
}

/** A finished step says what it produced, when the run reported it. */
function stepFact(index: number, progress: RunProgress | null) {
  if (!progress) return null
  if (index === 1 && progress.websitePages) return `${count(progress.websitePages, 'page', 'pages')} read`
  if (index === 2 && progress.hits) return `${count(progress.hits, 'post', 'posts')} found`
  if (index === 4 && progress.sources) return `${progress.sources} read in full`
  return null
}

export function Searching({
  run,
  host,
  now,
  slow,
  expired,
  retrying,
  retryError,
  onRetry,
}: {
  run: RunView | null
  host: string
  now: number
  slow: boolean
  expired: boolean
  retrying: boolean
  retryError: string | null
  onRetry: () => void
}) {
  const failed = run?.status === 'failed' || run?.status === 'cancelled'
  const { active } = stageFor(run)
  const percent = failed ? BAR_START[Math.min(active, 5)] : barPercent(run, active, now)
  const current = Math.min(active, STEPS.length - 1)
  const stepNumber = Math.min(active + 1, STEPS.length)

  let helper = stepDetail(active, host, run?.progress ?? null)
  if (run?.retrying) helper = 'The research provider had a temporary problem. We’re retrying automatically.'
  else if (slow && active < 5 && !run?.progress) helper = 'Still researching. It can take up to ten minutes.'

  return (
    <>
      <div className="focus-status" role="status">
        {!failed && <span className="spinner" aria-hidden="true" />}
        <span>{failed ? 'Research stopped' : STEPS[current].label}</span>
      </div>
      <div className="run">
        <div className="run__top">
          <b>{failed ? ' ' : active >= STEPS.length ? 'Done' : `Step ${stepNumber} of ${STEPS.length}`}</b>
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
            const isCurrent = index === current && !done
            const errored = failed && isCurrent
            const className = done ? 'done' : errored ? 'failed' : isCurrent ? 'now' : 'todo'
            const fact = done ? stepFact(index, run?.progress ?? null) : null
            return (
              <li key={step.label} className={className}>
                <span className="dot" aria-hidden="true">
                  {done ? '✓' : errored ? '!' : ''}
                </span>
                <div>
                  <b>
                    <span className="sr-only">{done ? 'Completed: ' : errored ? 'Failed: ' : isCurrent ? 'In progress: ' : 'Pending: '}</span>
                    {step.label}
                    {fact && <span className="run__fact">{fact}</span>}
                  </b>
                  {isCurrent && !errored && <p>{helper}</p>}
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
    </>
  )
}

/* ------------------------------ Understood ------------------------------ */

/**
 * Shown during the wait as soon as the website has been read: what the search understood, and a way to correct it
 * before the results arrive. Most wrong first results come from a wrong reading of the business.
 */
export function Understood({ view, onAdjust }: { view: RadarView; onAdjust: () => void }) {
  if (!view.brief) return null
  const services = view.focusSelection?.services.length ? view.focusSelection.services : view.profileServices
  return (
    <section className="understood" aria-label="What we understood about your business">
      <h2>Here’s what we understood</h2>
      <dl>
        <div>
          <dt>You sell</dt>
          <dd>{view.brief.sells}</dd>
        </div>
        {view.brief.buyers.length > 0 && (
          <div>
            <dt>Your buyers</dt>
            <dd>{view.brief.buyers.join(' · ')}</dd>
          </div>
        )}
        {services.length > 0 && (
          <div>
            <dt>We’re searching for</dt>
            <dd>{services.slice(0, 5).join(' · ')}</dd>
          </div>
        )}
        {(view.focusSelection?.wanted || view.focusSelection?.avoid) && (
          <div>
            <dt>Your guidance</dt>
            <dd>
              {[view.focusSelection.wanted && `Want: ${view.focusSelection.wanted}`, view.focusSelection.avoid && `Skip: ${view.focusSelection.avoid}`]
                .filter(Boolean)
                .join(' · ')}
            </dd>
          </div>
        )}
      </dl>
      <p>
        Not quite right?{' '}
        <button type="button" className="link" onClick={onAdjust}>
          Correct it now
        </button>
        . Your service choices filter this search’s results, and you get one free second search with all your corrections.
      </p>
    </section>
  )
}

/** Under the progress: how to get back, since there is no account. */
export function WaitFooter({ emailMasked, linkCopied, onCopyLink }: { emailMasked: string | null; linkCopied: boolean; onCopyLink: () => void }) {
  return (
    <div className="focus-note">
      <span aria-hidden="true">💌</span>
      <div>
        <p>
          You can close this tab: we’ll email {emailMasked ?? 'you'} the moment your first leads are ready. The first ones usually show up
          here before the search ends.
        </p>
        <p>
          There’s no account, so this page’s link is your way back.{' '}
          <button type="button" className="link" onClick={onCopyLink}>
            {linkCopied ? 'Link copied' : 'Copy my private link'}
          </button>
        </p>
      </div>
    </div>
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

/** The one free second search, offered where it helps: an empty first search, or a focus corrected since. */
export function RerunOffer({ view, busy, onRerun, onAdjust }: { view: RadarView; busy: boolean; onRerun: () => void; onAdjust: (() => void) | null }) {
  if (!view.rerun.available) return null
  const empty = view.rerun.reason === 'no_leads'
  return (
    <div className="rerun">
      <div>
        <p className="rerun__title">{empty ? 'Search again, free' : 'Search again with your corrections, free'}</p>
        <p className="rerun__text">
          {empty
            ? 'One more search is on us. It looks at the same period from different angles. Tell us first who you want and who to skip, and it will use that.'
            : 'Your focus changed since the last search. One more search is on us, using it.'}
        </p>
      </div>
      <div className="rerun__side">
        <button type="button" className="btn btn--brand btn--sm" onClick={onRerun} disabled={busy}>
          {busy ? 'Starting…' : 'Search again'}
        </button>
        {onAdjust && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={onAdjust} disabled={busy}>
            Adjust my research first
          </button>
        )}
      </div>
    </div>
  )
}

export function NoResults({
  view,
  onActivate,
  activating,
  rerunning,
  onRerun,
  onAdjust,
}: {
  view: RadarView
  onActivate: () => void
  activating: boolean
  rerunning: boolean
  onRerun: () => void
  onAdjust: () => void
}) {
  const followUp = view.followUpRun
  const followUpRunning = followUp && ['queued', 'running', 'processing'].includes(followUp.status)
  const latest = followUp?.status === 'completed' ? followUp : view.initialRun
  const copy = EMPTY_COPY[latest?.outcome ?? 'no_candidates'] ?? EMPTY_COPY.no_candidates
  return (
    <div className="blank">
      <h2>{followUpRunning ? 'Searching again' : copy.title}</h2>
      {followUpRunning ? (
        <p>
          We’re running one more search with different angles{view.focusSelection ? ' and your corrections' : ''}
          {view.initialRun?.unresolved ? ', and checking the possible matches we couldn’t verify' : ''}.{' '}
          {followUp?.progress ? `${STEPS[stageFor(followUp).active]?.label ?? 'Working'}. ` : ''}This page updates when it’s done
          {view.emailUnsubscribed ? '.' : ', and we’ll email you if it finds something.'}
        </p>
      ) : (
        <p>{copy.body}</p>
      )}
      {!followUpRunning && <RerunOffer view={view} busy={rerunning} onRerun={onRerun} onAdjust={onAdjust} />}
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
  hint,
  onSave,
  onClose,
}: {
  view: RadarView
  /** When the change takes effect: depends on the plan and on whether a search is running. */
  hint: string
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
        never adds services your website doesn’t document. {hint}
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
