import type { NextConfig } from 'next'

const privateHeaders = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
  { key: 'Cache-Control', value: 'private, no-store' },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  // Private radar tokens live in the URL path. Never write request paths to logs.
  logging: { incomingRequests: false },
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
      { source: '/r/:path*', headers: privateHeaders },
      { source: '/api/:path*', headers: privateHeaders },
    ]
  },
}

export default nextConfig
