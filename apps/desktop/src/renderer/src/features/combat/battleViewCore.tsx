import type { ReactNode } from 'react'
import { denseBattleLayout } from './battleDenseGeometry'
import { BOLT_LOOK, FLY_MS } from './attackTiming'
import type { DamageType } from '@whale/core'
import { ceilFinalQuantity } from '@whale/core'
import { tr } from '../../i18n/locale'
import { DMG_LABEL } from '../ships/info/primitives'

import { DMG_COLOR, ROLE_ACCENT, UI_TONES } from '../../ui/tones'
const DMG_ORDER: DamageType[] = ['kinetic', 'explosive', 'plasma']

const LAY = { PAD: 36, GAP: 84, TOP: 54, MAIN: 170, ESC: 90, ROW_GAP: 24 }

const TIER_SIZE: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 110, 2: 140, 3: 170, 4: 205, 5: 240 }
const ESCORT_MUL = 0.53
const SIZE_BY_TIER_DEFAULT = true
let sizeTierFlag: boolean | null = null
function sizeByTierEnabled(): boolean {
  if (sizeTierFlag === null) sizeTierFlag = readFlag('whale-idle:ship-size-tier') ?? SIZE_BY_TIER_DEFAULT
  return sizeTierFlag
}

function readFlag(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

function sizeOfUnit(tier: number | null | undefined, escort: boolean): number {
  if (!sizeByTierEnabled()) return escort ? LAY.ESC : LAY.MAIN
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4 || tier === 5) {
    return Math.round(TIER_SIZE[tier] * (escort ? ESCORT_MUL : 1))
  }
  return escort ? LAY.ESC : LAY.MAIN
}
function noseOf(size: number): number {
  return Math.round((112 * size) / 240)
}
const NOSE_MAIN = noseOf(LAY.MAIN)
const NOSE_ESC = noseOf(LAY.ESC)

const BOLT_LIFE = FLY_MS + 500
const FLASH_LIFE = 340
const BOOM_LIFE = 1700
const DRONE_DOWN_LIFE = 1500
/**
 * **伤害飘字生命周期 ms**（2026-09-24 船长令「战斗伤害的数值动画」；与上列同族常量，故放这里）。
 *
 * 2026-10-09船长确认再次延长；存活与CSS动画进度共用引擎战斗时间。
 *
 * ⚠ **必须是模块级常量**：`BattleScreen` 的渲染体里**读它的地方在写入之前**（累加/清理段在函数前段、
 * 渲染元素在函数后段），若写成组件内的 `const`，那句 `.filter((p) => now - p.born < POPUP_LIFE)`
 * 会在**初始化之前**执行 ⇒ `ReferenceError: Cannot access 'POPUP_LIFE' before initialization`
 * （闭包引用晚声明的 `const` 逃过 TS 检查，运行时却真的抛）⇒ 战斗页整棵树崩掉 = **进入战斗黑屏**。
 */
const POPUP_LIFE = 2400

