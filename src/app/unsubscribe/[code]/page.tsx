import { Button } from '@/components/elements/button'
import { Container } from '@/components/elements/container'
import { Eyebrow } from '@/components/elements/eyebrow'
import { Main } from '@/components/elements/main'
import { Subheading } from '@/components/elements/subheading'
import { Text } from '@/components/elements/text'
import { verifyUnsubscribeCode } from '@/lib/crypto'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SiteNavbar } from '../../site-chrome'

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } }

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ done?: string }>
}) {
  const [{ code }, { done }] = await Promise.all([params, searchParams])
  if (!verifyUnsubscribeCode(code)) notFound()

  return (
    <>
      <SiteNavbar />
      <Main>
        <section className="py-16">
          <Container className="flex max-w-2xl flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Eyebrow>Email preferences</Eyebrow>
              <Subheading>{done ? 'You’re unsubscribed' : 'Stop lead emails?'}</Subheading>
            </div>
            <Text className="text-pretty">
              {done
                ? 'We won’t email you about this radar again. Your leads stay available on your private page.'
                : 'You’ll stop receiving daily lead emails for this radar. Research continues and your private page keeps working.'}
            </Text>
            {!done && (
              <form method="post" action={`/api/unsubscribe/${code}`}>
                <Button type="submit" size="lg">
                  Unsubscribe
                </Button>
              </form>
            )}
          </Container>
        </section>
      </Main>
    </>
  )
}
