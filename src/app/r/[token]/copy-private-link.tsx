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
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-linear-to-r from-orange-500 to-rose-500 px-3 py-1 text-sm/7 font-medium text-white shadow-lg hover:from-orange-600 hover:to-rose-600"
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
