import { describe, expect, it } from 'vitest'
import { cleanText, toJsonb } from './jsonb'

const rocket = String.fromCodePoint(0x1f680)
const nul = String.fromCharCode(0)

describe('JSON written to Postgres', () => {
  it('keeps whole emoji and ordinary text as they are', () => {
    expect(cleanText(`growth ${rocket} now`)).toBe(`growth ${rocket} now`)
    expect(JSON.parse(toJsonb({ a: [`ok ${rocket}`] }))).toEqual({ a: [`ok ${rocket}`] })
  })

  it('replaces the half emoji a slice() leaves behind, at any depth', () => {
    const cut = `growth ${rocket}`.slice(0, 8)
    expect(cut.isWellFormed()).toBe(false)
    const written = toJsonb({ hits: [{ snippet: cut }] })
    expect(written).not.toMatch(/\\ud83d/i)
    expect(JSON.parse(written).hits[0].snippet).toBe('growth �')
  })

  it('removes NUL characters', () => {
    expect(toJsonb({ text: `a${nul}b` })).toBe('{"text":"ab"}')
    expect(cleanText(`a${nul}b`)).toBe('ab')
  })
})
