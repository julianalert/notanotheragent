import Script from 'next/script'
import { AttributionCapture } from './attribution-capture'

// Queues events fired before the Simple Analytics script loads; the script sends the queue on load.
const EVENT_QUEUE = `window.sa_event=window.sa_event||function(){var a=[].slice.call(arguments);window.sa_event.q?window.sa_event.q.push(a):window.sa_event.q=[a]};`

/**
 * Simple Analytics (privacy-first, no cookies). Only rendered on public marketing pages:
 * private links (/r/<token>, /unsubscribe/<code>) carry secrets in the path and must never be reported.
 * Also records the visit's first-touch attribution, sent along when the visitor creates a radar.
 */
export function Analytics() {
  return (
    <>
      <Script id="sa-event-queue" strategy="afterInteractive">
        {EVENT_QUEUE}
      </Script>
      <Script src="https://scripts.simpleanalyticscdn.com/latest.js" strategy="afterInteractive" />
      <AttributionCapture />
    </>
  )
}
