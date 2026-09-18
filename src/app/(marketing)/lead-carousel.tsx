import { SourceIcon, type Source } from '@/components/icons/social/source-icons'
import { clsx } from 'clsx/lite'

type Lead = {
  intent: 'explicit' | 'problem'
  source: Source
  where: string
  headline: string
  quote: string
  match: string
  author: string
  role?: string
  when: string
}

// Illustrative leads for the hero strip: one per source, mixing open requests and stated problems.
const LEADS: Lead[] = [
  {
    intent: 'explicit',
    source: 'indiehackers',
    where: 'Indie Hackers',
    headline: 'Looking for a studio to redesign our B2B pricing page before launch',
    quote: 'We need someone who can own the redesign and ship it within six weeks.',
    match: 'Pricing page design',
    author: '@maya_builds',
    role: 'Founder',
    when: '2 days ago',
  },
  {
    intent: 'problem',
    source: 'reddit',
    where: 'Reddit · r/SaaS',
    headline: 'Demo requests dropped after we moved to a new CMS',
    quote: 'Since the migration our demo form converts at half the rate it used to. No idea where it’s leaking.',
    match: 'Conversion audit',
    author: 'u/opsplanner',
    when: '4 days ago',
  },
  {
    intent: 'explicit',
    source: 'linkedin',
    where: 'LinkedIn',
    headline: 'Hiring an agency to run our paid social from January',
    quote: 'We’ve outgrown running Meta ads in-house. Looking for a small team with DTC experience.',
    match: 'Paid social',
    author: 'Sofia R.',
    role: 'Head of Growth',
    when: '1 day ago',
  },
  {
    intent: 'problem',
    source: 'hackernews',
    where: 'Hacker News',
    headline: 'Our marketing site takes six seconds to load on mobile',
    quote: 'Lighthouse gives us 31 and nobody on the team knows where to start fixing it.',
    match: 'Site speed',
    author: 'dkorb',
    when: '3 days ago',
  },
  {
    intent: 'explicit',
    source: 'x',
    where: 'X',
    headline: 'Need a designer or studio for a full rebrand in Q1',
    quote: 'New name, new logo, new site. Budget is there, DMs are open.',
    match: 'Brand identity',
    author: '@leoships',
    role: 'Founder',
    when: 'Today',
  },
  {
    intent: 'explicit',
    source: 'upwork',
    where: 'Upwork',
    headline: 'Shopify expert to migrate 2,000 products from WooCommerce',
    quote: 'Products, customers and order history need to come across without breaking our SEO.',
    match: 'Shopify migration',
    author: 'Verified client',
    role: 'E-commerce',
    when: '5 hours ago',
  },
  {
    intent: 'problem',
    source: 'producthunt',
    where: 'Product Hunt',
    headline: '400 signups since launch, almost nobody activates',
    quote: 'People sign up and never come back. Onboarding is clearly broken but we can’t see where.',
    match: 'Onboarding UX',
    author: '@nina_makes',
    role: 'Maker',
    when: '6 days ago',
  },
  {
    intent: 'problem',
    source: 'reddit',
    where: 'Reddit · r/marketing',
    headline: 'Organic traffic halved after the last Google update',
    quote: 'We publish two posts a week and rankings keep sliding. Not sure if it’s content or technical.',
    match: 'SEO audit',
    author: 'u/growthnerd_',
    when: '2 days ago',
  },
  {
    intent: 'explicit',
    source: 'linkedin',
    where: 'LinkedIn',
    headline: 'Recommendations for a HubSpot partner agency?',
    quote: 'We need lead scoring set up and three years of messy CRM data cleaned before Q2.',
    match: 'CRM setup',
    author: 'Tom B.',
    role: 'VP Sales',
    when: '3 days ago',
  },
]

function StarIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0">
      <path
        d="M7 1.4l1.5 3.3 3.6.4-2.7 2.4.8 3.5L7 9.2l-3.2 1.8.8-3.5L1.9 5.1l3.6-.4L7 1.4z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M4 10l6-6M5 4h5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <article className="flex h-106 w-69 shrink-0 flex-col rounded-[20px] border border-[#14100E]/7 bg-white p-5.5 text-[#14100E] shadow-[0_1px_2px_rgba(20,16,14,0.04),0_18px_34px_-18px_rgba(20,16,14,0.26)] transition duration-200 hover:border-[#14100E]/14 hover:shadow-[0_2px_4px_rgba(20,16,14,0.05),0_26px_46px_-20px_rgba(20,16,14,0.34)]">
      <div className="flex items-center gap-2">
        <span
          className={clsx(
            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap',
            lead.intent === 'explicit' ? 'bg-[#14100E] text-white' : 'border border-[#14100E]/22 text-[#2E2A26]',
          )}
        >
          {lead.intent === 'explicit' ? 'Explicit request' : 'Stated problem'}
        </span>
        <span className="flex-1" />
        <span title={lead.where} className="shrink-0">
          <SourceIcon source={lead.source} className="size-4.5" />
          <span className="sr-only">{lead.where}</span>
        </span>
      </div>
      <h3 className="mt-4.5 font-display text-[25px]/[1.18] tracking-[-0.005em]">{lead.headline}</h3>
      <p className="mt-3.5 border-l-2 border-[#14100E]/13 pl-3 text-[13px]/[1.5] text-[#44403B]">“{lead.quote}”</p>
      <span className="flex-1" />
      <div className="flex items-center gap-1.75 rounded-[10px] bg-linear-to-r from-orange-500/10 to-rose-500/10 px-2.5 py-2 text-orange-500">
        <StarIcon />
        <span className="truncate bg-linear-to-r from-orange-500 to-rose-500 bg-clip-text text-xs font-semibold text-transparent">
          Matches: {lead.match}
        </span>
      </div>
      <div className="mt-3.5 flex items-center gap-2.25 border-t border-[#14100E]/8 pt-3.5">
        <span className="inline-flex size-6.5 shrink-0 items-center justify-center rounded-full bg-[#E6E2DA] text-[11px] font-semibold text-[#44403B]">
          {lead.author.replace(/^(u\/|@)/, '').charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 text-xs/[1.35] text-[#57534E]">
          <span className="block truncate">{lead.author}</span>
          <span className="block truncate text-[#8A847C]">
            {lead.role ? `${lead.role} · ${lead.when}` : lead.when}
          </span>
        </span>
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-[#14100E]/13 text-[#44403B]">
          <ArrowIcon />
        </span>
      </div>
    </article>
  )
}

/** Full-width strip of example lead cards under the hero. Scrolls on its own; pauses on hover. */
export function LeadCarousel() {
  return (
    <section aria-label="Examples of leads we find" className="overflow-hidden">
      <div className="mask-x-from-90% mask-x-to-100% motion-reduce:overflow-x-auto">
        {/* Two copies of the list so the loop is seamless; each card carries its own right padding so -50% lands exactly. */}
        <div className="flex w-max animate-[lead-marquee_70s_linear_infinite] py-6 hover:[animation-play-state:paused] motion-reduce:animate-none">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex" aria-hidden={copy === 1 ? true : undefined}>
              {LEADS.map((lead, index) => (
                <div key={index} className="pr-5">
                  <LeadCard lead={lead} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
