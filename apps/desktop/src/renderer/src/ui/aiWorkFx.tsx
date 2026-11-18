import { memo } from 'react'

export type AiWorkKind = 'mining' | 'salvage' | 'standby' | 'refine' | 'reclaim' | 'craft'

export function industryWorkKindOf(itemId: string | null, items: ReadonlyMap<string, { kind: string }>): AiWorkKind {
  return itemId !== null && items.get(itemId)?.kind === 'wreck' ? 'reclaim' : 'refine'
}

function hull(): JSX.Element {
  return <path d="M8 20 L17 15 L26 17.5 L17 22 Z" />
}

function MiningFx(): JSX.Element {
  return (
    <>
      {hull()}
      <path className="app-aifx-beam" d="M26.5 17.5 H44" />
      <path d="M45 14 l4 0 l2.5 4 l-2.5 4 l-4 0 l-2.5 -4 z" />
      <rect className="app-aifx-chip" x="36" y="12.6" width="2.6" height="2.6" />
      <rect className="app-aifx-chip is-late" x="40" y="19.4" width="2.6" height="2.6" />
      <rect className="app-aifx-chip is-late2" x="34" y="21.6" width="2.6" height="2.6" />
    </>
  )
}

function SalvageFx(): JSX.Element {
  return (
    <>
      {hull()}
      <path className="app-aifx-beam2" d="M26.5 17.5 L45 11 L45 24 Z" fill="currentColor" fillOpacity="0.1" />
      <path className="app-aifx-beam" d="M26.5 17.5 H45" />
      <path d="M44 9 l7 3 l-5 4 z" />
      <path d="M47 22 l6 -2 l1 4 z" />
      <rect className="app-aifx-chip" x="38" y="14" width="2.6" height="2.6" />
      <rect className="app-aifx-chip is-late" x="41" y="20" width="2.6" height="2.6" />
    </>
  )
}

function StandbyFx(): JSX.Element {
  return (
    <>
      <g className="app-aifx-hull">
        <path className="app-aifx-flame" d="M8 20 L3.5 17.2 L5 20 L3.5 22.8 Z" fill="currentColor" stroke="none" opacity="0.8" />
        <path d="M9 20 L18 15 L27 17.5 L18 22 Z" />
      </g>
      <path className="app-aifx-arc" d="M29 18 C31 13.5 34 10.5 38 9" />
      <path className="app-aifx-arc is-late" d="M31 21 C33 16 36.5 12.5 41 11" />
      <path className="app-aifx-foe" d="M48 13 l5 2.5 l-5 2.5 z" />
    </>
  )
}

function furnace(): JSX.Element {
  return (
    <>
      <path d="M20 30 L23 12 H33 L36 30 Z" />
      <path d="M17 30 H39" />
      <path d="M25 12 V8.5 H31 V12" />
    </>
  )
}

function RefineFx(): JSX.Element {
  return (
    <>
      {furnace()}
      <path className="app-aifx-fire" d="M28 28 c-3 -4 1 -6.5 0 -9 c3 2.5 4.5 5.5 0 9 z" />
      <path className="app-aifx-fire is-late" d="M24.5 28.5 c-2 -2.5 0.5 -4 0 -5.5 c2 1.6 2.8 3.4 0 5.5 z" />
      <circle className="app-aifx-spark" cx="28" cy="10" r="1.2" />
      <circle className="app-aifx-spark is-late" cx="33" cy="12" r="1" />
    </>
  )
}

function ReclaimFx(): JSX.Element {
  return (
    <>
      {furnace()}
      <rect className="app-aifx-fall" x="25.4" y="2.6" width="3.4" height="3.4" />
      <rect className="app-aifx-fall is-late" x="29.6" y="1.4" width="2.8" height="2.8" />
      <rect className="app-aifx-work" x="26.4" y="31.4" width="3.4" height="2.8" />
      <circle className="app-aifx-spark is-late" cx="28" cy="9" r="1.1" />
    </>
  )
}

function CraftFx(): JSX.Element {
  return (
    <>
      <path d="M17 30 H39" />
      <path d="M24 26 H32" />
      <rect className="app-aifx-work" x="25.6" y="22" width="5.2" height="4" />
      <path className="app-aifx-arm" d="M11 5 V12.5 L20 19.6" />
      <circle className="app-aifx-spark" cx="21.5" cy="21" r="1.1" />
      <circle className="app-aifx-spark is-late" cx="26" cy="20" r="0.9" />
    </>
  )
}

const SCENES: Record<AiWorkKind, () => JSX.Element> = {
  mining: MiningFx,
  salvage: SalvageFx,
  standby: StandbyFx,
  refine: RefineFx,
  reclaim: ReclaimFx,
  craft: CraftFx,
}

export const AiWorkFx = memo(function AiWorkFx({ kind }: { kind: AiWorkKind }) {
  const Scene = SCENES[kind]
  return (
    <span className={`app-inv-fx is-${kind}`} aria-hidden="true">
      <svg
        viewBox="0 0 56 36"
        width="100%"
        height="100%"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <Scene />
      </svg>
    </span>
  )
})
