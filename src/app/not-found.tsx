import { ButtonLink } from '@/components/elements/button'
import { Container } from '@/components/elements/container'
import { Main } from '@/components/elements/main'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import { SiteFooter, SiteNavbar } from './(marketing)/site-chrome'

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteNavbar />
      <Main className="flex-1">
        <section className="py-24">
          <Container className="flex flex-col items-center gap-6 text-center">
            <Subheading>We couldn&apos;t find this page</Subheading>
            <Text className="max-w-lg text-pretty">
              Check that you copied the full private link. It’s also in every lead email we send you.
            </Text>
            <ButtonLink href="/" size="lg" color="accent">
              Start a new search
            </ButtonLink>
          </Container>
        </section>
      </Main>
      <SiteFooter />
    </div>
  )
}
