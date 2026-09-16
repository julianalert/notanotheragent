import { FooterCategory, FooterLink, FooterWithLinkCategories } from '@/components/sections/footer-with-link-categories'
import { NavbarLogo, NavbarWithLogoActionsAndLeftAlignedLinks } from '@/components/sections/navbar-with-logo-actions-and-left-aligned-links'
import type { ReactNode } from 'react'

export function Logo() {
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-xs">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="Not Another Agent" className="h-5 w-auto" />
    </span>
  )
}

export function SiteNavbar({ links, actions }: { links?: ReactNode; actions?: ReactNode }) {
  return (
    <NavbarWithLogoActionsAndLeftAlignedLinks
      id="navbar"
      logo={
        <NavbarLogo href="/" aria-label="Not Another Agent home">
          <Logo />
        </NavbarLogo>
      }
      links={links ?? null}
      actions={actions ?? null}
    />
  )
}

export function SiteFooter() {
  return (
    <FooterWithLinkCategories
      id="footer"
      links={
        <>
          <FooterCategory title="Not Another Agent">
            <FooterLink href="/#how-it-works">How it works</FooterLink>
            <FooterLink href="/#every-lead">What every lead includes</FooterLink>
            <FooterLink href="/#faq">Questions</FooterLink>
          </FooterCategory>
          <FooterCategory title="Your research">
            <FooterLink href="/#start">Start a search</FooterLink>
            <li className="text-mist-700 dark:text-mist-400">First search free</li>
            <li className="text-mist-700 dark:text-mist-400">New leads by email</li>
          </FooterCategory>
          <FooterCategory title="Privacy">
            <li className="text-mist-700 dark:text-mist-400">Private link, no tracking</li>
            <li className="text-mist-700 dark:text-mist-400">We never contact anyone for you</li>
          </FooterCategory>
        </>
      }
      fineprint="Not Another Agent researches public sources. Every lead links to its original source so you can check it."
    />
  )
}
