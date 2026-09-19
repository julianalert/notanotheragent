import { AnnouncementBadge } from '@/components/elements/announcement-badge'
import { ButtonLink } from '@/components/elements/button'
import { Main } from '@/components/elements/main'
import { Wallpaper } from '@/components/elements/wallpaper'
import { CallToActionSimple } from '@/components/sections/call-to-action-simple'
import { Features, FeatureThreeColumnWithDemos } from '@/components/sections/features-three-column-with-demos'
import { HeroLeftAlignedWithDemo } from '@/components/sections/hero-left-aligned-with-demo'
import { Stat, StatsWithGraph } from '@/components/sections/stats-with-graph'
import { NavbarLink } from '@/components/sections/navbar-with-logo-actions-and-left-aligned-links'
import { RADAR_COOKIE } from '@/lib/http'
import { findRadarByToken } from '@/lib/radars'
import { cookies } from 'next/headers'
import { Analytics } from './analytics'
import { CustomerTestimonials } from './customers'
import { EvidenceDemo, FitDemo, MessageDemo } from './home-demos'
import { LeadCarousel } from './lead-carousel'
import { Pricing } from './pricing'
import { SiteNavbar } from './site-chrome'
import { SiteFaq } from './site-faq'
import { WebsiteForm } from './website-form'

export default async function Home({ searchParams }: { searchParams: Promise<{ website?: string }> }) {
  const [{ website }, cookieStore] = await Promise.all([searchParams, cookies()])
  const token = cookieStore.get(RADAR_COOKIE)?.value
  const existing = await findRadarByToken(token).catch(() => null)

  return (
    <>
      <SiteNavbar
        links={
          <>
            <NavbarLink href="#every-lead" className="whitespace-nowrap">
              What you get
            </NavbarLink>
            <NavbarLink href="#faq" className="whitespace-nowrap">
              Questions
            </NavbarLink>
            <NavbarLink href="/pricing" className="whitespace-nowrap">
              Pricing
            </NavbarLink>
          </>
        }
        actions={
          existing ? (
            <ButtonLink href={`/r/${token}`} color="accent">
              Open my radar
            </ButtonLink>
          ) : (
            <ButtonLink href="#start" color="accent" className="max-sm:hidden">
              Get my first leads
            </ButtonLink>
          )
        }
      />

      <Main>
        <HeroLeftAlignedWithDemo
          id="start"
          className="pb-12"
          eyebrow={
            existing ? (
              <AnnouncementBadge
                href={`/r/${token}`}
                text={<>Your radar for {existing.website_host} is saved in this browser</>}
                cta="Open results"
              />
            ) : undefined
          }
          headline="Wake up to companies that need exactly what your agency sells"
          subheadline={
            <p>
              Enter your site. We search public posts where people ask for exactly what you do, and email you the
              matches with a link to every source.
            </p>
          }
          cta={<WebsiteForm defaultValue={typeof website === 'string' ? website.slice(0, 200) : ''} />}
        />

        <LeadCarousel />

        <CustomerTestimonials />

        <Features
          id="every-lead"
          eyebrow="Inside every lead"
          headline="Everything you need to close new clients every day."
          subheadline={
            <p>
              No blurred names, no locked messages. Every claim links back to where we found it. All that’s left is to
              start the conversation and make them an offer they can’t refuse.
            </p>
          }
          features={
            <>
              <FeatureThreeColumnWithDemos
                demo={
                  <Wallpaper color="green" className="h-72">
                    <EvidenceDemo />
                  </Wallpaper>
                }
                headline="Evidence you can check"
                subheadline={
                  <p>
                    A short quote from the original post, who wrote it and when it was published, with a link to the
                    source.
                  </p>
                }
              />
              <FeatureThreeColumnWithDemos
                demo={
                  <Wallpaper color="purple" className="h-72">
                    <FitDemo />
                  </Wallpaper>
                }
                headline="Why it fits your offer"
                subheadline={
                  <p>
                    Which of your services answers the need, and whether it is an explicit request or a problem they
                    described.
                  </p>
                }
              />
              <FeatureThreeColumnWithDemos
                demo={
                  <Wallpaper color="brown" className="h-72">
                    <MessageDemo />
                  </Wallpaper>
                }
                headline="A first message, ready to send"
                subheadline={
                  <p>
                    Grounded in their post and what your website actually says. You copy it and reach out yourself; we
                    never contact anyone.
                  </p>
                }
              />
            </>
          }
        />

        <StatsWithGraph
          id="stats"
          eyebrow="Warm leads, not generic contacts"
          headline="Talk only to the people ready to sign."
          subheadline={
            <p>
              We find the people already asking for what you sell and show you why each one fits. You do you: pick who’s
              worth a message, make them an offer they can’t refuse, and reach them where they posted.
            </p>
          }
        >
          <Stat stat="$100k" text="Lead pipeline built in the first month." />
          <Stat stat="x10" text="New conversations started every month." />
        </StatsWithGraph>

        <Pricing />

        <SiteFaq />

        <CallToActionSimple
          eyebrow="First search free · No account · No card"
          headline="See who is asking for what you sell this week."
          subheadline={<p>Enter your website and your email. Your first leads usually arrive within minutes.</p>}
          cta={<WebsiteForm />}
        />
      </Main>
      <Analytics />
    </>
  )
}
