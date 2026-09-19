import { appUrl } from '@/lib/site'
import type { MetadataRoute } from 'next'

/** Public pages only. Add new marketing and SEO pages here. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl()
  return [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
  ]
}
