import { describe, expect, it } from 'vitest'
import { latestPossibleRedditDates, redditPostNumber } from './reddit'

const NOW = new Date('2026-09-17T07:00:00Z')
const DAY_MS = 86_400_000
const daysAgo = (time: number | undefined) => (NOW.getTime() - time!) / DAY_MS

describe('Reddit post age from ids', () => {
  it('reads the post id from post and comment URLs only', () => {
    expect(redditPostNumber('https://www.reddit.com/r/agency/comments/1h0haug/what_lead_generation/')).toBe(parseInt('1h0haug', 36))
    expect(redditPostNumber('https://old.reddit.com/r/agency/comments/1H0HAUG.json')).toBe(parseInt('1h0haug', 36))
    expect(redditPostNumber('https://www.reddit.com/r/agency/new/')).toBeNull()
    expect(redditPostNumber('https://www.warriorforum.com/comments/1h0haug/')).toBeNull()
  })

  it('bounds old threads far outside a daily window and keeps fresh posts inside it', () => {
    const fresh = 'https://www.reddit.com/r/CustomerSuccess/comments/1wgyisa/best_lead_generation_tools/' // 2026-09-15
    const lastYear = 'https://www.reddit.com/r/LeadGeneration/comments/1mwudsa/suggest_me_a_no_bs_way/' // 2025-08
    const spring = 'https://www.reddit.com/r/agency/comments/1s5nq4b/3_months_ago/' // 2026-04
    const dates = latestPossibleRedditDates([fresh, lastYear, spring, 'https://example.org/post'], NOW)
    expect(dates.size).toBe(3)
    expect(daysAgo(dates.get(fresh))).toBeLessThan(1)
    expect(daysAgo(dates.get(lastYear))).toBeGreaterThan(150)
    expect(daysAgo(dates.get(spring))).toBeGreaterThan(60)
  })

  it('never reports a post as older than it is (the bound is later than the real date)', () => {
    const url = 'https://www.reddit.com/r/advertising/comments/1wf8k2e/get_out_of_agencies/' // really 2026-09-12
    const bound = latestPossibleRedditDates([url, 'https://www.reddit.com/r/x/comments/1wh3rwm/y/'], NOW).get(url)!
    expect(bound).toBeGreaterThan(Date.parse('2026-09-12T00:00:00Z'))
  })

  it('ignores an id that cannot exist yet when looking for the newest post', () => {
    const real = 'https://www.reddit.com/r/x/comments/1wgyisa/y/'
    const dates = latestPossibleRedditDates([real, 'https://www.reddit.com/r/x/comments/zzzzzzz/y/'], NOW)
    expect(daysAgo(dates.get(real))).toBeLessThan(1)
  })
})
