import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The brand mark as a data URL, for generated images (social card, icons). Read at build time. */
export async function logoDataUrl() {
  const logo = await readFile(join(process.cwd(), 'public', 'logo.png'))
  return `data:image/png;base64,${logo.toString('base64')}`
}
