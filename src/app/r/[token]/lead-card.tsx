'use client'

import { PlainButton } from '@/components/elements/button'
import { ChevronIcon } from '@/components/icons/chevron-icon'
import type { LeadView } from '@/lib/radars'
import type { EvidenceT } from '@/lib/research/contract'
import { clsx } from 'clsx/lite'
import type { ReactNode } from 'react'
import { Badge, CopyButton, ExternalLink, formatCalendarDate, formatDate } from './ui'

const NOT_IDENTIFIED = 'Not publicly identified'
const NOT_STATED = 'Not publicly stated'

const CONTACT_KIND = {
  original_post: 'Original post',
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

function Field({ label, value, fallback, cites }: { label: string; value: ReactNode | null; fallback: string; cites?: ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs/6 text-mist-600 dark:text-mist-500">{label}</dt>
      <dd className={clsx('text-sm/6', value ? 'text-mist-950 dark:text-white' : 'text-mist-500 italic dark:text-mist-500')}>
        {value ?? fallback}
        {value && cites}
      </dd>
    </div>
  )
}

function Block({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="flex flex-wrap items-center gap-2 text-xs/6 font-semibold text-mist-700 dark:text-mist-400">
        {title}
        {aside}
      </h4>
      <div className="text-sm/6 text-pretty text-mist-950 dark:text-white">{children}</div>
    </div>
  )
}

export function LeadCard({
  lead,
  timezone,
  outputLanguage,
  onStatus,
}: {
  lead: LeadView
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
      className={clsx('flex flex-col gap-6 rounded-xl bg-mist-950/2.5 p-6 dark:bg-white/5', dismissed && 'opacity-70')}
    >
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={explicit ? 'solid' : 'soft'}>{explicit ? 'Explicit request' : 'Stated problem'}</Badge>
          <Badge tone="outline">{d.source_platform}</Badge>
          {contacted && <Badge tone="soft">Contacted</Badge>}
        </div>
        <h3 id={`lead-${lead.id}`} className="text-xl/8 font-medium tracking-tight text-pretty text-mist-950 dark:text-white">
          {d.headline}
        </h3>
        <p className="text-sm/6 text-mist-700 dark:text-mist-400">
          {primaryIdentity ? (
            <>
              <span className="font-medium text-mist-950 dark:text-white">{primaryIdentity}</span>
              {d.person_name && d.public_handle && <> ({d.public_handle})</>}
              {d.company_name && d.company_name !== primaryIdentity && <> · {d.company_name}</>}
              <Cites ids={d.identity_evidence_ids} evidence={ev} />
            </>
          ) : (
            NOT_IDENTIFIED
          )}
        </p>
      </header>

      <figure className="flex flex-col gap-2 border-l-2 border-mist-950/20 pl-4 dark:border-white/20">
        <figcaption className="text-xs/6 font-semibold text-mist-700 dark:text-mist-400">The need (paraphrase)</figcaption>
        <p className="text-base/7 text-pretty text-mist-950 dark:text-white">
          {d.need_summary}
          <Cites ids={d.need_evidence_ids} evidence={ev} />
        </p>
        {quote && (
          <blockquote className="text-sm/6 text-pretty text-mist-700 dark:text-mist-300">
            <span className="sr-only">Excerpt from the source: </span>“{quote.excerpt}”
          </blockquote>
        )}
        <p className="flex flex-wrap gap-x-2 text-xs/6 text-mist-600 dark:text-mist-400">
          <ExternalLink href={d.source_url} className="text-xs/6">
            {hostOf(d.source_url)}
          </ExternalLink>
          <span aria-hidden="true">·</span>
          <span>
            Published {formatCalendarDate(d.published_date)}
            <Cites ids={d.date_evidence_ids} evidence={ev} />
          </span>
          <span aria-hidden="true">·</span>
          <span>Found {formatDate(lead.discoveredAt, timezone)}</span>
        </p>
      </figure>

      <Block
        title="Why it fits"
        aside={
          <>
            <Badge tone="outline">{d.matched_service}</Badge>
            {d.fit_is_inferred && <span className="font-normal text-mist-600 dark:text-mist-400">Includes an inference</span>}
          </>
        }
      >
        {d.fit_explanation}
      </Block>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg bg-white/60 p-4 inset-ring-1 inset-ring-mist-950/5 sm:grid-cols-2 dark:bg-white/5 dark:inset-ring-white/5">
        <Field label="Person or handle" value={d.person_name ?? d.public_handle} fallback={NOT_IDENTIFIED} />
        <Field label="Company" value={d.company_name} fallback={NOT_IDENTIFIED} />
        <Field label="Role" value={d.role} fallback={NOT_IDENTIFIED} />
        <Field
          label="Website"
          value={d.company_website ? <ExternalLink href={d.company_website}>{hostOf(d.company_website)}</ExternalLink> : null}
          fallback={NOT_IDENTIFIED}
        />
        <Field label="Location" value={d.location} fallback={NOT_IDENTIFIED} />
        <Field label="Deadline" value={d.deadline} fallback={NOT_STATED} cites={<Cites ids={d.terms_evidence_ids} evidence={ev} />} />
        <Field label="Budget" value={d.budget} fallback={NOT_STATED} cites={<Cites ids={d.terms_evidence_ids} evidence={ev} />} />
        <Field
          label="Contact route"
          value={
            <>
              <ExternalLink href={d.contact_route.url}>
                {CONTACT_KIND[d.contact_route.kind]}
                <span className="sr-only"> (opens {hostOf(d.contact_route.url)})</span>
              </ExternalLink>
              <Cites ids={d.contact_route.evidence_ids} evidence={ev} />
              {d.contact_route.explanation && (
                <span className="block text-xs/5 text-mist-600 dark:text-mist-400">{d.contact_route.explanation}</span>
              )}
            </>
          }
          fallback={NOT_IDENTIFIED}
        />
      </dl>

      {d.caveats.length > 0 && (
        <Block title="Caveats">
          <ul className="list-[square] space-y-1 pl-5 marker:text-mist-400">
            {d.caveats.map((caveat, index) => (
              <li key={index}>{caveat}</li>
            ))}
          </ul>
        </Block>
      )}

      {d.outreach_angle && <Block title="Suggested approach">{d.outreach_angle}</Block>}

      <div className="flex flex-col gap-2">
        <h4 className="text-xs/6 font-semibold text-mist-700 dark:text-mist-400">
          First message{showLanguage && <span className="font-normal"> · written in {d.outreach_language}</span>}
        </h4>
        <p
          lang={d.outreach_language || undefined}
          className="rounded-lg bg-white p-4 text-sm/6 whitespace-pre-line text-mist-950 inset-ring-1 inset-ring-black/10 dark:bg-white/5 dark:text-white dark:inset-ring-white/10"
        >
          {d.outreach_message}
        </p>
      </div>

      {ev.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs/6 font-semibold text-mist-700 marker:text-mist-400 dark:text-mist-400">
            Sources ({ev.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-3">
            {ev.map((item, index) => (
              <li key={item.id} className="flex gap-3 text-sm/6">
                <span className="w-5 shrink-0 text-xs/6 text-mist-500 tabular-nums">{index + 1}</span>
                <div className="flex min-w-0 flex-col">
                  <ExternalLink href={item.url} className="truncate">
                    {item.title || hostOf(item.url)}
                  </ExternalLink>
                  <span className="text-xs/5 text-mist-600 dark:text-mist-400">{hostOf(item.url)}</span>
                  {item.excerpt && <span className="mt-1 text-mist-700 dark:text-mist-300">“{item.excerpt}”</span>}
                  {item.paraphrase && (
                    <span className="text-mist-600 dark:text-mist-400">
                      <span className="sr-only">Paraphrase: </span>
                      {item.paraphrase}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-mist-950/10 pt-4 dark:border-white/10">
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
    </article>
  )
}