const STAR_LAYERS = [
  { cls: 'is-far', n: 90, mult: 0.35, rMin: 0.8, rMax: 1.5, oMin: 0.14, oMax: 0.4 },
  { cls: 'is-mid', n: 70, mult: 0.65, rMin: 1.0, rMax: 2.0, oMin: 0.2, oMax: 0.55 },
  { cls: 'is-near', n: 42, mult: 1, rMin: 1.4, rMax: 2.7, oMin: 0.28, oMax: 0.8 },
]
interface StarPt {
  x: number
  y: number
  r: number
  o: number
}
function genStars(cfg: (typeof STAR_LAYERS)[number], W: number, H: number, seed: number): StarPt[] {
  let s = seed || 1
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const pts: StarPt[] = []
  for (let i = 0; i < cfg.n; i++) {
    pts.push({
      x: rnd() * W,
      y: rnd() * H,
      r: cfg.rMin + rnd() * (cfg.rMax - cfg.rMin),
      o: cfg.oMin + rnd() * (cfg.oMax - cfg.oMin),
    })
  }
  return pts
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
function approachOf(m: number, openM: number, nearM: number): number {
  return clamp01((openM - m) / Math.max(1, openM - nearM))
}

interface FoeSlot {
  col: number
  row: number
  raise: number
}
interface FoeFormation {
  slots: FoeSlot[]
  colW: number[]
  shift: number
  drop: number
  rowH: number
  rows: number
  rowW: number
}
function foeFormationOf(sizes: readonly number[]): FoeFormation {
  const n = sizes.length
  const cols = Math.max(1, Math.ceil(n / 2))
  const colW: number[] = []
  for (let c = 0; c < cols; c++) {
    let w = 0
    for (let k = c * 2; k < Math.min(n, c * 2 + 2); k++) w = Math.max(w, sizes[k] ?? 0)
    colW.push(w)
  }
  const rowH = Math.max(1, ...sizes.map((s) => s * 0.46))
  const rows: 1 | 2 = n > 1 ? 2 : 1
  const shift = Math.round((colW[0]! + LAY.ROW_GAP) / 2)
  const drop = rows === 2 ? Math.round(rowH) + ROW2_BAR_DROP : 0
  const slots: FoeSlot[] = []
  for (let i = 0; i < n; i++) {
    const col = Math.floor(i / 2)
    const row: 0 | 1 = i % 2 === 1 && rows === 2 ? 1 : 0
    slots.push({ col, row, raise: row === 1 ? -drop : 0 })
  }
  const pitchSum = colW.reduce((s, w) => s + w + LAY.ROW_GAP, 0) - LAY.ROW_GAP
  return { slots, colW, shift, drop, rowH, rows, rowW: pitchSum + (rows === 2 ? shift : 0) }
}
function foeRowBoxesOf(fm: FoeFormation, row: 0 | 1, n: number): Array<{ col: number; width: number; unit: number }> {
  return fm.colW.map((w, col) => {
    const i = col * 2 + row
    return { col, width: w, unit: i < n && fm.slots[i]?.row === row ? i : -1 }
  })
}
function foeColLeft(f: FoeFormation, col: number): number {
  let x = 0
  for (let c = 0; c < col; c++) x += (f.colW[c] ?? 0) + LAY.ROW_GAP
  return x
}
const HP_BAR_H = 50
const HP_BAR_W_MAX = 185
const HP_BAR_W_MIN = 140
const MY_BAR_W_MIN = 96
const ROW2_BAR_DROP = HP_BAR_H + 6
interface BarGeom {
  width: number
  dx: number
  dy: number
}
function foeBarGeom(xs: readonly number[], bottoms: readonly number[], formationBottom: number): BarGeom[] {
  const n = xs.length
  const out: BarGeom[] = xs.map(() => ({ width: HP_BAR_W_MAX, dx: 0, dy: 0 }))
  const tiers = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = bottoms[i] ?? 0
    const list = tiers.get(r)
    if (list) list.push(i)
    else tiers.set(r, [i])
  }
  const stackDy = (i: number, k: number): number => {
    return formationBottom + 2 + HP_BAR_H + 2 + k * HP_BAR_H - (bottoms[i] ?? formationBottom)
  }
  let stacked = 0
  for (const idxs of tiers.values()) {
    if (idxs.length <= 1) continue
    let minPitch = Number.POSITIVE_INFINITY
    for (let k = 1; k < idxs.length; k++) minPitch = Math.min(minPitch, Math.abs(xs[idxs[k]!]! - xs[idxs[k - 1]!]!))
    if (minPitch >= HP_BAR_W_MAX + 6) continue
    if (minPitch >= HP_BAR_W_MIN + 6) {
      const w = Math.max(HP_BAR_W_MIN, Math.floor(minPitch - 6))
      for (const i of idxs) out[i] = { width: w, dx: 0, dy: 0 }
      continue
    }
    const first = idxs[0]!
    const last = idxs[idxs.length - 1]!
    const center = (xs[first]! + xs[last]!) / 2
    idxs.forEach((i, k) => {
      out[i] = { width: HP_BAR_W_MAX, dx: center - xs[i]!, dy: stackDy(i, stacked + k) }
    })
    stacked += idxs.length
  }
  return out
}

