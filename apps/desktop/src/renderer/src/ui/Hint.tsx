import type { ReactNode } from 'react'
import { Glyph } from './Glyphs'

export function HintIcon({ tip, size = 16 }: { tip: string; size?: number }): ReactNode {
  if (!tip) return null
  return (
    <span className="app-hint-ico" title={tip}>
      <Glyph name="ico-hint" size={size} />
    </span>
  )
}
