import type { ReactNode } from 'react'
import { FOE_ACCENT } from '../../ui/shipArt'
import { ROLE_ACCENT, UI_TONES } from '../../ui/tones'
import { tr } from '../../i18n/locale'
import { DRONE_SENTRY_FLY_MUL } from './attackTiming'

export interface DroneSlot {
  x: number
  y: number
}
export interface DroneModel {
  name: string
  tint: string
  resident?: boolean
  slots: DroneSlot[]
  bolt: { style: 'dot' | 'beam'; len: number; width: number; tail: boolean; flyMul?: number }
  art: ReactNode
}

const SPORE_DRONE_ART: ReactNode = (
  <g>
    {/* 孢子荚体（短粗、前后收口 —— 攻坚机的体量感） */}
    <path d="M10 0 C10 -4.4 4.6 -6.4 -2 -5.6 C-7 -5 -10.4 -2.6 -11 0 C-10.4 2.6 -7 5 -2 5.6 C4.6 6.4 10 4.4 10 0 Z" />
    {/* 甲壳节缝两道（"节肢"读法） */}
    <path d="M3 -5.9 v11.5 M-3.4 -5.1 v10" className="app-bts-drone-line" />
    {/* 尾端孢子囊 */}
    <path d="M-10.6 0 C-12.4 -1.8 -12.4 1.8 -10.6 0" className="app-bts-drone-line" />
    {/* 前缘短触须 */}
    <path d="M9 -1.6 L12.6 -3.4 M9 1.6 L12.6 3.4" className="app-bts-drone-line" />
    {/* 孢光点（族色磷光） */}
    <circle cx="6.2" cy="0" r="1.1" className="app-bts-drone-dot" />
  </g>
)

const JAWCLAW_DRONE_ART: ReactNode = <><path d="M-12 0 Q-6-8 2-5 L10-9 L7-2 L13 0 L7 2 L10 9 L2 5 Q-6 8-12 0 Z" /><path d="M-5-5 L-10-9 M-5 5 L-10 9 M0-4 L4 0 L0 4" /></>

const SLOTS_HIGH = (y: number): DroneSlot[] => [
  { x: -52, y },
  { x: -26, y: y - 7 },
  { x: 0, y: y - 3 },
  { x: 26, y: y - 8 },
  { x: 50, y: y - 1 },
  { x: 14, y: y - 15 },
]

const SWARM_BEE_ART: ReactNode = (
  <g>
    {/* 蜂窝六边舱体（族外形「蜂窝舱段」） */}
    <path d="M9.5 0 L4.7 -4.4 L-4.7 -4.4 L-9.5 0 L-4.7 4.4 L4.7 4.4 Z" />
    {/* 拼装补丁（后半截焊上去的歪板）+ 横向焊缝 */}
    <path d="M-4.7 -4.4 L-3.2 -7 L3 -6.4 L4.7 -4.4" className="app-bts-drone-line" />
    <path d="M-1 -4.4 v8.8" className="app-bts-drone-line" />
    {/* 焊点小灯 */}
    <circle cx="5.6" cy="0" r="1" className="app-bts-drone-dot" />
  </g>
)

