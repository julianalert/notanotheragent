import { AnnouncementBadge } from '@/components/elements/announcement-badge'
import { Container } from '@/components/elements/container'
import { Heading } from '@/components/elements/heading'
import { Text } from '@/components/elements/text'
import { RADAR_COOKIE } from '@/lib/http'
import { findRadarByToken } from '@/lib/radars'
import { cookies } from 'next/headers'
import { WebsiteForm } from './website-form'

export default async function Home({ searchParams }: { searchParams: Promise<{ website?: string }> }) {
  const [{ website }, cookieStore] = await Promise.all([searchParams, cookies()])
  const token = cookieStore.get(RADAR_COOKIE)?.value
  const existing = await findRadarByToken(token).catch(() => null)

  return (
    <section className="py-16 sm:py-24">
      <Container className="flex flex-col items-center gap-6">
        {existing && (
          <AnnouncementBadge
            href={`/r/${token}`}
            text={<>Your radar for {existing.website_host} is saved in this browser</>}
            cta="Open results"
          />
        )}
        <Heading className="max-w-5xl text-center">
          Wake up to companies that need exactly what your agency sells.
        </Heading>
        <Text size="lg" className="max-w-xl text-center text-pretty">
          We research public requests and business problems to find opportunities that fit your offer. Enter your
          website to see your first leads.
        </Text>
        <WebsiteForm defaultValue={typeof website === 'string' ? website.slice(0, 200) : ''} />
      </Container>
    </section>
  )
}
