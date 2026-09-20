import { TRIAL_DAYS } from '@/lib/trial'
import { Faq, FAQsTwoColumnAccordion } from '@/components/sections/faqs-two-column-accordion'

export function SiteFaq() {
  return (
    <FAQsTwoColumnAccordion
      id="faq"
      headline="Questions & answers"
      subheadline={<p>How the free trial and the paid agent work.</p>}
    >
      <Faq
        question="What does it cost?"
        answer={
          <p>
            The first {TRIAL_DAYS} days are free, with no card: a full first search, then a new one every morning, and you see every
            lead, source and message. After that the agent sleeps and your leads stay on your private page. Keeping it
            running is $99 a month, billed by card through Stripe, and you can cancel any time from your private page.
          </p>
        }
      />
      <Faq
        question="What does the agent do once it’s active?"
        answer={
          <p>
            It searches again every morning at 8:00 in your timezone, polls the communities where it found your
            buyers every few hours, emails you the moment a strong request appears, and learns from every lead you
            mark contacted or dismissed.
          </p>
        }
      />
      <Faq
        question="Do I need an account?"
        answer={
          <p>
            No. Just your website and the email address where we should send your leads. Your results also live on
            a private link that’s included in every email, so keep those emails private.
          </p>
        }
      />
      <Faq
        question="How often will you email me?"
        answer={
          <p>
            Once when your first results are ready. With the agent active: a morning digest on days with new
            matches, and an instant note when someone posts a strong explicit request. Every email has a one-click
            unsubscribe link.
          </p>
        }
      />
      <Faq
        question="Where do the leads come from?"
        answer={
          <p>
            Public discussions, original business posts and open briefs. We don’t use private communities, and we
            don’t pad the list: if nothing fits on a given day, you’ll see that.
          </p>
        }
      />
      <Faq
        question="Do you contact anyone on my behalf?"
        answer={<p>Never. We draft a first message; you decide whether and how to send it.</p>}
      />
      <Faq
        question="What happens if I cancel?"
        answer={<p>Searching stops at the end of the paid month. Your leads, sources and messages stay available on the same private link.</p>}
      />
    </FAQsTwoColumnAccordion>
  )
}