export const DRONE_MODELS: Record<string, DroneModel> = {
  'drone-scout': {
    get name() { return tr("ui.droneArt.001") },
    tint: UI_TONES.droneSky,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 7, width: 1.6, tail: false },
    art: (
      <g>
        <path d="M12 0 L-2 -3 L-9 -6 L-4 -2 L-11 0 L-4 2 L-9 6 L-2 3 Z" />
        <circle cx="2" cy="0" r="1.1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'drone-assault': {
    get name() { return tr("ui.droneArt.002") },
    tint: UI_TONES.dronePeach,
    slots: SLOTS_HIGH(-46),
    bolt: { style: 'dot', len: 10, width: 2.2, tail: false },
    art: (
      <g>
        <path d="M11 0 L1 -2 L-2 -8 L-5 -2 L-11 0 L-5 2 L-2 8 L1 2 Z" />
        <path d="M-2 -2 h6" className="app-bts-drone-line" />
      </g>
    ),
  },
  'drone-heavy': {
    get name() { return tr("ui.droneArt.003") },
    tint: ROLE_ACCENT.armored,
    slots: SLOTS_HIGH(-64),
    bolt: { style: 'dot', len: 14, width: 3, tail: true },
    art: (
      <g>
        <path d="M11 1 H-3 L-8 5 H-12 L-7 1 V-1 L-12 -5 H-8 L-3 -1 H11 Z" />
        <path d="M-1 -3 v6" className="app-bts-drone-line" />
      </g>
    ),
  },
  'drone-sentry': {
    get name() { return tr("ui.droneArt.004") },
    tint: UI_TONES.droneCyan,
    resident: true,
    slots: [{ x: 30, y: -22 }],
    bolt: { style: 'beam', len: 9, width: 2, tail: false, flyMul: DRONE_SENTRY_FLY_MUL },
    art: (
      <g>
        <circle cx="0" cy="0" r="4.4" />
        <path d="M4.4 0 H12" />
        <circle cx="0" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'drone-repair-mil': {
    get name() { return tr('item.repairDrone.001') },
    tint: 'rgb(var(--wui-green))',
    slots: [{ x: -26, y: -20 }],
    bolt: { style: 'beam', len: 8, width: 1.5, tail: false },
    art: <g><path d="M-12-5 L4-7 L12 0 L4 7 L-12 5 L-7 0 Z M-3-4 V4 M-7 0 H1" /><circle cx="6" r="1.5" /></g>,
  },
  'foe-drone-e-alert': {
    get name() { return tr("ui.droneArt.005") },
    tint: FOE_ACCENT.E,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 9, width: 2, tail: false },
    art: (
      <g>
        {/* 斜装甲楔形机体（巨构残段语言） */}
        <path d="M11 0 L3 -3 L-6 -6 L-1 -2 L-11 0 L-1 2 L-6 6 L3 3 Z" />
        {/* 断口缺角：机体后段被削掉一块（"残骸还在跑"） */}
        <path d="M-1 -2 l3 2 l-3 2" className="app-bts-drone-line" />
        {/* 警戒灯 */}
        <circle cx="4.6" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'foe-drone-g-bee-kin': {
    get name() { return tr("ui.droneArt.006") },
    tint: FOE_ACCENT.G,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 8, width: 1.8, tail: false },
    art: SWARM_BEE_ART,
  },
  'foe-drone-g-bee-exp': {
    get name() { return tr("ui.droneArt.006") },
    tint: FOE_ACCENT.G,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 8, width: 1.8, tail: false },
    art: SWARM_BEE_ART,
  },
  'foe-drone-g-bee-pla': {
    get name() { return tr("ui.droneArt.006") },
    tint: FOE_ACCENT.G,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 8, width: 1.8, tail: false },
    art: SWARM_BEE_ART,
  },
  'foe-drone-c-spore': {
    get name() { return tr("ui.droneArt.007") },
    tint: FOE_ACCENT.C,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 9, width: 2, tail: false },
    art: SPORE_DRONE_ART,
  },
  'foe-drone-c-jawclaw': {
    get name() { return tr('item.alien.001') }, tint: FOE_ACCENT.C, slots: SLOTS_HIGH(-46),
    bolt: { style: 'dot', len: 10, width: 2.2, tail: false },
    art: JAWCLAW_DRONE_ART,
  },
  'drone-jawclaw': {
    get name() { return tr('item.jawclaw.001') }, tint: FOE_ACCENT.C, slots: SLOTS_HIGH(-46),
    bolt: { style: 'dot', len: 10, width: 2.2, tail: false },
    art: JAWCLAW_DRONE_ART,
  },
  'drone-wh-e-sentry': {
    get name() { return tr('ui.droneArt.009') },
    tint: FOE_ACCENT.E,
    resident: true,
    slots: [{ x: 30, y: -22 }],
    bolt: { style: 'beam', len: 12, width: 1.8, tail: false, flyMul: DRONE_SENTRY_FLY_MUL },
    art: (
      <g>
        <circle cx="0" cy="0" r="4.4" />
        {/* 长针：比制式哨戒（H12）更长，呼应"巨构自组装的长针哨戒机" */}
        <path d="M4.4 0 H13" />
        <circle cx="0" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'drone-wh-c-heavy': {
    get name() { return tr('ui.droneArt.010') },
    tint: FOE_ACCENT.C,
    slots: SLOTS_HIGH(-64),
    bolt: { style: 'dot', len: 14, width: 3, tail: true },
    art: (
      <g>
        <path d="M12 0 L2 -3 L-2 -8 L-6 -3 L-12 0 L-6 3 L-2 8 L2 3 Z" />
        <path d="M-2 -3 v6" className="app-bts-drone-line" />
        {/* 孢光点（族色磷光，与孢群机同款读法） */}
        <circle cx="5" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'drone-exile-bee': {
    get name() { return tr('ui.droneArt.011') },
    tint: FOE_ACCENT.G,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 7, width: 1.6, tail: false },
    art: (
      <g>
        <path d="M12 0 L-2 -3 L-9 -6 L-4 -2 L-11 0 L-4 2 L-9 6 L-2 3 Z" />
        {/* 拼装补丁缝（"流亡聚落拼出来的"族外形语言，与蜂群机同源） */}
        <path d="M-1 -3 v6" className="app-bts-drone-line" />
        <circle cx="3.4" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'drone-ink-heavy': {
    get name() { return tr('ui.droneArt.012') },
    tint: FOE_ACCENT.H,
    slots: SLOTS_HIGH(-64),
    bolt: { style: 'dot', len: 14, width: 3, tail: true },
    art: (
      <g>
        <path d="M12 0 L3 -3 L-1 -8 L-5 -3 L-11 0 L-5 3 L-1 8 L3 3 Z" />
        {/* 重弹舱横缝（墨潮的"重袭"读法） */}
        <path d="M1 -3 v6" className="app-bts-drone-line" />
        <circle cx="6.4" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
}

export const DRONE_MODEL_FALLBACK: DroneModel = {
  get name() { return tr("ui.droneArt.008") },
  tint: UI_TONES.droneGray,
  slots: SLOTS_HIGH(-26),
  bolt: { style: 'dot', len: 8, width: 1.8, tail: false },
  art: (
    <g>
      <rect x="-8" y="-4" width="16" height="8" rx="2" />
      <path d="M8 0 h4" className="app-bts-drone-line" />
    </g>
  ),
}

export function droneModelOrFallback(artId: string | null | undefined): DroneModel {
  const found = droneModelOf(artId)
  if (found) return found
  return { ...DRONE_MODEL_FALLBACK, name: artId ?? DRONE_MODEL_FALLBACK.name }
}

export function droneModelOf(artId: string | null | undefined): DroneModel | undefined {
  return artId ? DRONE_MODELS[artId] : undefined
}

export const DRONE_SHOW_MAX = 6

export const DRONE_STYLE: 'sortie' | 'formation' = 'sortie'
export const DRONE_SORTIE_OUT_MS = 560
export const DRONE_SORTIE_BACK_MS = 620
export const DRONE_DWELL_MS = 220
export { DRONE_FLY_MUL } from './attackTiming'

export interface DroneSortie {
  startAt: number
  offs: { x: number; y: number }[]
}

export function droneRandomOffsets(count: number, outward = 0): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: 42 + Math.round(Math.random() * 26) + outward,
      y: Math.round((Math.random() - 0.5) * 96),
    })
  }
  return out
}

export function droneStationFrom(
  foe: { x: number; y: number },
  dir: number,
  off: { x: number; y: number },
): { x: number; y: number } {
  return { x: foe.x - dir * off.x, y: foe.y + off.y }
}

export function dronePathPos(
  t: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  arcH: number,
  back: boolean,
): { x: number; y: number } {
  const e = back ? (t * t * t) : (1 - Math.pow(1 - t, 3))
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + (back ? arcH : -arcH) }
  const cx = 2 * mid.x - (from.x + to.x) / 2
  const cy = 2 * mid.y - (from.y + to.y) / 2
  const u = 1 - e
  return { x: u * u * from.x + 2 * u * e * cx + e * e * to.x, y: u * u * from.y + 2 * u * e * cy + e * e * to.y }
}

export function droneArcHeight(lane: number): number {
  return 34 + lane * 11
}

export function droneTakeoff(lane: number): { x: number; y: number } {
  return { x: (lane % 3) * 6 - 6, y: -10 + (lane % 2) * 5 }
}
