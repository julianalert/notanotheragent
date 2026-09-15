import { verifyUnsubscribeCode } from '@/lib/crypto'
import { unsubscribeRadar } from '@/lib/radars'
import { NextResponse } from 'next/server'

type Context = { params: Promise<{ code: string }> }

/**
 * POST unsubscribes: used by the page's button and by mail clients' one-click List-Unsubscribe-Post.
 * GET only shows the confirmation page, so link scanners that pre-fetch URLs can't unsubscribe anyone.
 */
export async function POST(request: Request, { params }: Context) {
  const { code } = await params
  const radarId = verifyUnsubscribeCode(code)
  if (!radarId) return NextResponse.json({ error: 'Invalid link' }, { status: 404 })
  await unsubscribeRadar(radarId)
  const accepts = request.headers.get('accept') ?? ''
  if (accepts.includes('text/html')) {
    return NextResponse.redirect(new URL(`/unsubscribe/${code}?done=1`, request.url), 303)
  }
  return NextResponse.json({ ok: true })
}

export async function GET(request: Request, { params }: Context) {
  const { code } = await params
  return NextResponse.redirect(new URL(`/unsubscribe/${code}`, request.url), 303)
}
