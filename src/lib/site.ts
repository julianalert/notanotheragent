/** Public origin of the app, for absolute links in emails, Stripe redirects, the sitemap and social cards. */
export function appUrl() {
  const explicit = process.env.APP_URL?.replace(/\/+$/, '')
  if (explicit) return explicit
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return `http://localhost:${process.env.PORT ?? 3000}`
}
