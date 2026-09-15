'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export function RetrySoon({ delayMs = 4000 }: { delayMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const timer = setTimeout(() => router.refresh(), delayMs)
    return () => clearTimeout(timer)
  }, [router, delayMs])
  return (
    <button type="button" className="btn btn--brand" style={{ marginTop: 20 }} onClick={() => router.refresh()}>
      Try again now
    </button>
  )
}
