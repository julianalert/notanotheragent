import 'server-only'
import { decryptToken, unsubscribeCode } from '../crypto'
import { claimLinkEmail, type RadarRow } from '../radars'
import { appUrl } from '../site'
import { emailConfigured, sendEmail } from './resend'
import { renderRunEmail } from './templates'

/**
 * Email a radar's private link to the address it was created with. Used when someone starts a new free search for a
 * website or an email that already has a radar: the link only ever travels to the owner's inbox, never back to the
 * browser that asked. At most one per radar and hour, and never to an unsubscribed address.
 */
export async function resendPrivateLink(radar: RadarRow) {
  // Same rule as run emails: a local server on a shared database leaves sending to production.
  if (process.env.DATABASE_URL && !process.env.VERCEL && (!emailConfigured() || !process.env.APP_URL)) return false
  if (!radar.email || !radar.token_ciphertext || radar.email_unsubscribed_at) return false
  if (!(await claimLinkEmail(radar.id))) return false
  try {
    const unsubscribeUrl = `${appUrl()}/api/unsubscribe/${unsubscribeCode(radar.id)}`
    const email = renderRunEmail({
      kind: 'link',
      outcome: 'qualified_results',
      websiteHost: radar.website_host,
      businessName: radar.profile?.name ?? null,
      leads: [],
      privateUrl: `${appUrl()}/r/${decryptToken(radar.token_ciphertext)}`,
      unsubscribeUrl,
      plan: radar.plan,
    })
    const result = await sendEmail({
      to: radar.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      idempotencyKey: `link-${radar.id}-${new Date().toISOString().slice(0, 13)}`,
      unsubscribeUrl,
      tags: { radar_id: radar.id, kind: 'link', plan: radar.plan },
    })
    return result.ok
  } catch (error) {
    // Never log email addresses, tokens or private URLs.
    console.error(JSON.stringify({ event: 'email.link_failed', error: (error as Error).message.slice(0, 120) }))
    return false
  }
}
