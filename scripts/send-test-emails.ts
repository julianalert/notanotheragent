/*
 * Send the three run emails (first results, morning digest, instant alert) to one address, using real leads from
 * the most recent evaluation report in .data/evals so the content looks like production. Billed through Resend.
 *
 *   npm run email:test -- you@example.com [free|active] [website-host]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { normaliseEmail } from '../src/lib/crypto'
import { sendEmail } from '../src/lib/email/resend'
import { renderRunEmail, type RunEmailInput } from '../src/lib/email/templates'
import type { LeadT } from '../src/lib/research/contract'

async function latestLeads(host: string): Promise<Array<{ id: string; data: LeadT }>> {
  const dir = path.join(process.cwd(), '.data', 'evals')
  // Most recent report for the host (file names end with the timestamp).
  const files = (await fs.readdir(dir)).filter((file) => file.startsWith(`${host}-`) && file.endsWith('.json')).sort()
  for (const file of files.reverse()) {
    const report = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as { initialQualified?: { published?: Array<{ lead: LeadT }> } }
    const published = report.initialQualified?.published ?? []
    if (published.length) return published.map((item, index) => ({ id: `test-${index + 1}`, data: item.lead }))
  }
  throw new Error('No evaluation report with published leads in .data/evals; run npm run research:eval first')
}

async function main() {
  const email = normaliseEmail(process.argv[2])
  if (!email.ok) throw new Error(`Usage: npm run email:test -- you@example.com [free|active] (${email.error})`)
  const plan = process.argv[3] === 'free' ? 'free' : 'active'
  const host = process.argv[4] ?? 'notanotheragent.com'
  const leads = await latestLeads(host)
  const base = process.env.APP_URL?.replace(/\/+$/, '') || 'https://www.notanotheragent.com'
  const common = {
    websiteHost: host,
    businessName: 'Not Another Agent',
    privateUrl: `${base}/r/test-preview-token`,
    unsubscribeUrl: `${base}/api/unsubscribe/test-preview-code`,
  }
  const variants: Array<Omit<RunEmailInput, keyof typeof common>> = [
    { kind: 'initial', outcome: 'qualified_results', leads: leads.slice(0, 5), plan: 'free' },
    { kind: 'daily', outcome: 'qualified_results', leads: leads.slice(0, 3), plan },
    { kind: 'instant', outcome: 'qualified_results', leads: leads.slice(0, 1), plan },
  ]
  for (const variant of variants) {
    const rendered = renderRunEmail({ ...common, ...variant })
    const result = await sendEmail({
      to: email.email,
      subject: `[test] ${rendered.subject}`,
      html: rendered.html,
      text: rendered.text,
      idempotencyKey: `test-${variant.kind}-${Date.now()}`,
      unsubscribeUrl: common.unsubscribeUrl,
    })
    console.log(variant.kind.padEnd(8), result.ok ? `sent id=${result.id ?? '-'}${result.preview ? ` (preview: ${result.preview})` : ''}` : `FAILED: ${result.error}`)
    // Resend rate-limits bursts; space the sends out.
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
