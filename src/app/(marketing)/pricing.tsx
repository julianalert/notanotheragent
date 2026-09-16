import { Container } from '@/components/elements/container'
import { Eyebrow } from '@/components/elements/eyebrow'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import { ButtonLink } from '@/components/elements/button'

const FREE = ['Your website read and understood', 'A full search across the public web', 'Every lead, source and first message', 'No account, no card']
const AGENT = [
  'A new search every morning, 8:00 your time',
  'Your buyers’ communities watched through the day',
  'Instant email when a strong request appears',
  'Learns from every lead you contact or dismiss',
  'Your own guidance on who to find and who to skip',
  'Cancel any time from your private page',
]

export function Pricing() {
  return (
    <section id="pricing" className="py-16">
      <Container className="flex flex-col gap-10">
        <div className="flex max-w-2xl flex-col gap-2">
          <Eyebrow>Pricing</Eyebrow>
          <Subheading>The first search is free. The agent is $99 a month.</Subheading>
        </div>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-5 rounded-2xl border border-mist-200 bg-white p-7 dark:border-mist-800 dark:bg-mist-900">
            <div>
              <p className="text-sm font-semibold text-mist-600 dark:text-mist-300">First search</p>
              <p className="mt-1 font-display text-4xl text-mist-950 dark:text-white">Free</p>
            </div>
            <Text>
              <p>See what the agent finds for your website before paying anything.</p>
            </Text>
            <ul className="flex flex-col gap-2 text-sm text-mist-700 dark:text-mist-200">
              {FREE.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckmarkIcon className="mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
            <ButtonLink href="#start" color="accent" className="mt-auto self-start">
              Get my first leads
            </ButtonLink>
          </div>
          <div className="flex flex-col gap-5 rounded-2xl border border-mist-950 bg-mist-950 p-7 text-white dark:border-white dark:bg-white dark:text-mist-950">
            <div>
              <p className="text-sm font-semibold opacity-70">Your agent</p>
              <p className="mt-1 font-display text-4xl">
                $99 <span className="text-base opacity-70">per month</span>
              </p>
            </div>
            <p className="text-sm opacity-80">Activate it from your private page once your first leads are in.</p>
            <ul className="flex flex-col gap-2 text-sm">
              {AGENT.map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckmarkIcon className="mt-0.5 size-4 shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  )
}
