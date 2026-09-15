'use client'

import { PlainButton } from '@/components/elements/button'
import { ChevronIcon } from '@/components/icons/chevron-icon'
import type { LeadView } from '@/lib/radars'
import type { EvidenceT } from '@/lib/research/contract'
import { clsx } from 'clsx/lite'
import type { ReactNode } from 'react'
import { Badge, CopyButton, ExternalLink, formatCalendarDate, formatDate, Framed, relativeCalendarDate } from './ui'

const CONTACT_KIND = {
  original_post: 'Reply on the original post',
  public_profile: 'Public profile',
  business_contact: 'Business contact page',
} as const

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Clickable citation markers beside a claim, pointing at the lead's own evidence list. */
function Cites({ ids, evidence }: { ids: string[]; evidence: EvidenceT[] }) {
  const marks = ids
    .map((id) => ({ index: evidence.findIndex((item) => item.id === id), item: evidence.find((item) => item.id === id) }))
    .filter((mark): mark is { index: number; item: EvidenceT } => Boolean(mark.item))
  if (!marks.length) return null
  return (
    <span className="ml-1 inline-flex gap-0.5 align-super text-[0.625rem]/none">
      {marks.map(({ index, item }) => (
        <a
          key={item.id}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          referrerPolicy="no-referrer"
          title={item.title || hostOf(item.url)}
          className="rounded-sm bg-mist-950/10 px-1 py-0.5 font-medium text-mist-700 tabular-nums hover:bg-mist-950/20 dark:bg-white/10 dark:text-mist-300 dark:hover:bg-white/20"
        >
          {index + 1}
          <span className="sr-only"> (source: {hostOf(item.url)})</span>
        </a>
      ))}
    </span>
  )
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h4 className="text-sm/7 font-semibold text-mist-950 dark:text-white">{children}</h4>
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs/6 text-mist-600 dark:text-mist-500">{label}</dt>
      <dd className="text-sm/6 text-mist-950 dark:text-white">{children}</dd>
    </div>
  )
}

