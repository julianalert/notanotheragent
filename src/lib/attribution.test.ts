import { describe, expect, it } from 'vitest'
import { hasSource, parseAttribution } from './attribution'

describe('parseAttribution', () => {
  it('keeps campaign tags, the referring host and the landing path', () => {
    expect(
      parseAttribution({ utm_source: 'linkedin', utm_campaign: 'agency-q3', referrer: 'www.Google.com', landing_path: '/pricing?x=1' }),
    ).toEqual({
      utm_source: 'linkedin',
      utm_medium: null,
      utm_campaign: 'agency-q3',
      utm_term: null,
      utm_content: null,
      referrer: 'google.com',
      landing_path: '/pricing',
    })
  })

  it('never keeps a private path', () => {
    expect(parseAttribution({ landing_path: '/r/secret-token' })).toBeNull()
    expect(parseAttribution({ utm_source: 'x', landing_path: '/unsubscribe/abc' })?.landing_path).toBeNull()
  })

  it('drops markup, oversize values and junk types', () => {
    const parsed = parseAttribution({ utm_source: '<script>alert(1)</script>', utm_medium: 'a'.repeat(500), utm_term: 42, referrer: 'not a host' })
    expect(parsed?.utm_source).toBe('scriptalert(1)/script')
    expect(parsed?.utm_medium).toHaveLength(120)
    expect(parsed?.utm_term).toBeNull()
    expect(parsed?.referrer).toBeNull()
  })

  it('returns null for empty or invalid input', () => {
    expect(parseAttribution(null)).toBeNull()
    expect(parseAttribution('utm_source=x')).toBeNull()
    expect(parseAttribution({})).toBeNull()
  })

  it('tells a campaign or referral from a direct visit', () => {
    expect(hasSource(parseAttribution({ landing_path: '/' }))).toBe(false)
    expect(hasSource(parseAttribution({ landing_path: '/', referrer: 'news.ycombinator.com' }))).toBe(true)
    expect(hasSource(parseAttribution({ utm_medium: 'email' }))).toBe(true)
  })
})
