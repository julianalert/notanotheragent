import { PricingSingleTierTwoColumn } from '@/components/sections/pricing-single-tier-two-column'
import { TRIAL_DAYS } from '@/lib/trial'
import { WebsiteForm } from './website-form'

export function Pricing() {
  return (
    <PricingSingleTierTwoColumn
      id="pricing"
      headline={`Free for ${TRIAL_DAYS} days. No card.`}
      subheadline={
        <>
          <p>
            Enter your website and your agent starts right away: a full first search, then a new one every morning for {TRIAL_DAYS} days. Every lead, source
            and first message, nothing locked.
          </p>
          <p>After that it sleeps until you activate it from your private page. Your leads stay. Cancel any time.</p>
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
