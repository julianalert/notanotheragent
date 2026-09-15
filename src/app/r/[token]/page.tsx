import { Container } from '@/components/elements/container'
import { Eyebrow } from '@/components/elements/eyebrow'
import { Main } from '@/components/elements/main'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import { NavbarLink } from '@/components/sections/navbar-with-logo-actions-and-left-aligned-links'
import { findRadarByToken, getRadarView, type RadarRow } from '@/lib/radars'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SiteNavbar } from '../../site-chrome'
import { CopyPrivateLink } from './copy-private-link'
import { RadarClient } from './radar-client'
import { RetrySoon } from './retry-soon'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your private lead radar',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function RadarPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let radar: RadarRow | null
  let view
  let failed = false
  try {
    radar = await findRadarByToken(token)
    view = radar ? await getRadarView(radar) : null
  } catch (error) {
    // A temporary database problem must not look like a lost radar. Nothing is lost; retry shortly.
    console.error(JSON.stringify({ at: new Date().toISOString(), event: 'radar_page.error', error: (error as Error).message }))
    radar = null
    failed = true
  }
  if (!failed && (!radar || !view)) notFound()

  return (
    <>
      <SiteNavbar
        links={<NavbarLink href="/">New search</NavbarLink>}
        actions={<CopyPrivateLink token={token} />}
      />
      <Main>
        {failed || !view ? (
          <section className="py-16">
            <Container className="flex flex-col gap-6">
              <div className="flex max-w-2xl flex-col gap-2">
                <Eyebrow>Private radar</Eyebrow>
                <Subheading>We couldn’t load your results just now</Subheading>
              </div>
              <Text className="max-w-2xl text-pretty">
                Your research is saved and keeps running in the background. This page will try again in a few seconds.
              </Text>
              <RetrySoon />
            </Container>
          </section>
        ) : (
          <RadarClient token={token} initialView={view} />
        )}
      </Main>
    </>
  )
}