export function LeadCard({
  lead,
  now,
  timezone,
  outputLanguage,
  onStatus,
}: {
  lead: LeadView
  now: string
  timezone: string
  outputLanguage?: string
  onStatus: (status: LeadView['status']) => void
}) {
  const d = lead.data
  const ev = d.evidence
  const explicit = d.intent === 'explicit_request'
  const primaryIdentity = d.person_name ?? d.public_handle ?? d.company_name
  const dismissed = lead.status === 'dismissed'
  const contacted = lead.status === 'contacted'
  const quote = d.need_evidence_ids.map((id) => ev.find((item) => item.id === id)).find((item) => item?.excerpt.trim())
  const showLanguage = d.outreach_language && !outputLanguage?.toLowerCase().startsWith(d.outreach_language.toLowerCase())

  return (
    <article
      aria-labelledby={`lead-${lead.id}`}
      className={clsx('rounded-lg bg-mist-950/2.5 p-2 dark:bg-white/5', dismissed && 'opacity-70')}
    >
      {/* 1. The opportunity and its evidence: what they need, who said it, where and when. */}
      <Framed color={explicit ? 'green' : 'blue'} surfaceClassName="flex flex-col gap-5 p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={explicit ? 'solid' : 'soft'}>{explicit ? 'Explicit request' : 'Stated problem'}</Badge>
          <Badge tone="outline">{d.source_platform}</Badge>
          <span className="text-xs/6 text-mist-600 dark:text-mist-400">
            Published {relativeCalendarDate(d.published_date, now)}
            <Cites ids={d.date_evidence_ids} evidence={ev} />
          </span>
          {contacted && <Badge tone="soft">Contacted</Badge>}
        </div>

        <div className="flex flex-col gap-2">
          <h3
            id={`lead-${lead.id}`}
            className="font-display text-2xl/8 tracking-tight text-pretty text-mist-950 sm:text-3xl/10 dark:text-white"
          >
            {d.headline}
          </h3>
          <p className="text-sm/7 text-mist-700 dark:text-mist-400">
            {primaryIdentity ? (
              <>
                <span className="font-medium text-mist-950 dark:text-white">{primaryIdentity}</span>
                {d.person_name && d.public_handle && <> ({d.public_handle})</>}
                {d.role && <> · {d.role}</>}
                {d.company_name && d.company_name !== primaryIdentity && <> · {d.company_name}</>}
                <Cites ids={d.identity_evidence_ids} evidence={ev} />
              </>
            ) : (
              'Author not publicly identified'
            )}
          </p>
        </div>

        {quote && (
          <figure className="flex flex-col gap-2">
            <blockquote className="border-l-2 border-mist-950/20 pl-4 text-base/7 text-pretty text-mist-950 dark:border-white/20 dark:text-white">
              “{quote.excerpt}”
            </blockquote>
            <figcaption className="flex flex-wrap items-center gap-x-2 pl-4 text-xs/6 text-mist-600 dark:text-mist-400">
              <ExternalLink href={d.source_url} className="text-xs/6">
                {hostOf(d.source_url)}
              </ExternalLink>
              <span aria-hidden="true">·</span>
              <span>{formatCalendarDate(d.published_date)}</span>
              <span aria-hidden="true">·</span>
              <span>Found {formatDate(lead.discoveredAt, timezone)}</span>
            </figcaption>
          </figure>
        )}

        <p className="text-sm/7 text-pretty text-mist-700 dark:text-mist-400">
          <span className="font-medium text-mist-950 dark:text-white">In short: </span>
          {d.need_summary}
          <Cites ids={d.need_evidence_ids} evidence={ev} />
        </p>
      </Framed>

      {/* 2. Why it fits and what to say. */}
      <div className="grid grid-cols-1 gap-8 p-6 sm:p-8 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <SectionLabel>Why it fits</SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="outline">{d.matched_service}</Badge>
              {d.fit_is_inferred && <span className="text-xs/6 text-mist-600 dark:text-mist-400">Includes an inference</span>}
            </div>
            <p className="text-sm/7 text-pretty text-mist-700 dark:text-mist-400">{d.fit_explanation}</p>
          </div>
          {d.outreach_angle && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Suggested approach</SectionLabel>
              <p className="text-sm/7 text-pretty text-mist-700 dark:text-mist-400">{d.outreach_angle}</p>
            </div>
          )}
          {d.caveats.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Keep in mind</SectionLabel>
              <ul className="list-[square] space-y-1 pl-5 text-sm/7 text-mist-700 marker:text-mist-400 dark:text-mist-400 dark:marker:text-mist-600">
                {d.caveats.map((caveat, index) => (
                  <li key={index}>{caveat}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4">
            <SectionLabel>
              First message
              {showLanguage && <span className="font-normal text-mist-600 dark:text-mist-400"> · in {d.outreach_language}</span>}
            </SectionLabel>
            <CopyButton text={d.outreach_message} label="Copy" copiedLabel="Copied" />
          </div>
          <p
            lang={d.outreach_language || undefined}
            className="rounded-lg bg-white p-5 text-sm/7 whitespace-pre-line text-mist-950 inset-ring-1 inset-ring-black/10 dark:bg-white/5 dark:text-white dark:inset-ring-white/10"
          >
            {d.outreach_message}
          </p>
        </div>
      </div>

      {/* 3. Reference details: contact, terms, and the full source list. */}
      <div className="flex flex-col gap-6 border-t border-mist-950/5 px-6 py-6 sm:px-8 dark:border-white/5">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="Contact route">
            <ExternalLink href={d.contact_route.url}>{CONTACT_KIND[d.contact_route.kind]}</ExternalLink>
            <Cites ids={d.contact_route.evidence_ids} evidence={ev} />
          </Fact>
          <Fact label="Deadline">
            {d.deadline ?? <span className="text-mist-500">Not publicly stated</span>}
            {d.deadline && <Cites ids={d.terms_evidence_ids} evidence={ev} />}
          </Fact>
          <Fact label="Budget">
            {d.budget ?? <span className="text-mist-500">Not publicly stated</span>}
            {d.budget && <Cites ids={d.terms_evidence_ids} evidence={ev} />}
          </Fact>
          {(d.location || d.company_website) && (
            <Fact label={d.company_website ? 'Website' : 'Location'}>
              {d.company_website ? (
                <ExternalLink href={d.company_website}>{hostOf(d.company_website)}</ExternalLink>
              ) : (
                d.location
              )}
            </Fact>
          )}
        </dl>

        {ev.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer text-sm/7 font-medium text-mist-950 marker:text-mist-400 dark:text-white">
              Sources ({ev.length})
            </summary>
            <ol className="mt-3 flex flex-col gap-4">
              {ev.map((item, index) => (
                <li key={item.id} className="flex gap-3 text-sm/6">
                  <span className="w-5 shrink-0 text-xs/6 text-mist-500 tabular-nums">{index + 1}</span>
                  <div className="flex min-w-0 flex-col">
                    <ExternalLink href={item.url} className="truncate">
                      {item.title || hostOf(item.url)}
                    </ExternalLink>
                    <span className="text-xs/5 text-mist-600 dark:text-mist-500">{hostOf(item.url)}</span>
                    {item.excerpt && <span className="mt-1 text-mist-700 dark:text-mist-300">“{item.excerpt}”</span>}
                    {item.paraphrase && <span className="text-mist-600 dark:text-mist-400">{item.paraphrase}</span>}
                  </div>
                </li>
              ))}
            </ol>
          </details>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={d.source_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-mist-950 px-3 py-1 text-sm/7 font-medium text-white hover:bg-mist-800 dark:bg-mist-300 dark:text-mist-950 dark:hover:bg-mist-200"
          >
            Open source <ChevronIcon />
          </a>
          <CopyButton text={d.outreach_message} label="Copy message" copiedLabel="Message copied" />
          {dismissed ? (
            <PlainButton onClick={() => onStatus('new')}>Restore</PlainButton>
          ) : (
            <>
              <PlainButton onClick={() => onStatus(contacted ? 'new' : 'contacted')} aria-pressed={contacted}>
                {contacted ? 'Marked contacted' : 'Mark contacted'}
              </PlainButton>
              <PlainButton onClick={() => onStatus('dismissed')} className="sm:ml-auto">
                Dismiss
              </PlainButton>
            </>
          )}
        </div>
      </div>
    </article>
  )
}
