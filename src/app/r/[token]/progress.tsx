'use client'

import { Button } from '@/components/elements/button'
import { Container } from '@/components/elements/container'
import { Eyebrow } from '@/components/elements/eyebrow'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import { AlertTriangleIcon } from '@/components/icons/alert-triangle-icon'
import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import type { RunView } from '@/lib/radars'
import { clsx } from 'clsx/lite'
import { PrivateLinkBox } from './status-panel'
import { Framed, Spinner } from './ui'

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
  websiteHost,
  slow,
  privateUrl,
  onRetry,
  retrying,
  retryError,
  expired,
}: {
  run: RunView | null
  websiteHost: string
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
    <section className="py-16">
      <Container className="flex flex-col gap-10 sm:gap-16">
        <div className="flex max-w-2xl flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Eyebrow>Private radar · {websiteHost}</Eyebrow>
            <Subheading>Finding opportunities for your business</Subheading>
          </div>
          <Text className="text-pretty">
            We’re reading your website and researching public signals that match what you sell. This can take a few
            minutes.
          </Text>
        </div>

        <Framed color={failed ? 'brown' : 'blue'} className="rounded-lg sm:p-12" surfaceClassName="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-8 p-6 sm:p-10">
            <div className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-sm/7 font-medium text-mist-950 dark:text-white">Research progress</span>
                <span className="font-display text-3xl/10 tracking-tight text-mist-950 tabular-nums dark:text-white">
                  {percent}%
                </span>
              </div>
              <div
                role="progressbar"
                aria-label="Research progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`${percent}% · ${failed ? 'Research stopped' : activeStep.label}`}
                className="h-1.5 overflow-hidden rounded-full bg-mist-950/10 dark:bg-white/10"
              >
                <div
                  className={clsx(
                    'h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700',
                    failed ? 'bg-mist-500' : 'bg-linear-to-r from-orange-500 to-rose-500',
                  )}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>

            <ol className="flex flex-col">
              {STEPS.map((step, index) => {
                const done = index < active
                const current = index === active
                const errored = failed && current
                return (
                  <li key={step.label} className="relative flex gap-4 pb-7 last:pb-0">
                    {index < STEPS.length - 1 && (
                      <span
                        aria-hidden="true"
                        className={clsx(
                          'absolute top-8 bottom-1 left-3.5 w-px',
                          done ? 'bg-mist-950 dark:bg-white' : 'bg-mist-950/10 dark:bg-white/10',
                        )}
                      />
                    )}
                    <span
                      className={clsx(
                        'relative flex size-7 shrink-0 items-center justify-center rounded-full',
                        done && 'bg-mist-950 text-white dark:bg-white dark:text-mist-950',
                        current &&
                          !errored &&
                          'bg-white text-mist-950 inset-ring-1 inset-ring-mist-950/15 dark:bg-mist-900 dark:text-white dark:inset-ring-white/20',
                        errored && 'bg-mist-950/10 text-mist-950 dark:bg-white/10 dark:text-white',
                        !done && !current && 'inset-ring-1 inset-ring-mist-950/10 dark:inset-ring-white/10',
                      )}
                    >
                      {done && <CheckmarkIcon className="stroke-2" />}
                      {current && !errored && <Spinner />}
                      {errored && <AlertTriangleIcon />}
                      <span className="sr-only">
                        {done ? 'Completed: ' : errored ? 'Failed: ' : current ? 'In progress: ' : 'Pending: '}
                      </span>
                    </span>
                    <div className="flex min-w-0 flex-col pt-0.5">
                      <span
                        className={clsx(
                          'text-sm/6 font-medium',
                          done || current ? 'text-mist-950 dark:text-white' : 'text-mist-500',
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
                            <Button onClick={onRetry} color="accent" disabled={retrying} className="disabled:opacity-70">
                              {retrying ? 'Retrying…' : 'Retry research'}
                            </Button>
                          )}
                          {retryError && (
                            <span role="alert" className="text-sm/6 text-mist-950 dark:text-white">
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

          <div className="border-t border-mist-950/5 p-6 sm:p-10 lg:border-t-0 lg:border-l dark:border-white/10">
            <PrivateLinkBox privateUrl={privateUrl} headline="Save this private link to return to your results" bare />
          </div>
        </Framed>

        <div aria-hidden="true" className="grid grid-cols-1 gap-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="rounded-lg bg-mist-950/2.5 p-2 dark:bg-white/5">
              <div className="h-40 rounded-sm bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
              <div className="flex flex-col gap-3 p-6">
                <div className="h-4 w-2/3 rounded-full bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
                <div className="h-3 w-full rounded-full bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
                <div className="h-3 w-5/6 rounded-full bg-mist-950/5 motion-safe:animate-pulse dark:bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  )
}
