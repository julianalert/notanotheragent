import { Container } from '@/components/elements/container'
import NextLink from 'next/link'

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2 text-mist-950 dark:text-white">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="size-6" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" />
        <circle cx="12" cy="12" r="5.25" strokeOpacity={0.5} />
        <path d="M12 12 18.5 5.5" strokeLinecap="round" />
        <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      </svg>
      <span className="font-display text-2xl/8 tracking-tight">Lead Radar</span>
    </span>
  )
}

export function SiteHeader() {
  return (
    <header className="bg-mist-100 dark:bg-mist-950">
      <Container className="flex h-20 items-center">
        <NextLink href="/" className="inline-flex items-stretch" aria-label="Lead Radar home">
          <Logo />
        </NextLink>
      </Container>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="pt-16">
      <div className="bg-mist-950/2.5 py-10 dark:bg-white/5">
        <Container className="flex flex-col items-center justify-between gap-4 text-sm/7 text-mist-600 sm:flex-row dark:text-mist-500">
          <p>Lead Radar researches public sources. It never contacts anyone on your behalf.</p>
          <p>Free research for 14 days · No account</p>
        </Container>
      </div>
    </footer>
  )
}
