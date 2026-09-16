'use client'

import { ArrowNarrowRightIcon } from '@/components/icons/arrow-narrow-right-icon'
import { ClockIcon } from '@/components/icons/clock-icon'
import { SourceIcon } from '@/components/icons/source-icon'
import type { LeadView } from '@/lib/radars'
import type { EvidenceT } from '@/lib/research/contract'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { calendarDate, foundLabel, hostOf, publishedAgo, shortDate } from './lib'

const CONTACT_KIND = {
  original_post: 'Reply on the original post',
  public_profile: 'Public profile',
  business_contact: 'Business contact page',
} as const

export function IntentTag({ lead }: { lead: LeadView }) {
  if (lead.data.intent === 'explicit_request') return <span className="tag tag--request">Explicit request</span>
  if (lead.data.intent === 'trigger_event') return <span className="tag tag--trigger">Trigger signal</span>
  return <span className="tag tag--problem">Stated problem</span>
}

export function statusNote(lead: LeadView, timezone: string) {
  if (lead.status === 'new') return null
  const verb = lead.status === 'contacted' ? 'Contacted' : 'Dismissed'
  return lead.statusAt ? `${verb} ${shortDate(lead.statusAt, timezone)}` : verb
}

function author(lead: LeadView) {
  const d = lead.data
  return d.person_name ?? d.public_handle ?? d.company_name ?? 'Author not publicly identified'
}

function excerptOf(lead: LeadView) {
  const d = lead.data
  return d.need_evidence_ids.map((id) => d.evidence.find((item) => item.id === id)).find((item) => item?.excerpt.trim())
}

/* --------------------------------- List --------------------------------- */

export function LeadItem({
  lead,
  now,
  timezone,
  current,
  onOpen,
  onRestore,
}: {
  lead: LeadView
  now: string
  timezone: string
  current: boolean
  onOpen: () => void
  onRestore: () => void
}) {
  const d = lead.data
  const quote = excerptOf(lead)
  const note = statusNote(lead, timezone)
  const named = d.person_name ?? d.public_handle ?? d.company_name
  const host = hostOf(d.source_url)
  const intent = d.intent === 'explicit_request' ? 'request' : d.intent === 'trigger_event' ? 'trigger' : 'problem'
  return (
    // A div with button semantics: the item contains its own Restore button, and buttons can't nest.
    <div
      role="button"
      tabIndex={0}
      className={`item item--${intent} ${lead.status === 'dismissed' ? 'is-dismissed' : ''}`}
      aria-current={current}
      data-lead-id={lead.id}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <span className="item__top">
        <IntentTag lead={lead} />
        {note && <span className={`tag tag--state ${lead.status === 'contacted' ? 'tag--contacted' : ''}`}>{note}</span>}
        <span className="item__time">
          <ClockIcon width={12} height={12} aria-hidden="true" />
          {d.date_status === 'unknown' ? 'Date not shown' : publishedAgo(d.published_date, now)}
        </span>
      </span>
      <h3>{d.headline}</h3>
      <span className="item__quote">
        <q>{quote?.excerpt ?? d.need_summary}</q>
      </span>
      <span className="item__foot">
        <span className="item__byline">
          <span className="item__avatar" aria-hidden="true">
            {named ? named.replace(/^@/, '').charAt(0).toUpperCase() : '?'}
          </span>
          <span className="item__byline-text">
            {named ? (
              <>
                From <b>{named}</b> on
              </>
            ) : (
              'Posted on'
            )}
          </span>
          <span className="item__host">
            <SourceIcon host={host} />
            {host}
          </span>
        </span>
        <span className="act">
          {lead.status === 'dismissed' ? (
            <button
              type="button"
              className="btn btn--line btn--sm"
              onClick={(event) => {
                event.stopPropagation()
                onRestore()
              }}
            >
              Restore
            </button>
          ) : (
            <span className="item__open">
              Open lead
              <ArrowNarrowRightIcon width={13} height={7} aria-hidden="true" />
            </span>
          )}
        </span>
      </span>
    </div>
  )
}

/* -------------------------------- Drawer -------------------------------- */

