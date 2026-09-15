import OpenAI from 'openai'
import { SEARCH_MODEL } from '../contract'
import { auditFromOutput, type OutputItem } from '../provider'
import { communityOf } from './exa'
import { isoDayOf, type ConnectorResult, type SearchRequest } from './types'

/*
 * Fallback connector: one small hosted web_search call per topic. Used when Exa is not configured. Returns the
 * pages the search consulted; the read step fetches their text.
 */

const INSTRUCTIONS = `Run web searches to find recent public posts, questions or requests written by the people described in the
query: original first-person posts on Reddit, Indie Hackers, Hacker News, forums, Q&A sites, X, LinkedIn,
Facebook groups, marketplaces and job boards. Add community names to your searches (for example "reddit") to
surface posts. Never return articles, guides, blog posts, vendor or agency websites, directories or listing
pages. Run at most 3 searches. Reply with one line per relevant post: "URL | YYYY-MM-DD or unknown | one-line
summary". Nothing else.`

let client: OpenAI | null = null
const openai = () => (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 60_000 }))

export async function searchOpenAI(request: SearchRequest): Promise<ConnectorResult & { usage: { input_tokens: number; output_tokens: number } }> {
  const empty = { connector: 'openai' as const, hits: [], costUsd: 0, usage: { input_tokens: 0, output_tokens: 0 } }
  if (!process.env.OPENAI_API_KEY) return { ...empty, error: 'OPENAI_API_KEY is not set' }
  try {
    const domainNote = request.domains.length ? ` Restrict to these sites: ${request.domains.join(', ')}.` : ''
    const response = await openai().responses.create(
      {
        model: SEARCH_MODEL,
        reasoning: { effort: 'low' },
        tools: [{ type: 'web_search', external_web_access: true }],
        tool_choice: 'auto',
        ...({ max_tool_calls: 4 } as object),
        include: ['web_search_call.action.sources'],
        instructions: INSTRUCTIONS,
        input: `Query: ${request.query}. Published on or after ${request.windowStart}. Up to ${request.limit} results.${domainNote}`,
        max_output_tokens: 2000,
      },
      { timeout: 60_000 },
    )
    const audit = auditFromOutput((response.output ?? []) as unknown as OutputItem[])
    // Dates and summaries from the model's lines; URLs from the tool audit (never invented).
    const lines = new Map<string, { date: string | null; summary: string }>()
    for (const line of audit.text.split('\n')) {
      const match = line.match(/(https?:\/\/\S+)\s*\|\s*([^|]*)\|\s*(.*)$/)
      if (match) lines.set(match[1].replace(/[),.]+$/, ''), { date: isoDayOf(match[2].trim()), summary: match[3].trim() })
    }
    const seen = new Set<string>()
    const hits = audit.urls
      .filter((url) => !seen.has(url) && seen.add(url))
      .slice(0, request.limit * 2)
      .map((url) => {
        const line = lines.get(url)
        return {
          url,
          title: '',
          snippet: line?.summary ?? '',
          text: null,
          publishedDate: line?.date ?? null,
          connector: 'openai' as const,
          topic: request.query,
          community: communityOf(url),
        }
      })
    return {
      ...empty,
      hits,
      error: null,
      usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
    }
  } catch (error) {
    return { ...empty, error: (error as Error).message.slice(0, 120) }
  }
}
