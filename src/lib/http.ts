import 'server-only'
import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { findRadarByToken } from './radars'

export const RADAR_COOKIE = 'lr_radar'
export const TOKEN_HEADER = 'x-radar-token'

export function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, init)
}

export function clientKey(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local'
  // Hash so raw IPs are never held in memory maps longer than needed.
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

const buckets = (globalThis as unknown as { __leadRadarBuckets?: Map<string, number[]> }).__leadRadarBuckets ??
  new Map<string, number[]>()
;(globalThis as unknown as { __leadRadarBuckets?: Map<string, number[]> }).__leadRadarBuckets = buckets

/** Simple sliding-window limiter. Per-instance; put a shared limiter in front for multi-instance deployments. */
export function rateLimit(key: string, limit: number, windowMs = 60 * 60 * 1000) {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter((time) => now - time < windowMs)
  if (hits.length >= limit) {
    buckets.set(key, hits)
    return false
  }
  hits.push(now)
  buckets.set(key, hits)
  return true
}

/** Resolve the radar from the private token header. Unknown and malformed tokens are indistinguishable. */
export async function radarFromRequest(request: Request) {
  return findRadarByToken(request.headers.get(TOKEN_HEADER))
}

export const notFound = () => json({ error: 'Not found' }, { status: 404 })

type Handler<C> = (request: Request, context: C) => Promise<Response>

/** Log server failures without request paths or tokens, and give the page a readable JSON error. */
export function withErrors<C>(handler: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await handler(request, context)
    } catch (error) {
      console.error(
        JSON.stringify({ at: new Date().toISOString(), event: 'api.error', method: request.method, error: (error as Error).message }),
      )
      return json({ error: 'Something went wrong on our side. Please try again in a moment.' }, { status: 500 })
    }
  }
}
