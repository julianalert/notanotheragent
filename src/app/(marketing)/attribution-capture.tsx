'use client'

import { captureAttribution } from '@/lib/client/attribution'
import { useEffect } from 'react'

/** Remembers where this visitor came from (UTM tags, referring site, landing page). Renders nothing. */
export function AttributionCapture() {
  useEffect(() => {
    captureAttribution()
  }, [])
  return null
}
