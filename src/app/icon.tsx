import { logoDataUrl } from '@/lib/og/logo'
import { ImageResponse } from 'next/og'

export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

/** Favicon: the brand mark on a transparent square. */
export default async function Icon() {
  const logo = await logoDataUrl()
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <img src={logo} width={62} height={54} />
      </div>
    ),
    size,
  )
}
