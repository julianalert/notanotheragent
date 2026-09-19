import { logoDataUrl } from '@/lib/og/logo'
import { ImageResponse } from 'next/og'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

/** Home-screen icon: iOS fills transparency with black, so the mark sits on white. */
export default async function AppleIcon() {
  const logo = await logoDataUrl()
  return new ImageResponse(
    (
      <div
        style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white' }}
      >
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <img src={logo} width={132} height={115} />
      </div>
    ),
    size,
  )
}
