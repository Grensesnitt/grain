import type { HttpMethod } from '../types'
import type { CompiledHandler } from './compile-route'

export interface MatcherEntry {
  path: string
  handlers: Partial<Record<HttpMethod, CompiledHandler>>
}

interface CompiledEntry extends MatcherEntry {
  segments: string[]
  paramCount: number
}

function toSegments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

// Left-to-right per-segment specificity: a static segment beats a param
// segment at the first differing position (mirrors Bun.serve's router);
// param-count is the tie-break.
function compareSpecificity(a: CompiledEntry, b: CompiledEntry): number {
  const len = Math.min(a.segments.length, b.segments.length)
  for (let i = 0; i < len; i++) {
    const aParam = a.segments[i]!.startsWith(':')
    const bParam = b.segments[i]!.startsWith(':')
    if (aParam !== bParam) return aParam ? 1 : -1
  }
  return a.paramCount - b.paramCount
}

export function buildMatcher(entries: MatcherEntry[]) {
  // Precedence mirrors Bun.serve: exact routes beat parameterized ones.
  const compiled: CompiledEntry[] = entries
    .map((entry) => {
      const segments = toSegments(entry.path)
      return {
        ...entry,
        segments,
        paramCount: segments.filter((s) => s.startsWith(':')).length,
      }
    })
    .sort(compareSpecificity)

  return (pathname: string) => {
    const parts = toSegments(pathname)
    outer: for (const entry of compiled) {
      if (entry.segments.length !== parts.length) continue
      const params: Record<string, string> = {}
      for (let i = 0; i < parts.length; i++) {
        const seg = entry.segments[i]!
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(parts[i]!)
        else if (seg !== parts[i]) continue outer
      }
      return { handlers: entry.handlers, params }
    }
    return null
  }
}
