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

export const metadata: Metadata = {
  title: 'Not Another Agent — find companies that need what your agency sells',
  description:
    'We scan the web for companies publicly signaling they need your services and send the best matches to your inbox every morning.',
  referrer: 'no-referrer',
}

// Marketing pages use the Oatmeal kit ((marketing)/layout.tsx); private radar pages use the desk ((desk)/layout.tsx).
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${instrumentSerif.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
