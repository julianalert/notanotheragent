import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { lifecycleSteps, localHour } from './lifecycle'
import { renderLifecycleEmail, renderRunEmail, type LifecycleEmailInput } from './templates'

describe('trial email schedule', () => {
  it('follows a three-day trial: the day before, the end, two days later, a week later', () => {
    const steps = lifecycleSteps(3)
    expect(steps.map((step) => [step.kind, step.fromHours, step.untilHours])).toEqual([
      ['trial_ending', 48, 70],
      ['trial_ended', 72, 96],
      ['missed_matches', 120, 168],
      ['last_call', 240, 288],
    ])
    // Radars older than a window never enter it, and nobody hears a trial ended that they never had.
    expect(steps[1].requires).toEqual({ kind: 'trial_ending', sent: false })
    expect(steps[2].requires).toEqual({ kind: 'trial_ended', sent: true })
    expect(steps[3].requires).toEqual({ kind: 'trial_ended', sent: true })
  })

  it('reads the hour in the radar’s timezone', () => {
    const noonUtc = new Date('2026-09-20T12:00:00Z')
    expect(localHour(noonUtc, 'Europe/Paris')).toBe(14)
    expect(localHour(noonUtc, 'America/Los_Angeles')).toBe(5)
    expect(localHour(noonUtc, 'Not/AZone')).toBe(12)
  })
})

describe('trial emails', () => {
  const base: LifecycleEmailInput = {
    kind: 'trial_ending',
    websiteHost: 'acme-studio.com',
    privateUrl: 'https://app.example/r/secret-token',
    unsubscribeUrl: 'https://app.example/api/unsubscribe/code',
    priceUsd: 99,
    trialDays: 3,
    found: 4,
    contacted: 0,
    open: [],
  }

  it('the day before: recap, the price, and reply tips only when nothing was contacted', () => {
    const email = renderLifecycleEmail(base)
    expect(email.subject).toBe('Your free trial for acme-studio.com ends tomorrow')
    expect(email.text).toContain('found 4 leads')
    expect(email.text).toContain('$99 a month')
    expect(email.text).toContain('Two things get replies')
    expect(email.text).toContain('https://app.example/r/secret-token#activate')
    expect(renderLifecycleEmail({ ...base, contacted: 2 }).text).not.toContain('Two things get replies')
  })

  it('never claims leads that were not found', () => {
    const email = renderLifecycleEmail({ ...base, kind: 'trial_ended', found: 0 })
    expect(email.text).toContain('without finding a verified match')
    expect(email.text).not.toMatch(/found \d+ lead/)
  })

  it('the look at new posts says they are unverified and links none of them', () => {
    const email = renderLifecycleEmail({ ...base, kind: 'missed_matches', missed: { count: 3, titles: ['Looking for a Webflow studio <b>now</b>'] } })
    expect(email.subject).toBe('3 new posts look like buyers for acme-studio.com')
    expect(email.text).toContain('We only read their previews')
    expect(email.html).toContain('Looking for a Webflow studio &lt;b&gt;now&lt;/b&gt;')
    expect(email.html.match(/href="/g)?.length).toBe(3) // activate, private page, unsubscribe
  })

  it('run emails describe the trial while it runs and after it', () => {
    const run = { kind: 'initial' as const, outcome: 'no_candidates' as const, websiteHost: 'acme-studio.com', businessName: null, leads: [], privateUrl: 'https://app.example/r/t', unsubscribeUrl: 'https://app.example/u', plan: 'free' as const }
    const endsAt = new Date('2026-09-24T10:00:00Z')
    const during = renderRunEmail({ ...run, trial: { active: true, endsAt, timezone: 'Europe/Paris' } })
    expect(during.text).toContain('we’ll search again every morning')
    expect(during.text).toContain('until Thursday, Sep 24')
    const after = renderRunEmail({ ...run, trial: { active: false, endsAt, timezone: 'Europe/Paris' } })
    expect(after.text).not.toContain('we’ll search again every morning')
    expect(after.text).toContain('Your free trial for acme-studio.com has ended')
  })
})
