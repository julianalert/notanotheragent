import { appUrl } from '@/lib/site'
import type { MetadataRoute } from 'next'

/** Marketing pages are public; private radars, the API and unsubscribe links are never crawled. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/r/', '/api/', '/unsubscribe/'] }],
    sitemap: `${appUrl()}/sitemap.xml`,
  }
}
