'use client'

import { Button, PlainButton } from '@/components/elements/button'
import { Container } from '@/components/elements/container'
import { Eyebrow } from '@/components/elements/eyebrow'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import { ArrowNarrowRightIcon } from '@/components/icons/arrow-narrow-right-icon'
import type { LeadView, RadarView } from '@/lib/radars'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { WebsiteForm } from '../../website-form'
import { LeadCard } from './lead-card'
import { StatusPanel } from './status-panel'
import { Badge, formatDate, formatDateTime, Framed, localDateKey, Panel } from './ui'

type Actions = {
  setLeadStatus: (leadId: string, status: LeadView['status']) => void
  saveFocus: (focus: { services: string[]; market: string } | null) => Promise<string | null>
  setTimezone: (timezone: string) => Promise<void>
}

function groupLabel(key: string, view: RadarView) {
  const today = localDateKey(new Date(view.now), view.timezone)
  const yesterday = localDateKey(new Date(new Date(view.now).getTime() - 86400000), view.timezone)
  if (key === today) return 'Found today'
  if (key === yesterday) return 'Found yesterday'
  return `Found ${formatDate(`${key}T12:00:00Z`, 'UTC')}`
}

function FocusEditor({ view, onSave, onClose }: { view: RadarView; onSave: Actions['saveFocus']; onClose: () => void }) {
  const id = useId()
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
    })
    setSaving(false)
    if (problem) setError(problem)
    else onClose()
  }

  return (
    <Panel className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm/6 font-medium text-mist-950 dark:text-white">Services to search for</legend>
          <p className="text-sm/6 text-mist-700 dark:text-mist-400">Only services found on your website can be searched.</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {view.profileServices.map((service, index) => (
              <label
                key={service}
                htmlFor={`${id}-service-${index}`}
                className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-white px-3 py-1 text-sm/6 text-mist-950 inset-ring-1 inset-ring-black/10 has-checked:bg-mist-950 has-checked:text-white dark:bg-white/10 dark:text-white dark:inset-ring-white/10 dark:has-checked:bg-white dark:has-checked:text-mist-950"
              >
                <input
                  id={`${id}-service-${index}`}
                  type="checkbox"
                  name="services"
                  value={service}
                  defaultChecked={selected.has(service)}
                  className="size-3.5 accent-current"
                />
                {service}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-col gap-1 sm:max-w-sm">
          <label htmlFor={`${id}-market`} className="text-sm/6 font-medium text-mist-950 dark:text-white">
            Market
          </label>
          <input
            id={`${id}-market`}
            name="market"
            defaultValue={view.focusSelection?.market ?? view.profileMarkets.slice(0, 2).join(', ')}
            maxLength={200}
            placeholder="e.g. UK and Ireland"
            className="rounded-full bg-white px-4 py-1.5 text-sm/6 text-mist-950 inset-ring-1 inset-ring-black/10 focus:outline-2 focus:outline-offset-2 focus:outline-mist-950 dark:bg-white/10 dark:text-white dark:inset-ring-white/10"
          />
        </div>
        <p className="text-sm/6 text-mist-700 dark:text-mist-400">
          Changes apply to future daily searches. They don’t start a new search or change your research period.
        </p>
        {error && (
          <p role="alert" className="text-sm/6 text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={saving} className="disabled:opacity-70">
            {saving ? 'Saving…' : 'Save focus'}
          </Button>
          <PlainButton onClick={onClose}>Cancel</PlainButton>
          {view.focusSelection && (
            <PlainButton
              onClick={async () => {
                setSaving(true)
                await onSave(null)
                setSaving(false)
                onClose()
              }}
              className="sm:ml-auto"
            >
              Use automatic focus
            </PlainButton>
          )}
        </div>
      </form>
    </Panel>
  )
}

const EMPTY_STATE: Record<string, { heading: string; body: string }> = {
  no_matches: {
    heading: 'We couldn’t verify suitable opportunities for this website today',
    body: 'We searched public sources but nothing passed our evidence and fit checks. We never fill the list with weak or invented leads.',
  },
  insufficient_coverage: {
    heading: 'We couldn’t verify suitable opportunities for this website today',
    body: 'Some sources couldn’t be reached, so today’s search was incomplete. We never fill the list with weak or invented leads.',
  },
  validation_failed: {
    heading: 'We couldn’t verify suitable opportunities for this website today',
    body: 'We found possible opportunities, but none had the evidence we require (an original source, a publication date inside the window and a usable contact route).',
  },
}

export function Results({ view, privateUrl, actions }: { view: RadarView; privateUrl: string; actions: Actions }) {
  const [editingFocus, setEditingFocus] = useState(false)
  const active = view.leads.filter((lead) => lead.status !== 'dismissed')
  const dismissed = view.leads.filter((lead) => lead.status === 'dismissed')
  const total = active.length
  const name = view.businessName ?? view.websiteHost
  const noLeadsYet = view.leads.length === 0
  const empty = EMPTY_STATE[view.initialRun?.outcome ?? 'no_matches'] ?? EMPTY_STATE.no_matches

  const groups = new Map<string, LeadView[]>()
  for (const lead of active) {
    const key = localDateKey(lead.discoveredAt, view.timezone)
    groups.set(key, [...(groups.get(key) ?? []), lead])
  }

  let heading: ReactNode
  if (noLeadsYet) heading = empty.heading
  else if (view.leads.length < 3)
    heading = (
      <>
        We found {view.leads.length} strong {view.leads.length === 1 ? 'match' : 'matches'} so far for{' '}
        <span className="text-mist-600 dark:text-mist-400">{name}</span>
      </>
    )
  else
    heading = (
      <>
        {total} {total === 1 ? 'opportunity' : 'opportunities'} for{' '}
        <span className="text-mist-600 dark:text-mist-400">{name}</span>
      </>
    )

  const card = (lead: LeadView) => (
    <LeadCard
      key={lead.id}
      lead={lead}
      now={view.now}
      timezone={view.timezone}
      outputLanguage={view.outputLanguage}
      onStatus={(status) => actions.setLeadStatus(lead.id, status)}
    />
  )

  return (
    <section className="py-16">
      <Container className="flex flex-col gap-10 sm:gap-16">
        <header className="flex flex-col gap-6">
          <div className="flex max-w-4xl flex-col gap-2">
            <Eyebrow>Private radar · {view.websiteHost}</Eyebrow>
            <Subheading>{heading}</Subheading>
          </div>

          {view.focus && (
            <div className="flex flex-col gap-3">
              <p className="text-sm/7 font-medium text-mist-950 dark:text-white">Searching for</p>
              <div className="flex flex-wrap items-center gap-2">
                {view.focus.services.split(' · ').map((service) => (
                  <Badge key={service} tone="soft">
                    {service}
                  </Badge>
                ))}
                <Badge tone="outline">{view.focus.customerType}</Badge>
                <Badge tone="outline">{view.focus.market}</Badge>
                {!view.expired && !editingFocus && (
                  <PlainButton onClick={() => setEditingFocus(true)} className="-my-1">
                    Adjust focus <ArrowNarrowRightIcon />
                  </PlainButton>
                )}
              </div>
            </div>
          )}

          <Text className="text-sm/7">
            {view.lastResearchAt && <>Last research {formatDateTime(view.lastResearchAt, view.timezone)}. </>}
            Bookmark this private link to come back to your results.
          </Text>

          {view.sampleData && (
            <p className="max-w-3xl rounded-lg bg-mist-950/5 px-4 py-2 text-sm/7 text-mist-950 dark:bg-white/10 dark:text-white">
              Development mode: these leads come from the sample research provider, not real research. They still pass
              through the real evidence gates.
            </p>
          )}
          {editingFocus && <FocusEditor view={view} onSave={actions.saveFocus} onClose={() => setEditingFocus(false)} />}
        </header>

        <div className="grid grid-cols-1 gap-10 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <aside className="lg:sticky lg:top-(--scroll-padding-top) lg:order-last" aria-label="Research status">
            <StatusPanel view={view} privateUrl={privateUrl} onTimezoneChange={actions.setTimezone} />
          </aside>

          <div className="flex flex-col gap-16">
            {noLeadsYet && (
              <Framed color="brown" surfaceClassName="flex flex-col gap-6 p-6 sm:p-10">
                <div className="flex flex-col gap-2">
                  <p className="font-display text-3xl/10 tracking-tight text-mist-950 dark:text-white">Nothing verified yet</p>
                  <Text className="text-pretty">
                    {empty.body}{' '}
                    {!view.expired && 'We’ll keep searching every morning during your free research period.'}
                  </Text>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-sm/7 text-mist-700 dark:text-mist-400">
                    If this isn’t the right page for your services, try a more specific URL.
                  </p>
                  <WebsiteForm />
                </div>
              </Framed>
            )}

            {!noLeadsYet && active.length === 0 && (
              <Panel>
                <Text>You’ve dismissed every lead so far. Dismissed leads are listed below.</Text>
              </Panel>
            )}

            {[...groups.entries()].map(([key, leads]) => (
              <section key={key} aria-labelledby={`group-${key}`} className="flex flex-col gap-4">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id={`group-${key}`} className="font-display text-2xl/8 tracking-tight text-mist-950 dark:text-white">
                    {groupLabel(key, view)}
                  </h2>
                  <Eyebrow>
                    {leads.length} {leads.length === 1 ? 'lead' : 'leads'}
                  </Eyebrow>
                </div>
                <div className="flex flex-col gap-6">{leads.map(card)}</div>
              </section>
            ))}

            {dismissed.length > 0 && (
              <details className="group">
                <summary className="cursor-pointer text-sm/7 font-semibold text-mist-700 marker:text-mist-400 dark:text-mist-400">
                  Dismissed ({dismissed.length})
                </summary>
                <div className="mt-4 flex flex-col gap-6">{dismissed.map(card)}</div>
              </details>
            )}
          </div>
        </div>
      </Container>
    </section>
  )
}
