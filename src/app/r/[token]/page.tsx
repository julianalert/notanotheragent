import { findRadarByToken, getRadarView } from '@/lib/radars'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RadarClient } from './radar-client'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your private lead radar',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function RadarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const radar = await findRadarByToken(token)
  if (!radar) notFound()
  const view = await getRadarView(radar)
  return <RadarClient token={token} initialView={view} />
}
