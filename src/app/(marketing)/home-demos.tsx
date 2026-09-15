import { Wallpaper } from '@/components/elements/wallpaper'
import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import { Squares2StackedIcon } from '@/components/icons/squares-2-stacked-icon'
import { clsx } from 'clsx/lite'
import type { ComponentProps } from 'react'

/*
 * Illustrative product visuals for the marketing page, drawn in markup (not screenshots) so they follow the
 * theme. All names and posts are fictional examples and are labelled as such.
 */

function Pill({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={clsx('inline-flex items-center rounded-full px-2 text-[0.6875rem]/5 font-medium whitespace-nowrap', className)}
      {...props}
    />
  )
}

function ExampleLead({
  intent,
  platform,
  headline,
  who,
  quote,
  meta,
  active,
}: {
  intent: 'explicit' | 'problem'
  platform: string
  headline: string
  who: string
  quote: string
  meta: string
  active?: boolean
}) {
  return (
    <div
      className={clsx(
        'flex flex-col gap-3 rounded-lg p-4',
        active ? 'bg-white shadow-sm ring-1 ring-mist-950/5 dark:bg-white/10 dark:ring-white/10' : 'bg-mist-950/2.5 dark:bg-white/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill
          className={
            intent === 'explicit'
              ? 'bg-mist-950 text-white dark:bg-white dark:text-mist-950'
              : 'bg-mist-950/10 text-mist-950 dark:bg-white/10 dark:text-white'
          }
        >
          {intent === 'explicit' ? 'Explicit request' : 'Stated problem'}
        </Pill>
        <Pill className="text-mist-600 inset-ring-1 inset-ring-mist-950/10 dark:text-mist-400 dark:inset-ring-white/15">
          {platform}
        </Pill>
      </div>
      <p className="text-sm/5 font-medium text-mist-950 dark:text-white">{headline}</p>
      <p className="text-xs/5 text-mist-600 dark:text-mist-400">{who}</p>
      <p className="border-l-2 border-mist-950/15 pl-3 text-xs/5 text-mist-700 dark:border-white/20 dark:text-mist-300">
        “{quote}”
      </p>
      <p className="text-[0.6875rem]/5 text-mist-500">{meta}</p>
    </div>
  )
}

export function ExampleRadar() {
  return (
    <div className="bg-white/80 text-left backdrop-blur-sm dark:bg-mist-950/80">
      <div className="flex items-center justify-between gap-4 border-b border-mist-950/5 px-5 py-3 dark:border-white/10">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-mist-950/15 dark:bg-white/20" />
          <span className="size-2 rounded-full bg-mist-950/15 dark:bg-white/20" />
          <span className="size-2 rounded-full bg-mist-950/15 dark:bg-white/20" />
        </div>
        <span className="truncate font-mono text-[0.6875rem]/5 text-mist-500">Example · private radar for northwind.studio</span>
        <Pill className="bg-mist-950/5 text-mist-600 dark:bg-white/10 dark:text-mist-300">Example</Pill>
      </div>

      <div className="grid grid-cols-1 gap-6 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <p className="text-[0.6875rem]/5 font-semibold text-mist-600 dark:text-mist-400">Found today · 3 leads</p>
            <p className="font-display text-2xl/8 tracking-tight text-mist-950 sm:text-3xl/10 dark:text-white">
              4 opportunities for Northwind Studio
            </p>
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            <ExampleLead
              active
              intent="explicit"
              platform="Indie Hackers"
              headline="Looking for a studio to redesign our B2B pricing page before launch"
              who="@maya_builds · Founder"
              quote="We need someone who can own the redesign and ship it within six weeks."
              meta="Published 2 days ago · Found today"
            />
            <ExampleLead
              intent="problem"
              platform="Reddit"
              headline="Demo requests dropped after moving our marketing site to a new CMS"
              who="u/opsplanner"
              quote="Since the migration our demo form converts at half the rate it used to."
              meta="Published 4 days ago · Found today"
            />
          </div>
        </div>

        <div className="hidden flex-col gap-2 md:flex">
          <div className="overflow-hidden rounded-lg">
            <Wallpaper color="green" className="px-4 py-3">
              <p className="text-[0.6875rem]/5 font-medium text-white/80">Research active</p>
              <p className="font-display text-xl/7 text-white">13 days left</p>
            </Wallpaper>
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-mist-950/2.5 p-4 text-xs/5 dark:bg-white/5">
            <p className="text-mist-950 dark:text-white">Next search</p>
            <p className="text-mist-600 dark:text-mist-400">Tomorrow, 8:00</p>
            <p className="mt-2 flex items-center gap-2 text-mist-950 dark:text-white">
              <CheckmarkIcon className="shrink-0" /> Today’s search complete
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function DemoPanel({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className="flex h-72 items-center justify-center p-6">
      <div
        className={clsx(
          'w-full max-w-xs rounded-lg bg-white/85 p-4 shadow-lg ring-1 ring-black/5 backdrop-blur-sm dark:bg-mist-950/80 dark:ring-white/10',
          className,
        )}
        {...props}
      />
    </div>
  )
}

export function EvidenceDemo() {
  return (
    <DemoPanel>
      <p className="text-[0.6875rem]/5 font-semibold text-mist-600 dark:text-mist-400">Public signal</p>
      <p className="mt-2 border-l-2 border-mist-950/20 pl-3 text-sm/6 text-mist-950 dark:border-white/20 dark:text-white">
        “Looking for an agency to rebuild our onboarding emails. Happy to start this month.”
      </p>
      <p className="mt-3 flex flex-wrap gap-x-1.5 text-[0.6875rem]/5 text-mist-600 dark:text-mist-400">
        <span className="font-medium text-mist-950 underline decoration-mist-950/20 underline-offset-2 dark:text-white">
          community.example
        </span>
        <span>· Published Sep 12 · Example</span>
      </p>
    </DemoPanel>
  )
}

export function FitDemo() {
  return (
    <DemoPanel>
      <div className="flex flex-wrap gap-1.5">
        <Pill className="bg-mist-950 text-white dark:bg-white dark:text-mist-950">Explicit request</Pill>
        <Pill className="text-mist-700 inset-ring-1 inset-ring-mist-950/15 dark:text-mist-300 dark:inset-ring-white/15">
          Lifecycle email
        </Pill>
      </div>
      <p className="mt-3 text-[0.6875rem]/5 font-semibold text-mist-600 dark:text-mist-400">Why it fits</p>
      <p className="mt-1 text-sm/6 text-mist-950 dark:text-white">
        They ask for help rebuilding onboarding emails. Your site documents lifecycle email design for SaaS teams.
      </p>
    </DemoPanel>
  )
}

export function MessageDemo() {
  return (
    <DemoPanel>
      <p className="text-[0.6875rem]/5 font-semibold text-mist-600 dark:text-mist-400">First message</p>
      <p className="mt-2 rounded-md bg-mist-950/2.5 p-3 text-sm/6 text-mist-950 dark:bg-white/5 dark:text-white">
        Hi Maya, saw your post about rebuilding onboarding emails. Happy to share a quick audit of the first three
        emails. Would that be useful?
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-mist-950 px-2.5 py-0.5 text-xs/6 font-medium text-white dark:bg-mist-300 dark:text-mist-950">
        <Squares2StackedIcon className="shrink-0" /> Copy message
      </span>
    </DemoPanel>
  )
}
