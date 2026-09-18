import { AnnouncementBadge } from '@/components/elements/announcement-badge'
import { ButtonLink } from '@/components/elements/button'
import { Main } from '@/components/elements/main'
import { Screenshot } from '@/components/elements/screenshot'
import { Wallpaper } from '@/components/elements/wallpaper'
import { CompassIcon } from '@/components/icons/compass-icon'
import { InboxIcon } from '@/components/icons/inbox-icon'
import { MagnifyingGlassIcon } from '@/components/icons/magnifying-glass-icon'
import { CallToActionSimple } from '@/components/sections/call-to-action-simple'
import { Feature, FeaturesThreeColumn } from '@/components/sections/features-three-column'
import { Features, FeatureThreeColumnWithDemos } from '@/components/sections/features-three-column-with-demos'
import { HeroLeftAlignedWithDemo } from '@/components/sections/hero-left-aligned-with-demo'
import { NavbarLink } from '@/components/sections/navbar-with-logo-actions-and-left-aligned-links'
import { RADAR_COOKIE } from '@/lib/http'
import { findRadarByToken } from '@/lib/radars'
import { cookies } from 'next/headers'
import { Analytics } from './analytics'
import { CustomerTestimonials } from './customers'
import { EvidenceDemo, ExampleRadar, FitDemo, MessageDemo } from './home-demos'
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
            <NavbarLink href="#how-it-works" className="whitespace-nowrap">
              How it works
            </NavbarLink>
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
              We scan the web for companies publicly signaling they need your services and send the best matches to
              your inbox every morning.
            </p>
          }
          cta={<WebsiteForm defaultValue={typeof website === 'string' ? website.slice(0, 200) : ''} />}
          demo={
            <Screenshot wallpaper="blue" placement="bottom" className="rounded-lg">
              <ExampleRadar />
            </Screenshot>
          }
        />

        <CustomerTestimonials />

        <FeaturesThreeColumn
          id="how-it-works"
          eyebrow="How it works"
          headline="From your website to your first leads, without a questionnaire."
          subheadline={
            <p>
              Your website already says what you sell. We read it, search the public web for people asking for exactly
              that, and email you what we find. Activate your agent and it keeps going every morning.
            </p>
          }
          features={
            <>
              <Feature
                icon={<CompassIcon />}
                headline="We read your website"
                subheadline={
                  <p>
                    Your services, customers and markets come straight from your pages. You can adjust the focus later,
                    but you never have to fill in a form.
                  </p>
                }
              />
              <Feature
                icon={<MagnifyingGlassIcon />}
                headline="We search for real buying signals"
                subheadline={
                  <p>
                    Public requests for a provider and first-person problems your service solves. We open every source
                    and check its date before it reaches you.
                  </p>
                }
              />
              <Feature
                icon={<InboxIcon />}
                headline="New leads in your inbox every morning"
                subheadline={
                  <p>
                    Your first search is free. Activate your agent and it searches again every morning, watches the
                    communities where your buyers post through the day, and emails you the new matches. Some days
                    there are none, and we don’t pad the list.
                  </p>
                }
              />
            </>
          }
        />

        <Features
          id="every-lead"
          eyebrow="What every lead includes"
          headline="Everything you need to reach out, on one card."
          subheadline={<p>No blurred names, no locked messages. Every claim links back to where we found it.</p>}
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