/** Clickable citation markers pointing at the lead's own evidence (research spec: citations beside claims). */
function Cites({ ids, evidence }: { ids: string[]; evidence: EvidenceT[] }) {
  return (
    <>
      {ids.map((id) => {
        const index = evidence.findIndex((item) => item.id === id)
        if (index < 0) return null
        const item = evidence[index]
        return (
          <a
            key={id}
            className="cite"
            href={item.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            title={item.title || hostOf(item.url)}
          >
            {index + 1}
            <span className="sr-only"> (source: {hostOf(item.url)})</span>
          </a>
        )
      })}
    </>
  )
}

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" referrerPolicy="no-referrer">
      {children}
    </a>
  )
}

export type DrawerAction = 'copy' | 'source' | 'contact' | 'dismiss' | 'restore' | 'reply' | 'rewrite'
export type RewriteStyle = 'shorter' | 'direct' | 'friendlier'

const STYLE_LABEL: Record<string, string> = { original: 'Original', shorter: 'Shorter', direct: 'More direct', friendlier: 'Friendlier' }

/**
 * Where "Reply" goes. Reddit handles get a prefilled direct message; a mailto contact route gets subject and body;
 * everything else opens the contact route with the message already copied.
 */
export function replyUrl(lead: LeadView, message: string) {
  const d = lead.data
  const route = d.contact_route.url
  const handle = d.public_handle?.replace(/^(u\/|@)/, '')
  if (/reddit\.com/i.test(d.source_url) && handle && !/^\[deleted\]$/i.test(handle)) {
    const params = new URLSearchParams({ to: handle, subject: d.headline.slice(0, 80), message })
    return `https://www.reddit.com/message/compose/?${params}`
  }
  if (route.startsWith('mailto:')) {
    const [address, query = ''] = route.slice(7).split('?')
    const params = new URLSearchParams(query)
    if (!params.has('subject')) params.set('subject', d.headline.slice(0, 80))
    params.set('body', message)
    return `mailto:${address}?${params}`
  }
  return route
}

