'use client'

import { CheckmarkIcon } from '@/components/icons/checkmark-icon'
import { Squares2StackedIcon } from '@/components/icons/squares-2-stacked-icon'
import { useCopy } from './ui'

/** Navbar action: always one click away from saving the private link. */
export function CopyPrivateLink({ token }: { token: string }) {
  const { copied, copy } = useCopy()
  return (
    <button
      type="button"
      onClick={() => copy(`${window.location.origin}/r/${token}`)}
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-mist-950 px-3 py-1 text-sm/7 font-medium text-white hover:bg-mist-800 dark:bg-mist-300 dark:text-mist-950 dark:hover:bg-mist-200"
    >
      {copied ? <CheckmarkIcon className="shrink-0" /> : <Squares2StackedIcon className="shrink-0" />}
      <span aria-live="polite">
        {copied ? (
          'Link copied'
        ) : (
          <>
            Copy <span className="max-sm:hidden">private </span>link
          </>
        )}
      </span>
    </button>
  )
}
