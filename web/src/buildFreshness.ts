
export function entryScriptOf(html: string): string | null {
  const tags = html.match(/<script[^>]*\ssrc=["'][^"']+["'][^>]*>/gi) ?? []
  for (const tag of tags) {
    const src = tag.match(/\ssrc=["']([^"']+)["']/i)?.[1]
    if (src && src.includes('/assets/')) return src
  }
  return null
}

export function scriptKey(src: string, base: string): string {
  try {
    return new URL(src, base).pathname
  } catch {
    return src
  }
}

export function isNewerBuild(currentSrc: string, html: string, base: string): boolean {
  const nextSrc = entryScriptOf(html)
  if (nextSrc === null) return false
  return scriptKey(nextSrc, base) !== scriptKey(currentSrc, base)
}
