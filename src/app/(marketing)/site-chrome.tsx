import { XIcon } from '@/components/icons/social/x-icon'
import { FooterLink, FooterWithLinksAndSocialIcons, SocialLink } from '@/components/sections/footer-with-links-and-social-icons'
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
    <FooterWithLinksAndSocialIcons
      id="footer"
      links={
        <>
          <FooterLink href="/#every-lead">What every lead includes</FooterLink>
          <FooterLink href="/pricing">Pricing</FooterLink>
          <FooterLink href="/#faq">Questions</FooterLink>
          <FooterLink href="/#start">Start a search</FooterLink>
        </>
      }
      socialLinks={
        <SocialLink href="https://x.com/notanothermrktr" name="X">
          <XIcon />
        </SocialLink>
      }
      fineprint={`© ${new Date().getFullYear()} Not Another Agent. Built with 🧡 from 🇫🇷`}
    />
  )
}
