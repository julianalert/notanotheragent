import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { linkKind, tagsFrom, verifyResendSignature } from './resend-webhook'

const SECRET = `whsec_${Buffer.from('test-secret-key-0123456789').toString('base64')}`
const NOW = 1_760_000_000

function sign(id: string, timestamp: number, payload: string) {
  const key = Buffer.from(SECRET.slice('whsec_'.length), 'base64')
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${payload}`).digest('base64')}`
}

describe('verifyResendSignature', () => {
  const payload = '{"type":"email.opened"}'

  it('accepts a valid signature, also among rotated ones', () => {
    const signature = sign('msg_1', NOW, payload)
    expect(verifyResendSignature(SECRET, { id: 'msg_1', timestamp: String(NOW), signature }, payload, NOW)).toBe(true)
    expect(verifyResendSignature(SECRET, { id: 'msg_1', timestamp: String(NOW), signature: `v1,b2xk ${signature}` }, payload, NOW)).toBe(true)
  })

  it('rejects a tampered body, a wrong id, a stale timestamp and missing headers', () => {
    const signature = sign('msg_1', NOW, payload)
    expect(verifyResendSignature(SECRET, { id: 'msg_1', timestamp: String(NOW), signature }, '{"type":"email.clicked"}', NOW)).toBe(false)
    expect(verifyResendSignature(SECRET, { id: 'msg_2', timestamp: String(NOW), signature }, payload, NOW)).toBe(false)
    expect(verifyResendSignature(SECRET, { id: 'msg_1', timestamp: String(NOW), signature }, payload, NOW + 600)).toBe(false)
    expect(verifyResendSignature(SECRET, { id: null, timestamp: String(NOW), signature }, payload, NOW)).toBe(false)
  })
})

describe('tagsFrom', () => {
  it('reads both payload shapes', () => {
    expect(tagsFrom({ tags: { radar_id: 'a', kind: 'daily' } })).toEqual({ radar_id: 'a', kind: 'daily' })
    expect(tagsFrom({ tags: [{ name: 'kind', value: 'initial' }, { name: 1 }] })).toEqual({ kind: 'initial' })
    expect(tagsFrom(null)).toEqual({})
  })
})

describe('linkKind', () => {
  const app = 'https://notanotheragent.com'
  it('classifies without keeping the link', () => {
    expect(linkKind(`${app}/r/tok#activate`, app)).toBe('activate')
    expect(linkKind(`${app}/r/tok#lead-123`, app)).toBe('lead')
    expect(linkKind(`${app}/r/tok`, app)).toBe('desk')
    expect(linkKind(`${app}/api/unsubscribe/code`, app)).toBe('unsubscribe')
    expect(linkKind('https://reddit.com/r/agency/comments/1', app)).toBe('source')
    expect(linkKind('not a url', app)).toBe('other')
  })
})
