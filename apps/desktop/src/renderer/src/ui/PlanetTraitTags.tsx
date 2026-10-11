import { useState } from 'react'
import type { PlanetCatalog, PlanetSurveyView } from '@whale/core'
import { pt } from './planetText'
import { InfoTable, infoCardContent } from './shipInfo'
import { hoverTipProps } from './Tooltip'
import { planetTraitDetails } from './planetTraitDetails'
import { X } from 'lucide-react'

export function PlanetTraitTags({ view, catalog }: { view?: PlanetSurveyView; catalog: PlanetCatalog }) {
  const [selected, setSelected] = useState<string | null>(null)
  const detail = selected && view ? planetTraitDetails(view, selected, catalog) : undefined
  const toggle = (id: string) => setSelected(current => current === id ? null : id)
  return <div className="app-planet-traits">
    {view?.traitIds.map(id => {
      const value = planetTraitDetails(view, id, catalog)
      return value ? <button type="button" className={`app-skilltree-key app-planet-trait is-${value.tone}`} key={id}
        data-planet-trait={id} aria-expanded={selected === id} onClick={() => toggle(id)} onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault(); toggle(id)
        }}
        {...hoverTipProps(infoCardContent(value.name, value.lines))}>{value.name}</button> : null
    })}
    {view && view.unknownTraits > 0 ? <span className="app-skilltree-key app-planet-trait is-unknown">{pt('unknownTraits')} {view.unknownTraits}</span> : null}
    {detail ? <section className="app-planet-trait-expanded" data-planet-trait-details={selected}>
      <header><strong>{detail.name}</strong><button className="app-btn app-planet-tool" type="button" title={pt('close')} aria-label={pt('close')} onClick={() => setSelected(null)}><X size={16} /></button></header>
      <InfoTable lines={detail.lines} />
    </section> : null}
  </div>
}
