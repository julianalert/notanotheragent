import { ButtonLink } from '@/components/elements/button'
import { Main } from '@/components/elements/main'
import { CallToActionSimpleCentered } from '@/components/sections/call-to-action-simple-centered'
import { HeroSimpleCentered } from '@/components/sections/hero-simple-centered'
import { NavbarLink } from '@/components/sections/navbar-with-logo-actions-and-left-aligned-links'
import { TestimonialLargeQuote } from '@/components/sections/testimonial-with-large-quote'
import type { Metadata } from 'next'
import { SiteNavbar } from '../site-chrome'
import { CLEMENT } from '../customers'
import { SiteFaq } from '../site-faq'
import { Pricing } from '../pricing'
import { WebsiteForm } from '../website-form'

export const metadata: Metadata = {
  title: 'Pricing — Not Another Agent',
  description: 'Your first search is free. Keep your agent finding new leads every morning for $99 a month.',
}

export default function PricingPage() {
  return (
    <>
      <SiteNavbar
        links={
          <>
            <NavbarLink href="/#how-it-works" className="whitespace-nowrap">
              How it works
            </NavbarLink>
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
          headline="Get your first leads for free."
          subheadline={
            <p>
              Your first search is free. When you want new leads every morning, keep your agent running for one flat
              monthly price.
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
          subheadline={<p>Your first search is free and needs no account. Your first leads usually arrive within minutes.</p>}
          cta={<WebsiteForm />}
        />
      </Main>
    </>
  )
}
