import { clsx } from 'clsx/lite'
import type { ComponentProps } from 'react'

export function Eyebrow({ children, className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={clsx('w-fit bg-linear-to-r from-orange-500 to-rose-500 bg-clip-text text-sm/7 font-semibold text-transparent', className)} {...props}>
      {children}
    </div>
  )
}
