import { appUrl } from '@/lib/site'
import type { Metadata } from 'next'
import { Instrument_Serif, Inter } from 'next/font/google'
import './globals.css'

// Self-hosted at build time: private pages make no third-party font requests.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
})

const title = 'Not Another Agent — find companies that need what your agency sells'
const description =
  'We scan the web for companies publicly signaling they need your services and send the best matches to your inbox every morning.'

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title,
  description,
  referrer: 'no-referrer',
  openGraph: { type: 'website', siteName: 'Not Another Agent', title, description },
  twitter: { card: 'summary_large_image', site: '@notanothermrktr', title, description },
}

// Marketing pages use the Oatmeal kit ((marketing)/layout.tsx); private radar pages use the desk ((desk)/layout.tsx).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
