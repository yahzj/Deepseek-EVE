import classicUrl from './layout-css/styles-classic.css?url'
import modernUrl from './layout-css/styles-modern.css?url'

import { readLayoutPref, type LayoutKind } from './layoutPreference'
export { readLayoutPref, type LayoutKind } from './layoutPreference'
const LINK_ID = 'whale-layout-style'

export function installLayoutStyles(kind: LayoutKind = readLayoutPref()): void {
  const href = kind === 'modern' ? modernUrl : classicUrl
  const existing = document.getElementById(LINK_ID) as HTMLLinkElement | null
  if (existing) {
    if (existing.getAttribute('href') !== href) existing.setAttribute('href', href)
    return
  }
  const link = document.createElement('link')
  link.id = LINK_ID
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}
