'use client'

import { Button } from '@/components/elements/button'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import { AlertTriangleIcon } from '@/components/icons/alert-triangle-icon'
import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import type { RunView } from '@/lib/radars'
import { clsx } from 'clsx/lite'
import { PrivateLinkBox } from './status-panel'
import { Spinner } from './ui'

const STEPS = [
  { label: 'Website received', detail: 'Your research job is saved. You can close this tab.' },
  {
    label: 'Researching your business and opportunities',
    detail: 'Reading your website to understand what you sell, then searching public requests and problems that match.',
  },
  {
    label: 'Checking and preparing your leads',
    detail: 'Checking sources and dates, removing duplicates and preparing outreach drafts.',
  },
  { label: 'Your leads are ready', detail: 'Opening your results.' },
]

/** Maps observable backend states to stage milestones. 100% is only reachable once results are saved. */
export function stageFor(run: RunView | null): { active: number; percent: number } {
  if (!run) return { active: 1, percent: 10 }
  switch (run.status) {
    case 'queued':
      return { active: 1, percent: 10 }
    case 'running':
      return { active: 1, percent: 25 }
    case 'processing':
      return { active: 2, percent: 85 }
    case 'completed':
      return { active: 4, percent: 100 }
    default:
      return { active: 1, percent: 25 }
  }
}

export function ResearchProgress({
  run,
  slow,
  privateUrl,
  onRetry,
  retrying,
  retryError,
  expired,
}: {
  run: RunView | null
  slow: boolean
  privateUrl: string
  onRetry: () => void
  retrying: boolean
  retryError: string | null
  expired: boolean
}) {
  const failed = run?.status === 'failed' || run?.status === 'cancelled'
  const { active, percent } = stageFor(run)
  const activeStep = STEPS[Math.min(active, STEPS.length - 1)]

  let helper = activeStep.detail
  if (run?.retrying) helper = 'The research provider had a temporary problem. We’re retrying automatically.'
  else if (slow && active < 3) helper = 'Still researching. You can return to this link when it’s ready.'

  return (
    <div className="flex flex-col gap-10">
      <div className="flex max-w-2xl flex-col gap-4">
        <Subheading>Finding opportunities for your business</Subheading>
        <Text className="text-pretty">
          We’re reading your website and researching public signals that match what you sell. This can take a few
          minutes.
        </Text>
      </div>

      <div className="grid grid-cols-1 gap-8 *:min-w-0 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm/7">
              <span className="font-medium text-mist-950 dark:text-white">Research progress</span>
              <span className="text-mist-600 tabular-nums dark:text-mist-400">{percent}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Research progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`${percent}% · ${failed ? 'Research stopped' : activeStep.label}`}
              className="h-2 overflow-hidden rounded-full bg-mist-950/10 dark:bg-white/10"
            >
              <div
                className={clsx(
                  'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700',
                  failed ? 'bg-red-600 dark:bg-red-400' : 'bg-mist-950 dark:bg-white',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          <ol className="flex flex-col">
            {STEPS.map((step, index) => {
              const done = index < active || (index === active && active === STEPS.length - 1 && !failed)
              const current = index === active && !done
              const errored = failed && index === active
              return (
                <li key={step.label} className="relative flex gap-4 pb-6 last:pb-0">
                  {index < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'absolute top-8 bottom-0 left-3.5 w-px',
                        done ? 'bg-mist-950 dark:bg-white' : 'bg-mist-950/15 dark:bg-white/15',
                      )}
                    />
                  )}
                  <span
                    className={clsx(
                      'relative flex size-7 shrink-0 items-center justify-center rounded-full',
                      done && 'bg-mist-950 text-white dark:bg-white dark:text-mist-950',
                      current && !errored && 'bg-white text-mist-950 inset-ring-1 inset-ring-mist-950/20 dark:bg-mist-900 dark:text-white dark:inset-ring-white/20',
                      errored && 'bg-red-50 text-red-700 inset-ring-1 inset-ring-red-600/30 dark:bg-red-950 dark:text-red-300',
                      !done && !current && 'bg-mist-950/5 inset-ring-1 inset-ring-mist-950/10 dark:bg-white/5 dark:inset-ring-white/10',
                    )}
                  >
                    {done && <CheckmarkIcon className="stroke-2" />}
                    {current && !errored && <Spinner />}
                    {errored && <AlertTriangleIcon />}
                    <span className="sr-only">{done ? 'Completed: ' : current ? (errored ? 'Failed: ' : 'In progress: ') : 'Pending: '}</span>
                  </span>
                  <div className="flex min-w-0 flex-col pt-0.5">
                    <span
                      className={clsx(
                        'text-sm/6 font-medium',
                        done || current ? 'text-mist-950 dark:text-white' : 'text-mist-500 dark:text-mist-500',
                      )}
                    >
                      {step.label}
                    </span>
                    {current && !errored && (
                      <span className="mt-1 text-sm/6 text-pretty text-mist-700 dark:text-mist-400">{helper}</span>
                    )}
                    {errored && (
                      <div className="mt-2 flex flex-col items-start gap-3">
                        <span className="text-sm/6 text-pretty text-mist-700 dark:text-mist-400">
                          {expired
                            ? 'This search couldn’t be completed, and the free research period has ended.'
                            : run?.errorCode === 'configuration'
                              ? 'Research is temporarily unavailable on our side. We’ve recorded the problem.'
                              : run?.canRetry
                                ? 'We couldn’t complete the research this time. Nothing was lost.'
                                : 'We couldn’t complete the research for this website.'}
                        </span>
                        {run?.canRetry && (
                          <Button onClick={onRetry} disabled={retrying} className="disabled:opacity-70">
                            {retrying ? 'Retrying…' : 'Retry research'}
                          </Button>
                        )}
                        {retryError && (
                          <span role="alert" className="text-sm/6 text-red-700 dark:text-red-400">
                            {retryError}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        </div>

        <PrivateLinkBox privateUrl={privateUrl} headline="Save this private link to return to your results" />
      </div>

      <div aria-hidden="true" className="flex flex-col gap-2">
        {[0, 1, 2].map((index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="flex flex-col gap-4 rounded-xl bg-mist-950/2.5 p-6 dark:bg-white/5">
      <div className="flex gap-2">
        <div className="h-6 w-28 rounded-full bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
        <div className="h-6 w-20 rounded-full bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
      </div>
      <div className="h-7 w-3/4 rounded-md bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
      <div className="h-4 w-1/3 rounded-md bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
      <div className="h-16 w-full rounded-md bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
    </div>
  )
}
