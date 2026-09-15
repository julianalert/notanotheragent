import type { Metadata } from 'next'
import { Instrument_Serif, Inter } from 'next/font/google'
import { SiteFooter } from './site-chrome'
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

export const metadata: Metadata = {
  title: 'Lead Radar — find companies that need what your agency sells',
  description:
    'We research public requests and business problems to find opportunities that fit your offer. Free lead research for 14 days.',
  referrer: 'no-referrer',
}

// Each page renders its own navbar (links and actions differ); the footer is shared.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body className="flex min-h-dvh flex-col font-sans">
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  )
}
