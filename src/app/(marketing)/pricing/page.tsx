import { TRIAL_DAYS } from '@/lib/trial'
import { ButtonLink } from '@/components/elements/button'
import { Main } from '@/components/elements/main'
import { CallToActionSimpleCentered } from '@/components/sections/call-to-action-simple-centered'
import { HeroSimpleCentered } from '@/components/sections/hero-simple-centered'
import { NavbarLink } from '@/components/sections/navbar-with-logo-actions-and-left-aligned-links'
import { TestimonialLargeQuote } from '@/components/sections/testimonial-with-large-quote'
import type { Metadata } from 'next'
import { SiteNavbar } from '../site-chrome'
import { Analytics } from '../analytics'
import { CLEMENT } from '../customers'
import { SiteFaq } from '../site-faq'
import { Pricing } from '../pricing'
import { WebsiteForm } from '../website-form'

export const metadata: Metadata = {
  title: 'Pricing — Not Another Agent',
  description: `Free for ${TRIAL_DAYS} days, no card. Keep your agent finding new leads every morning for $99 a month.`,
  alternates: { canonical: '/pricing' },
  openGraph: {
    type: 'website',
    siteName: 'Not Another Agent',
    url: '/pricing',
    title: 'Pricing — Not Another Agent',
    description: `Free for ${TRIAL_DAYS} days, no card. Keep your agent finding new leads every morning for $99 a month.`,
  },
}

export default function PricingPage() {
  return (
    <>
      <SiteNavbar
        links={
          <>
            <NavbarLink href="/#every-lead" className="whitespace-nowrap">
              What you get
            </NavbarLink>
            <NavbarLink href="/pricing" className="whitespace-nowrap">
              Pricing
            </NavbarLink>
          </>
        }
        actions={
          <ButtonLink href="#pricing" color="accent" className="max-sm:hidden">
            Get my first leads
          </ButtonLink>
        }
      />

      <Main>
        <HeroSimpleCentered
          id="hero"
          headline={`Free for ${TRIAL_DAYS} days. Then one flat price.`}
          subheadline={
            <p>
              Your agent works for {TRIAL_DAYS} days without a card: a first search, then a new one every morning. When you want it to
              keep going, it’s one flat monthly price.
            </p>
          }
        />

        <Pricing />

        <TestimonialLargeQuote
          id="testimonial"
          {...CLEMENT}
        />

        <SiteFaq />

        <CallToActionSimpleCentered
          id="call-to-action"
          headline="See who is asking for what you sell this week."
          subheadline={<p>The first {TRIAL_DAYS} days are free and need no account or card. Your first leads usually arrive within minutes.</p>}
          cta={<WebsiteForm />}
        />
      </Main>
      <Analytics />
    </>
  )
}
