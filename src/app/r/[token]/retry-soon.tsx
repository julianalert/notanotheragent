'use client'

import { Button } from '@/components/elements/button'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function RetrySoon({ delayMs = 4000 }: { delayMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setTimeout(() => router.refresh(), delayMs)
    return () => clearTimeout(timer)
  }, [router, delayMs])
  return (
    <div>
      <Button onClick={() => router.refresh()}>Try again now</Button>
    </div>
  )
}