interface Dims {
  W: number
  H: number
  meW: number
  foeW: number
}
interface Anchor {
  x: number
  y: number
}
function layout(
  d: Dims,
  foeSizes: readonly number[],
  visM: number,
  openM: number,
  nearM: number,
  meSize: number = LAY.MAIN,
  mySizes: readonly number[] = [meSize],
): {
  meLeft: number
  dense?: boolean
  mySizes?: number[]
  foeLeft: number
  me: Anchor
  my: Anchor[]
  foe: Anchor[]
  sizes: number[]
  foeBottom: number
  formation: FoeFormation
  usable: number
  myBarW?: number
} {
  const nFoe = foeSizes.length
  if (Math.max(nFoe, mySizes.length) > 4) return denseBattleLayout(d, foeSizes, mySizes, visM, openM, nearM)
  const gapW = Math.max(0, nFoe - 1) * LAY.ROW_GAP
  let slots: number[] = [...foeSizes]
  if (sizeByTierEnabled()) {
    const maxRowW = Math.max(80, d.W - LAY.PAD * 2 - d.meW - LAY.GAP)
    const rawW = foeSizes.reduce((s, v) => s + v, 0)
    const fit = rawW + gapW > maxRowW ? Math.max(0.4, (maxRowW - gapW) / rawW) : 1
    slots = foeSizes.map((v) => Math.max(24, Math.round(v * fit)))
  }
  const fm = foeFormationOf(slots)
  const usable = Math.max(0, d.W - LAY.PAD * 2 - d.meW - d.foeW - LAY.GAP)
  const g = approachOf(visM, openM, nearM)
  const t = (usable * g) / 2
  let meLeft = LAY.PAD + t
  let foeLeft = d.W - LAY.PAD - d.foeW - t
  const minSpan = Math.min(LAY.GAP, Math.max(40, d.W - LAY.PAD * 2 - 60))
  if (foeLeft - (meLeft + d.meW) < minSpan) foeLeft = meLeft + d.meW + minSpan
  const meH = meSize * 0.46
  const foeH = slots.map((w) => w * 0.46)
  const rowW = fm.rowW
  const rowLeft = foeLeft + (d.foeW - rowW) / 2
  const me: Anchor = { x: meLeft + d.meW / 2, y: LAY.TOP + meH / 2 }
  const foe: Anchor[] = []
  for (let i = 0; i < nFoe; i++) {
    const w = slots[i]!
    const s = fm.slots[i]!
    const x = rowLeft + foeColLeft(fm, s.col) + (fm.colW[s.col] ?? w) / 2 + (s.row === 1 ? fm.shift : 0)
    const y = LAY.TOP + (s.row === 1 ? fm.rowH * 2 + ROW2_BAR_DROP : fm.rowH) - foeH[i]! / 2
    foe.push({ x, y })
  }
  const foeBottom = LAY.TOP + (fm.rows === 2 ? fm.rowH * 2 + ROW2_BAR_DROP : fm.rowH)
  let myPitch = 0
  const my: Anchor[] = mySizes.length <= 1 ? [me] : (() => {
    const mySlots = [...mySizes]
    const myFm = foeFormationOf(mySlots)
    const myH = mySlots.map((w) => w * 0.46)
    const myRowH = Math.max(1, ...myH)
    const colBase = foeColLeft(myFm, 0) + (myFm.colW[0] ?? mySlots[0]!) / 2
    const out: Anchor[] = []
    for (let i = 0; i < mySlots.length; i++) {
      if (i === 0) {
        out.push({ x: me.x, y: me.y })
        continue
      }
      const s = myFm.slots[i]!
      const colOffset = foeColLeft(myFm, s.col) + (myFm.colW[s.col] ?? mySlots[i]!) / 2 - colBase
      const x = me.x - colOffset - (s.row === 1 ? myFm.shift : 0)
      const y = LAY.TOP + (s.row === 1 ? myRowH * 2 + ROW2_BAR_DROP : myRowH) - myH[i]! / 2
      out.push({ x, y })
    }
    myPitch = Math.min(...myFm.colW) + LAY.ROW_GAP
    return out
  })()
  return {
    meLeft,
    foeLeft,
    me,
    my,
    foe,
    sizes: slots,
    foeBottom,
    formation: fm,
    usable,
    ...(mySizes.length > 1 && myPitch > 0 ? { myBarW: Math.max(MY_BAR_W_MIN, Math.min(HP_BAR_W_MAX, Math.round(myPitch) - 6)) } : {}),
  }
}

