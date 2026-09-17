/*
 * Text from the web reaches jsonb columns (pipeline state, candidates, leads, diagnostics). Postgres rejects two
 * things JavaScript strings may hold: a NUL character, and half of a surrogate pair, which any slice() of text with
 * emoji can leave behind. A rejected write loses the step that produced it, so every JSON written to the database
 * goes through toJsonb, and plain text parameters through cleanText.
 */

const NUL = new RegExp(String.fromCharCode(0), 'g')

export const cleanText = (value: string) => value.toWellFormed().replace(NUL, '')

export function toJsonb(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (typeof item === 'string' ? cleanText(item) : item))
}
