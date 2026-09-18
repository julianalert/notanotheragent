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
