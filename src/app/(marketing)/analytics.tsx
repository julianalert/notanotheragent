import Script from 'next/script'

/**
 * Simple Analytics (privacy-first, no cookies). Only rendered on public marketing pages:
 * private links (/r/<token>, /unsubscribe/<code>) carry secrets in the path and must never be reported.
 */
export function Analytics() {
  return <Script src="https://scripts.simpleanalyticscdn.com/latest.js" strategy="afterInteractive" />
}
