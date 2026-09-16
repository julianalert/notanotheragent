import { clsx } from 'clsx/lite'
import type { ComponentProps } from 'react'

export function LinkIcon({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      role="image"
      className={clsx('inline-block', className)}
      {...props}
    >
      <path
        d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