export function LeadDrawer({
  lead,
  open,
  where,
  now,
  timezone,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onAction,
}: {
  lead: LeadView | null
  open: boolean
  where: string
  now: string
  timezone: string
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  onAction: (action: DrawerAction, message?: string, style?: RewriteStyle) => Promise<string | void> | void
}) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [rewriting, setRewriting] = useState<RewriteStyle | null>(null)
  const [variant, setVariant] = useState<string>('original')
  const drag = useRef<{ startY: number; dy: number; active: boolean }>({ startY: 0, dy: 0, active: false })

  // Reset the editable message and scroll position whenever another lead is shown.
  const leadId = lead?.id
  const [shownId, setShownId] = useState<string | undefined>(undefined)
  if (leadId !== shownId) {
    setShownId(leadId)
    setEditing(false)
    setVariant('original')
    setDraft(lead?.data.outreach_message ?? '')
  }
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [leadId])

  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  if (!lead) return <aside className="drawer" aria-hidden="true" />

  const d = lead.data
  const quote = excerptOf(lead)
  const note = statusNote(lead, timezone)
  const enrichment = d.enrichment ?? null
  const variants = [{ style: 'original', message: d.outreach_message }, ...(d.outreach_drafts ?? []).map((item) => ({ style: item.style, message: item.message }))]

  async function rewrite(style: RewriteStyle) {
    setRewriting(style)
    const message = await onAction('rewrite', draft, style)
    setRewriting(null)
    if (typeof message === 'string') {
      setDraft(message)
      setVariant(style)
      setEditing(false)
    }
  }
  const identityBits = [d.public_handle && d.person_name ? d.public_handle : null, d.role, d.company_name !== author(lead) ? d.company_name : null].filter(Boolean)

  function onGrabDown(event: React.PointerEvent) {
    if (!window.matchMedia('(max-width: 720px)').matches || !drawerRef.current) return
    drag.current = { startY: event.clientY, dy: 0, active: true }
    drawerRef.current.style.transition = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onGrabMove(event: React.PointerEvent) {
    if (!drag.current.active || !drawerRef.current) return
    drag.current.dy = Math.max(0, event.clientY - drag.current.startY)
    drawerRef.current.style.transform = `translateY(${drag.current.dy}px)`
  }
  function onGrabEnd() {
    if (!drag.current.active || !drawerRef.current) return
    drag.current.active = false
    drawerRef.current.style.transition = ''
    drawerRef.current.style.transform = ''
    if (drag.current.dy > 130) onClose()
  }

  return (
    <aside
      ref={drawerRef}
      className="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
      aria-hidden={!open}
      id={`lead-${lead.id}`}
    >
      <div
        className="grab"
        aria-hidden="true"
        onPointerDown={onGrabDown}
        onPointerMove={onGrabMove}
        onPointerUp={onGrabEnd}
        onPointerCancel={onGrabEnd}
      >
        <i />
      </div>
      <div className="drawer__bar">
        <button ref={closeRef} type="button" className="close" onClick={onClose} aria-label="Close lead">
          ✕
        </button>
        <span className="where">{where}</span>
        <span className="nav">
          <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label="Previous lead">
            ↑
          </button>
          <button type="button" onClick={onNext} disabled={!hasNext} aria-label="Next lead">
            ↓
          </button>
        </span>
      </div>

      <div className="drawer__body" ref={bodyRef}>
        <p className="head-tags">
          <IntentTag lead={lead} />
          <span>
            on <External href={d.source_url}>{hostOf(d.source_url)}</External>
          </span>
          <span>
            {d.date_status === 'unknown' ? 'Date not shown' : calendarDate(d.published_date)}, {foundLabel(lead.discoveredAt, now, timezone)}
          </span>
        </p>
        <h2 id="drawer-title">{d.headline}</h2>
        <p className="who">
          {author(lead)}
          {identityBits.length > 0 && `, ${identityBits.join(', ')}`}
          <Cites ids={d.identity_evidence_ids} evidence={d.evidence} />
        </p>
        {note && <p className="state-note">{note}</p>}

        <div className={`evidence ${d.intent === 'explicit_request' ? 'is-request' : d.intent === 'trigger_event' ? 'is-trigger' : ''}`}>
          <blockquote>{quote ? `“${quote.excerpt}”` : d.need_summary}</blockquote>
          <p className="evidence__meta">
            <span>{quote ? 'Their own words' : 'Our paraphrase'}</span>
            <span>
              {d.date_status === 'unknown' ? 'Date not shown' : `Posted ${calendarDate(d.published_date)}`}
              <Cites ids={d.date_evidence_ids} evidence={d.evidence} />
            </span>
            <External href={d.source_url}>Read the source</External>
          </p>
        </div>

        {quote && (
          <section className="sec">
            <h3>What they need</h3>
            <p>
              {d.need_summary}
              <Cites ids={d.need_evidence_ids} evidence={d.evidence} />
            </p>
          </section>
        )}

        <section className="sec">
          <h3>Why it fits</h3>
          <span className="service">{d.matched_service}</span>
          <p>{d.fit_explanation}</p>
          {d.fit_is_inferred && <span className="flag">Includes an inference — check it before relying on it</span>}
        </section>

        {d.outreach_angle && (
          <section className="sec">
            <h3>Suggested approach</h3>
            <p>{d.outreach_angle}</p>
          </section>
        )}

        {enrichment && (
          <section className="sec">
            <h3>
              Who they are <span className={`conf conf--${enrichment.confidence}`}>{enrichment.confidence} confidence</span>
            </h3>
            <dl className="facts facts--tight">
              {enrichment.company_name && (
                <div>
                  <dt>Company</dt>
                  <dd>{enrichment.company_name}</dd>
                </div>
              )}
              {enrichment.role && (
                <div>
                  <dt>Role</dt>
                  <dd>{enrichment.role}</dd>
                </div>
              )}
              {enrichment.location && (
                <div>
                  <dt>Location</dt>
                  <dd>{enrichment.location}</dd>
                </div>
              )}
              {enrichment.company_website && (
                <div>
                  <dt>Website</dt>
                  <dd>
                    <External href={enrichment.company_website}>{hostOf(enrichment.company_website)}</External>
                  </dd>
                </div>
              )}
              {enrichment.profile_url && (
                <div>
                  <dt>Profile</dt>
                  <dd>
                    <External href={enrichment.profile_url}>{hostOf(enrichment.profile_url)}</External>
                  </dd>
                </div>
              )}
            </dl>
            {enrichment.company_summary && <p>{enrichment.company_summary}</p>}
            <p className="enrich-note">
              Found on{' '}
              {enrichment.evidence.map((item, index) => (
                <span key={item.url}>
                  {index > 0 && ', '}
                  <External href={item.url}>{item.title || hostOf(item.url)}</External>
                </span>
              ))}
              . Public business information only; check it before relying on it.
            </p>
          </section>
        )}

        {d.caveats.length > 0 && (
          <section className="sec">
            <h3>Before you send</h3>
            <ul className="checks">
              {d.caveats.map((caveat, index) => (
                <li key={index}>{caveat}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="msg">
          <div className="msg__top">
            <h3>
              A first message, ready to send
              {d.outreach_language && !d.outreach_language.toLowerCase().startsWith('en') && (
                <small>in {d.outreach_language}</small>
              )}
            </h3>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing((value) => !value)}>
              {editing ? 'Done' : 'Edit'}
            </button>
          </div>
          <div className="msg__tools">
            {variants.length > 1 &&
              variants.map((item) => (
                <button
                  key={item.style}
                  type="button"
                  className={`chip ${variant === item.style ? 'is-on' : ''}`}
                  onClick={() => {
                    setVariant(item.style)
                    setDraft(item.message)
                    setEditing(false)
                  }}
                >
                  {STYLE_LABEL[item.style] ?? item.style}
                </button>
              ))}
            <span className="msg__rewrite">
              Rewrite:
              {(['shorter', 'direct', 'friendlier'] as RewriteStyle[]).map((style) => (
                <button key={style} type="button" className="link" disabled={rewriting !== null} onClick={() => rewrite(style)}>
                  {rewriting === style ? 'writing…' : STYLE_LABEL[style].toLowerCase()}
                </button>
              ))}
            </span>
          </div>
          {editing ? (
            <>
              <label htmlFor="drawer-message" className="sr-only">
                Edit the first message
              </label>
              <textarea
                id="drawer-message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                lang={d.outreach_language || undefined}
                autoFocus
              />
            </>
          ) : (
            <p className="msg__body" lang={d.outreach_language || undefined}>
              {draft}
            </p>
          )}
        </div>

        <dl className="facts">
          <div>
            <dt>Contact route</dt>
            <dd>
              <External href={d.contact_route.url}>{CONTACT_KIND[d.contact_route.kind]}</External>
              <Cites ids={d.contact_route.evidence_ids} evidence={d.evidence} />
            </dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>
              {d.deadline ?? 'Not publicly stated'}
              {d.deadline && <Cites ids={d.terms_evidence_ids} evidence={d.evidence} />}
            </dd>
          </div>
          <div>
            <dt>Budget</dt>
            <dd>
              {d.budget ?? 'Not publicly stated'}
              {d.budget && <Cites ids={d.terms_evidence_ids} evidence={d.evidence} />}
            </dd>
          </div>
          {d.location && (
            <div>
              <dt>Location</dt>
              <dd>{d.location}</dd>
            </div>
          )}
          {d.company_website && (
            <div>
              <dt>Website</dt>
              <dd>
                <External href={d.company_website}>{hostOf(d.company_website)}</External>
              </dd>
            </div>
          )}
        </dl>

        {d.evidence.length > 0 && (
          <details className="srcs">
            <summary>Sources ({d.evidence.length})</summary>
            <ol>
              {d.evidence.map((item) => (
                <li key={item.id}>
                  <External href={item.url}>{item.title || hostOf(item.url)}</External>
                  <span>
                    {hostOf(item.url)}
                    {item.excerpt && ` — “${item.excerpt}”`}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>

      <div className="drawer__foot">
        {lead.status === 'dismissed' ? (
          <>
            <button type="button" className="btn btn--line" onClick={() => onAction('restore')}>
              Restore to Today
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => onAction('source')}>
              Open source
            </button>
          </>
        ) : lead.status === 'contacted' ? (
          <>
            <button type="button" className="btn btn--line" onClick={() => onAction('copy', draft)}>
              Copy message
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => onAction('source')}>
              Open source
            </button>
            <button type="button" className="btn btn--quiet spacer" onClick={() => onAction('restore')}>
              Move back to Today
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn--brand" onClick={() => onAction('reply', draft)} title={replyUrl(lead, draft)}>
              Reply
            </button>
            <button type="button" className="btn btn--line" onClick={() => onAction('copy', draft)}>
              Copy message
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => onAction('source')}>
              Open source
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => onAction('contact')}>
              Mark contacted
            </button>
            <button type="button" className="btn btn--quiet spacer" onClick={() => onAction('dismiss')}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </aside>
  )
}
