import { Testimonial, TestimonialThreeColumnGrid } from '@/components/sections/testimonials-three-column-grid'
import type { ReactNode } from 'react'

function CompanyLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="underline underline-offset-2">
      {children}
    </a>
  )
}

export const CLEMENT = {
  quote: (
    <p>
      Every day I start at least one conversation with a company that’s actively looking for what we build. These are
      serious buyers with real budgets, and some of them have become our biggest contracts.
    </p>
  ),
  // eslint-disable-next-line @next/next/no-img-element
  img: <img src="/clients/clement.jpg" alt="" width={160} height={160} />,
  name: 'Clément Bernard',
  byline: (
    <>
      Founder at <CompanyLink href="https://visionbds.com">VisionBDS</CompanyLink>, AI Automation Agency
    </>
  ),
}

export const CARINE = {
  quote: (
    <p>
      Not Another Agent finds us new creators every day. Most of them sign up because they genuinely need what we do.
      It’s easily my best find this year.
    </p>
  ),
  // eslint-disable-next-line @next/next/no-img-element
  img: <img src="/clients/carine.jpeg" alt="" width={160} height={160} />,
  name: 'Carine',
  byline: (
    <>
      Co-founder at <CompanyLink href="https://yuzuu.co">Yuzuu</CompanyLink>
    </>
  ),
}

export const JULIAN = {
  quote: (
    <p>
      I built an agent to find people who need my agent. It found them. Now my mornings go to replying to leads instead
      of writing posts nobody reads. Very meta, very effective.
    </p>
  ),
  // eslint-disable-next-line @next/next/no-img-element
  img: <img src="/clients/julian.jpg" alt="" width={160} height={160} />,
  name: 'Julian',
  byline: 'Founder at Not Another Agent',
}

export function CustomerTestimonials() {
  return (
    <TestimonialThreeColumnGrid id="testimonials">
      <Testimonial {...CLEMENT} />
      <Testimonial {...CARINE} />
      <Testimonial {...JULIAN} />
    </TestimonialThreeColumnGrid>
  )
}
