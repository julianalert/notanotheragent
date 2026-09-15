import { findRadarByToken, getRadarView, type RadarRow, type RadarView } from '@/lib/radars'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DeskApp } from './desk-app'
import { RetrySoon } from './retry-soon'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your private lead radar',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function RadarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let radar: RadarRow | null = null
  let view: RadarView | null = null
  try {
    radar = await findRadarByToken(token)
    view = radar ? await getRadarView(radar) : null
  } catch (error) {
    // A temporary database problem must not look like a lost radar. Nothing is lost; retry shortly.
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'radar_page.error', error: (error as Error).message }))
    return (
      <div className="desk">
        <main className="work">
          <Link href="/" className="site">
            Lead Radar
          </Link>
          <h1>We couldn’t load your results just now</h1>
          <div className="blank">
            <p>Your research is saved and keeps running in the background. This page will try again in a few seconds.</p>
            <RetrySoon />
          </div>
        </main>
      </div>
    )
  }

  if (!radar || !view) notFound()
  return <DeskApp token={token} initialView={view} />
}
