import { PricingSingleTierTwoColumn } from '@/components/sections/pricing-single-tier-two-column'
import { WebsiteForm } from './website-form'

export function Pricing() {
  return (
    <PricingSingleTierTwoColumn
      id="pricing"
      headline="Your first leads are free."
      subheadline={
        <>
          <p>Enter your website and we run a full search right away: every lead, source and first message.</p>
          <p>Activate your agent from your private page once your first leads are in. Cancel any time.</p>
        </>
      }
      price="$99"
      period="/mo"
      features={[
        'A new search every morning, 8:00 your time',
        'Your buyers’ communities watched through the day',
        'Instant email when a strong request appears',
        'Evidence, fit and a first message on every lead',
        'Learns from every lead you contact or dismiss',
        'Your own guidance on who to find and who to skip',
        'Cancel any time from your private page',
      ]}
      cta={<WebsiteForm />}
    />
  )
}