function foeHangarByTag(wings: readonly { tag: string; hangar?: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const w of wings) {
    const n = w.hangar ?? 0
    if (n > 0) out.set(w.tag, Math.max(out.get(w.tag) ?? 0, n))
  }
  return out
}

function foeHangarTotal(wings: readonly { tag: string; hangar?: number }[]): number {
  let sum = 0
  for (const n of foeHangarByTag(wings).values()) sum += n
  return sum
}

function fanSegs(r: number): string[] {
  const A = (38 * Math.PI) / 180
  const N = 9
  const pts: string[] = []
  for (let i = 0; i <= N; i++) {
    const a = -A + ((2 * A * i) / N) * 1
    pts.push(`${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`)
  }
  return pts
}
function fanPath(r0: number, r1: number): string {
  const inner = fanSegs(r0)
  return `M${fanSegs(r1).join(' L')} L${inner.reverse().join(' L')} Z`
}
function ringPath(r: number): string {
  return `M${fanSegs(r).join(' L')}`
}

const HP_LAYER_COLOR = { s: UI_TONES.hpShield, a: UI_TONES.hpArmor, h: UI_TONES.hpHull } as const
function HpTri({ hp, max, label }: { hp: { s: number; a: number; h: number }; max: { s: number; a: number; h: number }; label?: ReactNode }) {
  const layers = [
    { k: 's' as const, zh: tr("ui.FitPage.001") },
    { k: 'a' as const, zh: tr("ui.FitPage.003") },
    { k: 'h' as const, zh: tr("ui.ShipPage.023") },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--wui-sp-2)', width: '100%' }}>
      {label ? <span style={{ fontSize: 'var(--wui-fs-2xsd)', color: 'rgb(var(--wui-dim))', lineHeight: 1.2 }}>{label}</span> : null}
      {layers.map((ly) => {
        const cur = Math.max(0, ceilFinalQuantity(hp[ly.k]))
        const full = max?.[ly.k] ?? 0
        const ratio = full > 0 ? Math.min(100, Math.max(0, (cur / full) * 100)) : 0
        const color = HP_LAYER_COLOR[ly.k]
        return (
          <div key={ly.k} title={`${ly.zh} ${cur}/${ceilFinalQuantity(full)}`} style={{ display: 'flex', alignItems: 'center', gap: 'var(--wui-sp-4)', height: 10 }}>
            <span style={{ flex: '0 0 24px', fontSize: 'var(--wui-fs-2xsc)', color: 'rgb(var(--wui-dim))', textAlign: 'right' }}>{ly.zh}</span>
            <span style={{ flex: 1, height: '100%', background: 'rgb(var(--wui-well) / 0.45)', borderRadius: 'var(--wui-sp-2)', overflow: 'hidden' }}>
              <i style={{ display: 'block', height: '100%', width: `${ratio}%`, background: color, boxShadow: `0 0 4px ${color}`, transition: 'width .4s' }} />
            </span>
            <span style={{ minWidth: 34, flex: '0 0 auto', fontSize: 'var(--wui-fs-2xsb)', fontFamily: 'var(--wui-mono)', fontVariantNumeric: 'tabular-nums', color: 'rgb(var(--wui-dim))', textAlign: 'right', whiteSpace: 'nowrap' }}>{cur}</span>
          </div>
        )
      })}
    </div>
  )
}

interface BoltV {
  key: number
  color: string
  type: DamageType
  hit: boolean
  x1: number
  y1: number
  len: number
  angDeg: number
  born: number
  drone?: string
  delay?: number
}
interface FlashV {
  key: number
  at: number
  color: string
  x: number
  y: number
  small?: boolean
  delay?: number
}

export { BOLT_LOOK }

