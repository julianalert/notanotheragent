import { ButtonLink } from '@/components/elements/button'
import { Container } from '@/components/elements/container'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'

export default function NotFound() {
  return (
    <section className="py-24">
      <Container className="flex flex-col items-center gap-6 text-center">
        <Subheading>We couldn&apos;t find this page</Subheading>
        <Text className="max-w-lg text-pretty">
          Check that you copied the full private link. Private links can&apos;t be recovered by entering the same
          website again.
        </Text>
        <ButtonLink href="/" size="lg">
          Start a new search
        </ButtonLink>
      </Container>
    </section>
  )
}
