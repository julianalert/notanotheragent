import { logoDataUrl } from '@/lib/og/logo'
import { ImageResponse } from 'next/og'

export const alt = 'Not Another Agent: wake up to companies that need exactly what your agency sells'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/** Social card for links shared on X, LinkedIn, Slack and in messages. */
export default async function OpenGraphImage() {
  const logo = await logoDataUrl()
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#f6f7f7',
          color: '#111416',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img src={logo} width={64} height={56} />
          <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>Not Another Agent</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div style={{ fontSize: 68, lineHeight: 1.08, fontWeight: 600, letterSpacing: -2, maxWidth: 1000 }}>
            Wake up to companies that need exactly what your agency sells
          </div>
          <div style={{ fontSize: 30, color: '#4a5359', maxWidth: 940, lineHeight: 1.35 }}>
            We find public posts where people ask for what you do, and send you the matches every morning.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              padding: '14px 30px',
              borderRadius: 999,
              backgroundImage: 'linear-gradient(90deg, #f97316, #f43f5e)',
              color: 'white',
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            Get my first leads
          </div>
          <span style={{ fontSize: 24, color: '#4a5359' }}>First search free · No account · No card</span>
        </div>
      </div>
    ),
    size,
  )
}