function resolveBoltAnchors(args: {
  side: 'me' | 'foe'
  tag: string
  to?: string
  rowFxTags: readonly string[]
  meAnchors: ReadonlyMap<string, Anchor>
  meFallback: Anchor
  foeAnchors: readonly Anchor[]
}): { src: Anchor; dst: Anchor } | null {
  const { side, tag, to, rowFxTags, meAnchors, meFallback, foeAnchors } = args
  const foe0 = foeAnchors[0]
  if (side === 'me') {
    const src = meAnchors.get(tag) ?? meFallback
    const idx = to !== undefined ? rowFxTags.indexOf(to) : -1
    const dst = (idx >= 0 ? foeAnchors[idx] : undefined) ?? foe0
    return src && dst ? { src, dst } : null
  }
  const sIdx = rowFxTags.indexOf(tag)
  const src = (sIdx >= 0 ? foeAnchors[sIdx] : undefined) ?? foe0
  const dst = (to !== undefined ? meAnchors.get(to) : undefined) ?? meFallback
  return src && dst ? { src, dst } : null
}

function boltGeom(
  side: 'me' | 'foe',
  src: Anchor,
  dst: Anchor,
  srcNose: number,
  dstNose: number,
  muzzle?: Anchor | null,
  artW?: number,
  from?: Anchor | null,
): { x1: number; y1: number; len: number; angDeg: number } {
  const dir = side === 'me' ? 1 : -1
  const s = artW && artW > 0 ? artW / 240 : 1
  const sx = from ? from.x : muzzle ? src.x + dir * (muzzle.x - 120) * s : src.x + dir * srcNose
  const sy = from ? from.y : muzzle ? src.y + (muzzle.y - 55) * s : src.y
  const tx = dst.x - dir * dstNose
  const ty = dst.y
  const dx = tx - sx
  const dy = ty - sy
  const len = Math.max(2, Math.hypot(dx, dy))
  return { x1: sx, y1: sy, len, angDeg: (Math.atan2(dy, dx) * 180) / Math.PI }
}

type Stage = 'live' | 'outro' | 'report'
interface OutroSnap {
  kind: 'me' | 'foe'
  atWall: number
  startedAtGameMs: number
  durMs: number
  meShots: number
  meHits: number
  meDmg: number
  foeShots: number
  foeHits: number
  droneLost?: Record<string, number>
  wormholeKind?: 'node' | 'boss' | 'extract' | 'ruins' | 'spawn'
}

function droneOwnerAnchor(args: {
  tag?: string
  meAnchors: ReadonlyMap<string, Anchor>
  meFallback: Anchor
}): Anchor {
  const { tag, meAnchors, meFallback } = args
  const t = tag ?? 'player'
  return meAnchors.get(t) ?? meFallback
}

function residentDroneFrom(args: {
  tag?: string
  meAnchors: ReadonlyMap<string, Anchor>
  meFallback: Anchor
  slot: { x: number; y: number }
}): Anchor {
  const own = droneOwnerAnchor(args)
  return { x: own.x + args.slot.x, y: own.y + args.slot.y }
}

export {
  DMG_COLOR,
  DMG_LABEL,
  DMG_ORDER,
  ROLE_ACCENT,
  LAY,
  TIER_SIZE,
  ESCORT_MUL,
  HP_BAR_W_MAX,
  HP_BAR_H,
  ROW2_BAR_DROP,
  MY_BAR_W_MIN,
  foeFormationOf,
  foeRowBoxesOf,
  foeColLeft,
  foeBarGeom,
  foeHangarByTag,
  foeHangarTotal,
  sizeByTierEnabled,
  sizeOfUnit,
  noseOf,
  NOSE_MAIN,
  NOSE_ESC,
  FLY_MS,
  BOLT_LIFE,
  FLASH_LIFE,
  BOOM_LIFE,
  DRONE_DOWN_LIFE,
  POPUP_LIFE,
  STAR_LAYERS,
  genStars,
  clamp01,
  approachOf,
  layout,
  fanSegs,
  fanPath,
  ringPath,
  HP_LAYER_COLOR,
  HpTri,
  boltGeom,
  resolveBoltAnchors,
  droneOwnerAnchor,
  residentDroneFrom,
}
export type { StarPt, Dims, Anchor, BoltV, FlashV, Stage, OutroSnap, BarGeom, FoeSlot, FoeFormation }
