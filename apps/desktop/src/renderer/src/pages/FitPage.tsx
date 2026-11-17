import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type {
  DamageResists,
  DamageType,
  FittedModules,
  GameState,
  ModuleDef,
  ModuleSlot,
  RackSlot,
  UnitSpec,
} from '@whale/core'
import {
  ammoLoadTotals,
  ammoTiersOf,
  resolveAmmoTier,
  autoLoopDroneShortfall,
  countModule,
  countWare,
  cpuBudgetOf,
  cpuUseOf,
  ceilFinalQuantity,
  createPlayerSpec,
  plugInfoOf,
  plugEffectsOf,
  cleanShipDamage,
  installPlug,
  shipOperationBlockReason,
  plugSlotExpansionBlockedOf,
  shipScrapPreviewOf,
  scrapShip,
  droneCpuUsed,
  droneLoadM3,
  fittedCpuUsed,
  fleetDefOf,
  rackOf,
  isRackModule,
  sameKindCount,

  fitPresetBrief,
  fitPresetDetailOf,
  fitPresetsOf,
  FIT_PRESET_MAX,
  FIT_PRESET_NAME_MAX,
  shipDisplayName,
  shipSlotsWithPlugsOf,
  stackingOf,
  stackWeight,
  typeLayerMult,
  cargoCapacityM3Of,
  droneBayTotalM3,
  moduleAllowedOnShip,
  travelTimeFactor,
  warpBonusMult,
  warpSpeedAus,
} from '@whale/core'
import { Panel } from '@whale/ui'
import { ShipDamageMods } from '../ui/ShipDamageMods'
import { rarityTierOf } from '@whale/data'
import { combatBadges, COMBAT_BASE_KEYS, DmgChip, DMG_LABEL, FIT_MAIN_HIDDEN_KEYS, fitHiddenBaseKeys, fittedDroneBayLine, fittedHoldLine, fittedSpeedLine, InfoTable, itemHoverContent, moduleHoverContent, moduleShortEffect, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import { hoverTipProps } from '../ui/Tooltip'
import { Glyph, toneOf } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { ShipSprite } from '../ui/ShipSprite'
import { rackText, slotText } from '../ui/labelsText'
import type { PageProps } from './common'
import { tr, cmdText } from '../i18n/locale'
import { Crosshair } from '../ui/layoutIcons'
import { FittingRange } from '../panels/FittingRange'
import { FittingSummary } from '../features/ships/fitting/FittingSummary'
import { FitTargetSelect } from '../features/ships/fitting/FitTargetSelect'


const RACK_FAMILIES: Record<RackSlot, string> = {
  get high() { return tr("ui.FitPage.011") },
  get mid() { return tr("ui.FitPage.012") },
  get low() { return tr("ui.FitPage.013") },
}

const fmt = (n: number): string => n.toLocaleString('zh-CN')

function resChipsAll(res: DamageResists | undefined): ReactNode {
  return (['kinetic', 'explosive', 'plasma'] as const).map((t) => {
    const pct = Math.round((res?.[t] ?? 0) * 100)
    return pct > 0 ? (
      <DmgChip key={t} t={t} label={`${DMG_LABEL[t]} ${pct}%`} />
    ) : (
      <span key={t} className="app-res-zero">
        {DMG_LABEL[t]} 0%
      </span>
    )
  })
}

interface FitSeg {
  t: string
  c: 'up' | 'down' | 'info' | 'none'
}

const HP_KEY_LABEL: Record<'s' | 'a' | 'h', string> = {
  get s() { return tr("ui.FitPage.014") },
  get a() { return tr("ui.FitPage.015") },
  get h() { return tr("ui.ShipPage.023") },
}
const TYPE_SN: Record<string, string> = {
  get kinetic() { return tr("ui.FitPage.016") },
  get explosive() { return tr("ui.FitPage.017") },
  get plasma() { return tr("ui.FitPage.018") },
}

function minus(n: number): string {
  return n < 0 ? `−${-n}` : `${n}`
}

function rawDpsOf(spec: UnitSpec): number {
  let sum = 0
  for (const w of spec.weapons) {
    if (w.label === '基础舰炮') continue
    const per = w.kind === 'gun' ? Object.values(w.shotsByType ?? {})[0] ?? 0 : (w.shotDmg ?? 0)
    sum += per / Math.max(0.1, w.reloadMs / 1000)
  }
  return sum
}

function meanHitMul(spec: UnitSpec): number | null {
  const ws = spec.weapons.filter((w) => w.kind === 'gun' || w.kind === 'beam')
  if (ws.length === 0) return null
  let s = 0
  for (const w of ws) s += w.kind === 'beam' ? 1 : (w.hitRate ?? 0.5) * (w.eqHitMul ?? 1)
  return (spec.hitMul ?? 1) * (s / ws.length)
}

function meanHitRateOf(spec: UnitSpec): { rate: number; hitBonus: number; eqMul: number | null; unstable: number } | null {
  const ws = spec.weapons.filter((w) => w.kind === 'gun' || w.kind === 'beam')
  if (ws.length === 0) return null
  const hitBonus = spec.hitBonus ?? 0
  const unstable = spec.hitMul ?? 1
  let sum = 0
  let eqMul: number | null = null
  for (const w of ws) {
    if (w.kind === 'beam') {
      sum += 1
      continue
    }
    if (w.eqHitMul !== undefined) eqMul = w.eqHitMul
    sum += ((w.hitRate ?? 0.5) + hitBonus) * (w.eqHitMul ?? 1) * unstable
  }
  return { rate: sum / ws.length, hitBonus, eqMul, unstable }
}

function hitDetailText(read: { hitBonus: number; eqMul: number | null; unstable: number }): string {
  const parts: string[] = []
  if (read.hitBonus > 0) parts.push(tr("ui.FitPage.111", { p1: Math.round(read.hitBonus * 100) }))
  if (read.eqMul !== null && Math.abs(read.eqMul - 1) > 1e-6) parts.push(tr("ui.FitPage.112", { p1: read.eqMul.toFixed(2) }))
  if (Math.abs(read.unstable - 1) > 1e-6) parts.push(tr("ui.FitPage.113", { p1: read.unstable.toFixed(2) }))
  return parts.join(' · ')
}

function diffSegs(
  cur: UnitSpec,
  next: UnitSpec,
  cpuCur: number,
  cpuNext: number,
  cpuTotal: number,
  weapon?: { curMult: number | null; nextMult: number | null; curType: DamageType | null; nextType: DamageType | null },
  cpuTotalNext?: number,
): FitSeg[] {
  const segs: FitSeg[] = []
  const add = (t: string, c: FitSeg['c']): void => {
    segs.push({ t, c })
  }
  const dir = (d: number): 'up' | 'down' => (d > 0 ? 'up' : 'down')
  const remCur = cpuTotal - cpuCur
  const remNext = (cpuTotalNext ?? cpuTotal) - cpuNext
  if (remNext < 0) add(tr("ui.FitPage.114", { p1: minus(remCur), p2: minus(remNext), p3: -remNext }), 'down')
  else if (remNext !== remCur) {
    add(remNext === 0 ? tr("ui.FitPage.115", { p1: minus(remCur) }) : tr("ui.FitPage.116", { p1: minus(remCur), remNext: remNext }), 'info')
  }
  const hpPairs: Array<{ lab: string; c: number; n: number }> = []
  for (const k of ['s', 'a', 'h'] as const) {
    const c = cur.hp[k]
    const n = next.hp[k]
    if (n !== c) hpPairs.push({ lab: HP_KEY_LABEL[k], c: ceilFinalQuantity(c), n: ceilFinalQuantity(n) })
  }
  hpPairs.sort((x, y) => Math.abs(y.n - y.c) - Math.abs(x.n - x.c))
  for (const p of hpPairs.slice(0, 2)) add(`${p.lab} ${fmt(p.c)}→${fmt(p.n)}`, dir(p.n - p.c))
  const resDiffs: Array<{ t: string; c: number; n: number }> = []
  for (const layer of ['shield', 'armor'] as const) {
    const cb = cur.resists[layer] ?? {}
    const nb = next.resists[layer] ?? {}
    for (const ty of ['kinetic', 'explosive', 'plasma'] as const) {
      const cpp = Math.round((cb[ty] ?? 0) * 100)
      const npp = Math.round((nb[ty] ?? 0) * 100)
      if (npp !== cpp) resDiffs.push({ t: tr("ui.FitPage.117", { p1: layer === 'shield' ? tr("ui.FitPage.014") : tr("ui.FitPage.015"), p2: TYPE_SN[ty] }), c: cpp, n: npp })
    }
  }
  resDiffs.sort((a, b) => Math.abs(b.n - b.c) - Math.abs(a.n - a.c))
  for (const d of resDiffs.slice(0, 2)) add(`${d.t} ${d.c}→${d.n}%`, dir(d.n - d.c))
  const epp = Math.round((next.evasion - cur.evasion) * 100)
  if (epp !== 0) add(tr("ui.FitPage.118", { p1: Math.round(cur.evasion * 100), p2: Math.round(next.evasion * 100) }), dir(epp))
  const spd = Math.round(next.speedMps - cur.speedMps)
  if (spd !== 0) add(tr("ui.FitPage.119", { p1: Math.round(cur.speedMps), p2: Math.round(next.speedMps) }), dir(spd))
  const boostCur = cur.thrusterBoost ?? 0
  const boostNext = next.thrusterBoost ?? 0
  if (boostCur !== boostNext) {
    const ignCur = Math.round(cur.speedMps * (1 + boostCur))
    const ignNext = Math.round(next.speedMps * (1 + boostNext))
    add(tr("ui.FitPage.120", { ignCur: ignCur, ignNext: ignNext }), dir(ignNext - ignCur))
  }
  const cd = rawDpsOf(cur)
  const nd = rawDpsOf(next)
  if (cd <= 0 && nd > 0) add(tr("ui.FitPage.121"), 'up')
  else if (nd <= 0 && cd > 0) add(tr("ui.FitPage.122"), 'down')
  else if (cd > 0 && nd > 0) {
    const pct = (nd / cd - 1) * 100
    if (Math.abs(pct) >= 0.5) {
      const absPct = Math.abs(pct)
      const show = absPct >= 10 ? String(Math.round(absPct)) : absPct.toFixed(1)
      add(tr("ui.FitPage.123", { p1: pct > 0 ? '+' : '−', show: show }), pct > 0 ? 'up' : 'down')
    }
  }
  if (weapon && weapon.curMult !== null && weapon.nextMult !== null && weapon.curMult !== weapon.nextMult) {
    add(tr("ui.FitPage.124", { p1: mulText(weapon.curMult), p2: mulText(weapon.nextMult) }), dir(weapon.nextMult - weapon.curMult))
  }
  if (weapon && weapon.curType !== null && weapon.nextType !== null && weapon.curType !== weapon.nextType) {
    add(tr("ui.FitPage.125", { p1: DMG_LABEL[weapon.curType], p2: DMG_LABEL[weapon.nextType] }), 'info')
  }
  const ch = meanHitMul(cur)
  const nh = meanHitMul(next)
  if (ch !== null && nh !== null && ch > 0) {
    const hp = (nh / ch - 1) * 100
    if (Math.abs(hp) >= 2) {
      const absHp = Math.abs(hp)
      const show = absHp >= 10 ? String(Math.round(absHp)) : absHp.toFixed(1)
      add(tr("ui.FitPage.126", { p1: hp > 0 ? '+' : '−', show: show }), hp > 0 ? 'up' : 'down')
    }
  }
  return segs
}

const WEAPON_SLOTS = new Set<ModuleSlot>(['turret', 'missile', 'laser'])

function weaponDamageTypeOf(m: ModuleDef): DamageType {
  if (m.slot === 'turret') return m.damageType ?? 'kinetic'
  if (m.slot === 'missile') return 'explosive'
  return 'plasma'
}

function layerShortOf(t: DamageType): string {
  const name = { shield: tr("ui.FitPage.014"), armor: tr("ui.FitPage.015"), hull: tr("ui.ShipPage.023") } as const
  const parts: string[] = []
  for (const l of ['shield', 'armor', 'hull'] as const) {
    const v = typeLayerMult(t, l)
    if (v !== 1) parts.push(`${name[l]}×${v}`)
  }
  return parts.join('·')
}

function mulText(v: number): string {
  return `×${Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)}`
}

function ammoChipOf(m: ModuleDef): ReactNode | null {
  if (m.slot === 'turret') {
    const t = m.damageType ?? 'kinetic'
    return <DmgChip t={t} label={tr("ui.FitPage.127", { p1: DMG_LABEL[t] })} />
  }
  if (m.slot === 'missile') return <DmgChip t="explosive" label={tr("ui.FitPage.008")} />
  if (m.slot === 'laser') return <DmgChip t="plasma" label={tr("ui.FitPage.009")} />
  return null
}

function rangeShort(m: ModuleDef): string {
  const max = m.maxRangeM
  if (max === undefined) return '—'
  const hi = max >= 1000 ? `${(max / 1000).toFixed(max % 1000 === 0 ? 0 : 1)} km` : `${max} m`
  const lo = m.minRangeM && m.minRangeM > 0 ? m.minRangeM : 0
  if (lo === 0) return hi
  const loS = lo >= 1000 ? `${(lo / 1000).toFixed(lo % 1000 === 0 ? 0 : 1)} km` : `${lo} m`
  return `${loS} ~ ${hi}`
}

function CpuStrip({ used, total }: { used: number; total: number }): ReactNode {
  const rem = total - used
  const over = rem < 0
  const usedPct = total > 0 ? (over ? 100 : Math.max(0, Math.min(100, (used / total) * 100))) : 0
  const cls = over ? 'is-full' : (total > 0 && used / total >= 0.9) ? 'is-warn' : 'is-ok'
  return (
    <div
      className={`app-fit-cpustrip ${cls}`}
      title={tr("ui.FitPage.019")}
    >
      <span className="app-fit-cpustrip-label">{tr("ui.FitPage.020")}</span>
      <span className="app-fit-cpustrip-num">
        {used} / {total} <span style={{ fontSize: 'var(--wui-fs-xs)', color: 'rgb(var(--wui-dim))', fontWeight: 'normal' }}>(剩 {minus(rem)})</span>
      </span>
      <span className="app-fit-cpustrip-pct">
        {over ? tr("ui.FitPage.128", { p1: -rem }) : rem === 0 ? tr("ui.FitPage.021") : `${Math.round(usedPct)}%`}
      </span>
      <span className={`app-fit-cpustrip-track ${cls}`} role="progressbar" aria-valuenow={Math.round(usedPct)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${usedPct}%` }} />
      </span>
    </div>
  )
}

export function FitPage({ engine, onToast, fitShipId = null }: PageProps & { fitShipId?: string | null }) {
  const [rangeOpen, setRangeOpen] = useState(false)
  const state = engine.state
  const piloted = state.shipId
  const [targetId, setTargetId] = useState<string>(fitShipId && state.fleet[fitShipId] ? fitShipId : piloted)
  useEffect(() => {
    if (fitShipId && state.fleet[fitShipId]) {
      setTargetId(fitShipId)
    }
  }, [fitShipId, state.fleet])
  const effectiveTarget = state.fleet[targetId] ? targetId : piloted
  const isPiloted = effectiveTarget === piloted
  const configurationBlock = shipOperationBlockReason(state, engine.ctx, effectiveTarget, 'configure')
  const shipDef = fleetDefOf(state, engine.ctx, effectiveTarget)
  const shipName = shipDisplayName(state, engine.ctx, effectiveTarget)
  const fitted = state.fleet[effectiveTarget]?.fitted
  const slots = shipDef ? shipSlotsWithPlugsOf(state, engine.ctx, effectiveTarget) : { high: 1, mid: 1, low: 1 }
  const spec = shipDef ? createPlayerSpec(state, engine.ctx, effectiveTarget) : null
  const hitRead = spec ? meanHitRateOf(spec) : null
  const hitDetail = hitRead ? hitDetailText(hitRead) : ''
  const effWarp = shipDef
    ? {
        aus: warpSpeedAus(state, engine.ctx, effectiveTarget),
        bonusPct: warpBonusMult(state, engine.ctx, effectiveTarget) - 1,
      }
    : undefined
  const warpFactor = travelTimeFactor(state, engine.ctx, effectiveTarget)

  const bayModules: ModuleDef[] = engine.allModules.filter((m) => countModule(state, m.id) > 0)
  const droneLoadOf = state.fleet[effectiveTarget]?.droneLoad
  const cpuUsed = fitted ? fittedCpuUsed(fitted, engine.ctx, shipDef) + droneCpuUsed(droneLoadOf, engine.ctx) : 0

  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageFit, setStageFit] = useState({ art: 280, indirect: true })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => {
      const avail = el.clientWidth - 22
      const INDIRECT_MIN = 250
      const GAP = 12
      const MIN_ART = 190
      const MAX_ART = 300
      const keepIndirect = avail >= MIN_ART + GAP + INDIRECT_MIN
      let art = keepIndirect ? Math.min(MAX_ART, Math.max(MIN_ART, avail - GAP - INDIRECT_MIN)) : Math.min(MAX_ART, Math.round(avail * 0.92))
      if (art < 130) art = 130
      setStageFit((old) => (old.art === art && old.indirect === keepIndirect ? old : { art, indirect: keepIndirect }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function handleUnfit(rack: RackSlot, index: number): void {
    const r = engine.unfitAtAt(rack, index, effectiveTarget)
    if (r.ok) onToast(tr("ui.FitPage.129"))
    else onToast(cmdText(r) || tr('ui.FitPage.165'), true)
  }

  const [presetOpen, setPresetOpen] = useState(false)
  const [presetRename, setPresetRename] = useState<{ index: number; name: string } | null>(null)
  const [presetReplaceAt, setPresetReplaceAt] = useState<number | null>(null)
  const [presetDetailAt, setPresetDetailAt] = useState<number | null>(null)
  const presetDefId = shipDef?.id ?? ''
  const presets = presetDefId.length > 0 ? fitPresetsOf(state, presetDefId) : []

  function handleSavePreset(): void {
    const r = engine.saveFitPresetFor(effectiveTarget)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.166'), true)
      setPresetOpen(true)
      return
    }
    onToast(tr("ui.FitPage.130"))
    setPresetOpen(true)
  }

  function handleApplyPreset(index: number): void {
    const r = engine.applyFitPresetAt(effectiveTarget, index)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.167'), true)
      return
    }
    setPresetOpen(false)
    setPresetRename(null)
    onToast(r.summary)
  }

  function handleRenamePreset(): void {
    if (!presetRename) return
    const r = engine.renameFitPresetAt(presetDefId, presetRename.index, presetRename.name)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.168'), true)
      return
    }
    onToast(tr("ui.FitPage.131"))
    setPresetRename(null)
  }

  function handleOverwritePreset(index: number): void {
    const r = engine.overwriteFitPresetAt(effectiveTarget, index)
    setPresetReplaceAt(null)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.169'), true)
      return
    }
    setPresetDetailAt(null)
    onToast(tr("ui.FitPage.132"))
  }

  function handleDeletePreset(index: number): void {
    const r = engine.deleteFitPresetAt(presetDefId, index)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.170'), true)
      return
    }
    setPresetRename(null)
    onToast(tr("ui.FitPage.133"))
  }

  function handleUnfitAll(): void {
    const r = engine.unfitAllFor(effectiveTarget)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.165'), true)
      return
    }
    if (r.removed > 0) onToast(tr("ui.FitPage.134", { p1: r.removed }))
    else onToast(tr("ui.FitPage.135"), true)
  }

  const [pickBay, setPickBay] = useState<{ rack: RackSlot; index: number } | null>(null)
  const [pickDiffs, setPickDiffs] = useState<Map<string, FitSeg[]> | null>(null)
  const [pickKw, setPickKw] = useState('')
  const [pickSlot, setPickSlot] = useState<string>('all')
  const pickQuery = pickKw.trim().toLowerCase()
  function candidatesOf(rack: RackSlot): ModuleDef[] {
    const base = bayModules.filter((m) => isRackModule(m) && rackOf(m) === rack && moduleAllowedOnShip(shipDef, m))
    const hit = (m: ModuleDef): boolean => {
      if (pickSlot !== 'all' && m.slot !== pickSlot) return false
      if (pickQuery.length === 0) return true
      return (
        m.name.toLowerCase().includes(pickQuery) ||
        m.id.toLowerCase().includes(pickQuery) ||
        slotText(m.slot).toLowerCase().includes(pickQuery) ||
        (m.description ?? '').toLowerCase().includes(pickQuery)
      )
    }
    return base
      .filter(hit)
      .map((m, i) => ({ m, i, tier: rarityTierOf(`mod-${m.id}`) }))
      .sort((a, b) => b.tier - a.tier || a.i - b.i)
      .map((x) => x.m)
  }
  const pickShown: ModuleDef[] = pickBay ? candidatesOf(pickBay.rack) : []
  function pickSlotOptions(rack: RackSlot): Array<{ slot: string; label: string; count: number }> {
    const cnt = new Map<string, number>()
    for (const m of bayModules) {
      if (!isRackModule(m) || rackOf(m) !== rack || !moduleAllowedOnShip(shipDef, m)) continue
      cnt.set(m.slot, (cnt.get(m.slot) ?? 0) + 1)
    }
    return [...cnt.entries()]
      .map(([slot, count]) => ({ slot, label: slotText(slot), count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  }
  function tryFitSpec(
    m: ModuleDef,
    rack: RackSlot,
    index: number,
  ): { cur: UnitSpec; next: UnitSpec | null; cpuNext: number; cpuTotalNext: number } | null {
    const curSpec = spec
    if (!curSpec) return null
    const base: FittedModules = fitted ?? { high: [], mid: [], low: [] }
    const arr = [...(base[rack] ?? [])]
    while (arr.length <= index) arr.push(null)
    arr[index] = m.id
    const simFitted: FittedModules = { ...base, [rack]: arr }
    const fleet = state.fleet[effectiveTarget]
    if (!fleet) return null
    const simState: GameState = {
      ...state,
      fleet: { ...state.fleet, [effectiveTarget]: { ...fleet, fitted: simFitted } },
    }
    return {
      cur: curSpec,
      next: createPlayerSpec(simState, engine.ctx, effectiveTarget),
      cpuNext: fittedCpuUsed(simFitted, engine.ctx, shipDef) + droneCpuUsed(fleet.droneLoad, engine.ctx),
      cpuTotalNext: cpuBudgetOf(state, engine.ctx, effectiveTarget, simFitted),
    }
  }
  function openPick(rack: RackSlot, index: number): void {
    if (configurationBlock) { onToast(cmdText(configurationBlock), true); return }
    setPickKw('')
    setPickSlot('all')
    setPickBay({ rack, index })
    const cpuTotal = cpuBudgetOf(state, engine.ctx, effectiveTarget)
    const segs = new Map<string, FitSeg[]>()
    for (const m of candidatesOf(rack)) {
      const oldId = fitted?.[rack]?.[index] ?? null
      if (oldId === m.id) {
        segs.set(m.id, [])
        continue
      }
      const r = tryFitSpec(m, rack, index)
      const oldDef = oldId !== null ? engine.ctx.modules.get(oldId) ?? null : null
      const isWeaponSlot = WEAPON_SLOTS.has(m.slot)
      const weapon = isWeaponSlot
        ? {
            curMult: oldDef?.dmgMult ?? null,
            nextMult: m.dmgMult ?? null,
            curType: oldDef ? weaponDamageTypeOf(oldDef) : null,
            nextType: weaponDamageTypeOf(m),
          }
        : undefined
      segs.set(
        m.id,
        r && r.next ? diffSegs(r.cur, r.next, cpuUsed, r.cpuNext, cpuTotal, weapon, r.cpuTotalNext) : [],
      )
    }
    setPickDiffs(segs)
  }
  function pickModule(m: ModuleDef): void {
    if (!pickBay) return
    const { rack, index } = pickBay
    const had = (fitted?.[rack]?.[index] ?? null) !== null
    const r = engine.swapModuleTo(m.id, rack, index, effectiveTarget)
    if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.171'), true)
    else onToast(tr("ui.FitPage.136", { p1: m.name, p2: had ? tr("ui.FitPage.022") : tr("ui.FitPage.023"), p3: rackText(rack), p4: index + 1 }))
    setPickBay(null)
  }

  function stealthTraitNote(m: ModuleDef): string {
    if (m.stealthMs === undefined || !shipDef) return ''
    const bits: string[] = []
    if (shipDef.stealthCpuMul !== undefined && shipDef.stealthCpuMul !== 1) {
      bits.push(tr("ui.FitPage.137", { p1: cpuUseOf(m, shipDef), p2: m.cpuUse ?? 0 }))
    }
    if (shipDef.stealthIgnoresPropulsion === true) bits.push(tr("ui.FitPage.138"))
    return bits.length > 0 ? ` ← ${bits.join(' · ')}` : ''
  }

  function fitOptionLabel(m: ModuleDef): string {
    const base = `${m.name}（×${countModule(state, m.id)} · ${moduleShortEffect(m)}）${stealthTraitNote(m)}`
    if (m.unique === true) return tr("ui.FitPage.194", { base })
    if (!fitted) return base
    const st = stackingOf(m)
    if (st.group === 'flat') return base
    if (st.kind === 'support-damage' || st.kind === 'reload') return base
    const remaining = pickBay ? { ...fitted, [pickBay.rack]: fitted[pickBay.rack].filter((_, i) => i !== pickBay.index) } : fitted
    const n = sameKindCount(remaining, engine.ctx, m)
    if (n === 0) return base
    if (st.group === 'max') return tr(st.kind === 'blink' ? "ui.FitPage.193" : st.kind === 'capture-web' ? "ui.FitPage.195" : "ui.FitPage.139", { base: base, p2: n + 1 })
    if (st.group === 'curve' || st.group === 'weighted' || st.group === 'fleetDecay') {
      return tr("ui.FitPage.140", { base: base, p2: n + 1, p3: Math.round(stackWeight(n + 1) * 100) })
    }
    return tr("ui.FitPage.141", { base: base, p2: n + 1 })
  }

  const droneBayTotal = droneBayTotalM3(shipDef, fitted, engine.ctx, engine.state.fleet[effectiveTarget]?.plugs)

  const holdCapM3 = cargoCapacityM3Of(state, engine.ctx, effectiveTarget)

  const repairKitRows: { kitId: string; name: string; stock: number; perJumpSecs: number }[] = []
  const freeRepairRows: { name: string; secs: number; armor: number; hull: number }[] = []
  if (fitted) {
    for (const id of Object.values(fitted).flat()) {
      if (typeof id !== 'string' || id.length === 0) continue
      const mod = engine.ctx.modules.get(id)
      if (!mod || ((mod.repairArmorHp ?? 0) <= 0 && (mod.repairHullHp ?? 0) <= 0)) continue
      const secs = Math.max(1, Math.round((mod.repairIntervalMs ?? 5_000) / 1_000))
      if (mod.repairFree === true) {
        freeRepairRows.push({
          name: mod.name,
          secs,
          armor: mod.repairArmorHp ?? 0,
          hull: mod.repairHullHp ?? 0,
        })
        continue
      }
      const kitId = mod.repairKit ?? 'repairkit-civ'
      if (repairKitRows.some((r) => r.kitId === kitId)) continue
      repairKitRows.push({
        kitId,
        name: engine.ctx.items.get(kitId)?.name ?? kitId,
        stock: (state.fleet[effectiveTarget]?.cargo?.[kitId] ?? 0) + countWare(state, kitId),
        perJumpSecs: secs,
      })
    }
  }

  return (
    <div className="page-stack page-fill">
      {rangeOpen ? <FittingRange engine={engine} shipId={effectiveTarget} onClose={() => setRangeOpen(false)} /> : null}
      <Panel className="is-fill" title={tr("ui.FitPage.024")} right={<span className="app-dim">{tr("ui.FitPage.025")}</span>}>
        {/* 装配目标（船长 2026-09-05：醒目左置；入口在舰船页卡片，本页不再切换目标） */}
        <div className="app-fit-target">
          <span className="app-fit-target-label">
            {tr("ui.FitPage.026")}
            {isPiloted ? <em className="app-belt-flag is-run">{tr("ui.FitPage.027")}</em> : <em className="app-belt-flag">{tr("ui.FitPage.028")}</em>}
          </span>
          <FitTargetSelect state={state} ctx={engine.ctx} value={effectiveTarget} onChange={setTargetId} />
          <button className="app-btn is-small" data-fitting-range onClick={() => setRangeOpen(true)} disabled={!shipDef}><Crosshair size={16} aria-hidden="true" />{tr('ui.fittingRange.001')}</button>
          <span className="app-dim app-fit-target-hint">
            {isPiloted
              ? tr("ui.FitPage.029")
              : tr("ui.FitPage.030")}
          </span>
          {/* 装配方案（2026-09-14 船长：保存当前装配 / 使用预设装配）——同一船型通用 */}
          <div className="app-fit-preset-bar">
            <button
              className="app-btn is-small"
              onClick={handleSavePreset}
              title={tr("ui.FitPage.031")}
            >
              {tr("ui.FitPage.032")}
            </button>
            <button
              className="app-btn is-small is-primary"
              onClick={() => setPresetOpen(true)}
              title={tr("ui.FitPage.142", { FIT_PRESET_MAX: FIT_PRESET_MAX })}
            >
              {tr("ui.FitPage.033")} <em className="app-fit-preset-count">{presets.length}/{FIT_PRESET_MAX}</em>
            </button>
          </div>
        </div>
        {configurationBlock ? <div className="app-fit-activity-note" role="status" data-fit-activity>
          <span className="app-chip is-warn">{tr('ui.fitOverview.001')}</span>
          <span className="app-dim">{cmdText(configurationBlock)}</span>
        </div> : null}
        <div className="app-fit-cols">
          <div className="app-fit-col-left">
        {shipDef ? (
          <>
            <FittingSummary spec={spec} />
            {/* 舰船形象 + 间接属性（船长 2026-09-09：左栏顶部插入独立舰影，间接属性移其右侧；
                窄窗优先缩小舰影，图缩至下限仍不够时隐藏间接列——高度守恒：原底部间接块整体上移占位） */}
            <div className="app-fit-stage" ref={stageRef}>
              <div className="app-fit-stage-art">
                <ShipSprite shipId={shipDef.id} role={shipDef.role} size={stageFit.art} engine={false} />
              </div>
              {stageFit.indirect && shipIndirectLines(shipDef, effWarp).length > 0 ? (
                <div className="app-fit-indirect">
                  <div className="app-info-note app-fit-indirect-note">{tr("ui.FitPage.034")}</div>
                  <InfoTable lines={shipIndirectLines(shipDef, effWarp)} />
                </div>
              ) : null}
            </div>
          <div className="app-fit-shipinfo">
            <span className="app-fit-shipinfo-head">
              {/* 血量徽章 = 装后合成值（装备/技能生效后）；火力增幅已从徽章移入下方属性行（船长 2026-09-05） */}
              <span className="app-combat-badges">
                {combatBadges(
                  shipDef,
                  spec
                    ? { hp: { s: ceilFinalQuantity(spec.hp.s), a: ceilFinalQuantity(spec.hp.a), h: ceilFinalQuantity(spec.hp.h) }, resists: spec.resists }
                    : undefined,
                )}
              </span>
            </span>
            <InfoTable
              lines={[
                ...shipInfoLines(shipDef).filter(
                  (l) =>
                    // ⚠ 本页**原地**过滤掉的基础行走单点 `fitHiddenBaseKeys()`（按 id 取当前语言的 label）——
                    // 旧写法是四条**中文字面量**比对（`l.k !== '货舱容量'` 之类）：zh 下恰好命中、
                    // **en 下一律不命中** ⇒ 英文界面里那几条基础行会照常显示（2026-10-02 修）。
                    !fitHiddenBaseKeys().includes(l.k) &&
                    // 2026-09-26 船长：「无人机舱有2个重复的」＋「用机动速度替换所有动力的位置」
                    // ⇒ 这两条基础行让位给下面的合计行 / 装后口径行（登记表见 `shipInfo.tsx`
                    // `FIT_MAIN_HIDDEN_KEYS`，`npm run ui:attr-check` 按「不重名」体检）
                    !FIT_MAIN_HIDDEN_KEYS().includes(l.k) &&
                    !COMBAT_BASE_KEYS().has(l.k),
                ),
                // 机动速度（2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的
                // 说明内讲清」）：推进器周期化（2026-09-10）后 `spec.speedMps` **已不含**推进器加成
                // （加成走 `thrusterBoost`、只在点火窗口生效）——旧标签「含加力」与自己显示的数字
                // 对不上，改为「基础值 +（装推进器时）点火期值 + 周期尾缀」，秒数与 balance 同源。
                // **2026-09-14 起按船取值**：周期取自本船 `spec` 的两个覆盖字段（微型跃迁引擎 = 10 秒点火）。
                // **2026-09-26 船长**：「用机动速度替换所有动力的位置（假如已经存在，则挪过来）」
                // ⇒ 本行从右下角装后块**整体上移**到原「动力」行的位置（动力已挪去左栏「间接属性」）。
                // 行内容走 `fittedSpeedLine` 单点——舰队页悬停卡（`shipCurrentLines`）同一份。
                ...(spec ? [fittedSpeedLine(spec, engine.ctx.balance.battle)] : []),
                // 无人机舱（上限 = 船体 + 甲板扩展；战斗只放飞下方「无人机舱」清单——2026-09-08 大改）
                ...(droneBayTotal > 0 ? [fittedDroneBayLine(droneBayTotal)] : []),
                // **货舱容量（装后口径）**——2026-10-02 船长报障「装配界面的属性中无法查看舰船当前货仓大小」：
                // 基础行被本页过滤掉、又没有替代行 ⇒ 补上装后行（core 单点 `cargoCapacityM3Of`：
                // 船体 × 货舱扩展件 × 深空物流学 × 货舱管理学 ×[货舰]货舰操作）。与无人机舱合计同属"容量"读数，紧跟其后。
                ...(holdCapM3 > 0 ? [fittedHoldLine(holdCapM3)] : []),
                // 船体维修装置·运转消耗（2026-09-10 船长：消耗组件需高亮；0 枚红字告警）
                ...repairKitRows.map((r) => {
                  const cls = r.stock <= 0 ? 'is-bad' : r.stock < 10 ? 'is-warn' : 'is-ok'
                  const hint =
                    r.stock <= 0
                      ? tr("ui.FitPage.036")
                      : r.stock < 10
                        ? tr("ui.FitPage.037")
                        : tr("ui.FitPage.038")
                  return {
                    k: tr("ui.FitPage.039"),
                    v: (
                      <>
                        <em className="app-chip is-cost">{tr('ui.FitPage.163', { name: r.name, s: r.perJumpSecs })}</em>
                        <span className={`app-kit-stock ${cls}`}>
                          {' '}{tr("ui.FitPage.040")} {r.stock} {tr("ui.FitPage.041")}{hint}）
                        </span>
                      </>
                    ),
                  }
                }),
                // 无消耗自愈件（异形生体件）：不吃组件、永不停机——单列一行，避免玩家误以为要备料
                ...(freeRepairRows.length > 0
                  ? [
                      {
                        k: tr("ui.FitPage.042"),
                        v: (
                          <>
                            <em className="app-chip is-ok">{tr("ui.FitPage.043")}</em>
                            <span className="app-dim">
                              {' '}
                              {freeRepairRows
                                .map((r) => tr("ui.FitPage.144", { p1: r.name, p2: r.secs, p3: r.armor, p4: r.hull }))
                                .join('；')}
                              {tr("ui.FitPage.044")}
                            </span>
                          </>
                        ),
                      },
                    ]
                  : []),
                // 装后合成预览（V18.1：收敛件多装最终值；血量由顶部徽章承担不重复列出——与最上方徽章同源）
                ...(spec
                  ? [
                      { k: tr("ui.FitPage.045"), v: resChipsAll(spec.resists.shield) },
                      { k: tr("ui.FitPage.046"), v: resChipsAll(spec.resists.armor) },
                      { k: tr("ui.FitPage.005"), v: resChipsAll(spec.resists.hull) },
                      {
                        k: tr("ui.FitPage.047"),
                        v:
                          hitRead === null ? (
                            '—'
                          ) : (
                            <>
                              {`${Math.round(hitRead.rate * 100)}%`}
                              {hitDetail !== '' ? <span className="app-dim">{`（${hitDetail}）`}</span> : null}
                            </>
                          ),
                      },
                      { k: tr("ui.FitPage.048"), v: `${Math.round(spec.evasion * 100)}%` },
                      // 机动速度已上移到主表（原「动力」行位置，见文件上方）——此处不再重复
                      // 跃迁速度（2026-09-14 跃迁计算机）：只影响**跨星系航行耗时**，战斗机动一字不动
                      // ⇒ 与「机动速度」并列单列一行，避免玩家把两个"速度"混为一谈。
                      {
                        k: tr("ui.FitPage.050"),
                        v: (
                          <>
                            {`${effWarp ? effWarp.aus.toFixed(2) : '-'} AU/s`}
                            {effWarp && effWarp.bonusPct > 0 ? (
                              <span className="app-dim">{tr("ui.FitPage.146", { p1: Math.round(effWarp.bonusPct * 100) })}</span>
                            ) : null}
                            <span className="app-dim">{tr("ui.FitPage.147", { p1: warpFactor.toFixed(2) })}</span>
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
              note={tr("ui.FitPage.148", { p1: slots.high, p2: slots.mid, p3: slots.low })}
            />
          </div>
          {/* 无人机舱（**2026-09-26 船长令**：「**无人机仓位移动到左半边**」）——原先在右栏低槽组下方，
              现挂在左栏「舰船属性表」之后：装什么机群与船体属性是同一件事的两面。
              自带顶部虚线分隔（`.app-fit-dronebay`），与上面那张表分得开。 */}
          <DroneBaySection engine={engine} onToast={onToast} target={effectiveTarget} />
          </>
        ) : null}
          </div>
          <div className="app-fit-col-right">
        {/* 弹药档位（**2026-09-26 船长令**：「**右侧弹药档位移动到最上方 CPU 上面**」）——
            "出战前选哪一档弹"是这一栏最靠前的动作，故放到 CPU 条之前；没有对应武器的弹族时
            整块不渲染（`AmmoTierSection` 的 `rows.length === 0` 早退）⇒ 无机炮的船这里就是 CPU 条打头。 */}
        <AmmoTierSection engine={engine} onToast={onToast} target={effectiveTarget} />
        {/* CPU 剩余条（船长 2026-09-05：由左栏移置槽位最上方、减法显示剩余；与放飞共用池）。
            2026-09-11 协处理器：预算 = 船体 CPU + 已装协处理器扩容 → 走 core `cpuBudgetOf` 单点 */}
        {shipDef ? (
          <CpuStrip used={cpuUsed} total={cpuBudgetOf(state, engine.ctx, effectiveTarget)} />
        ) : null}
        {/* V18：高/中/低三组槽位——按槽位图标排布（取消列表形式，船长 2026-09-05） */}
        <div className="app-fit-racks">
          {(['high', 'mid', 'low'] as RackSlot[]).map((rack) => {
            const bays = fitted ? fitted[rack] : []
            const filledCount = bays.filter((id) => id !== null).length
            const total = slots[rack]
            return (
              <div key={rack} className="app-fit-rack">
                <div className="app-fit-rack-title">
                  {rackText(rack)} <span className="app-dim">（{RACK_FAMILIES[rack]}）</span>
                  <span className="app-dim">　{filledCount}/{total} {tr("ui.FitPage.051")}</span>
                </div>
                <div className="app-fit-icongrid">
                {Array.from({ length: Math.max(total, bays.length) }, (_, i) => {
                  const fittedId = bays[i] ?? null
                  const fittedDef = fittedId ? engine.ctx.modules.get(fittedId) : undefined
                  if (!fittedDef) {
                    // 空位：点击槽位 → 浮层选装（船长 2026-09-05：格内不显示位序、无下拉）
                    return (
                      <button
                        key={`${rack}-${i}`}
                        className="app-fit-slot-icon is-empty"
                        disabled={configurationBlock !== null}
                        onClick={() => openPick(rack, i)}
                        title={tr("ui.FitPage.149", { p1: i + 1 })}
                      >
                        <span className="app-fit-slot-icon-glyph">＋</span>
                        <span className="app-fit-slot-icon-name">{tr("ui.FitPage.023")}</span>
                      </button>
                    )
                  }
                  const tone = toneOf(fittedDef.slot)
                  return (
                    <button
                      key={`${rack}-${i}`}
                      className="app-fit-slot-icon is-filled"
                      disabled={configurationBlock !== null}
                      onClick={() => openPick(rack, i)}
                      /* 2026-09-16 船长：「装配界面，鼠标悬停槽位上的装备时，显示出的装备详细过于简陋，
                         参考仓库界面的物品详细」⇒ 改挂**仓库同款富卡**（`moduleHoverContent` =
                         `ModuleHover` 的内容，标题 + 统一参数表 + 描述），行动提示降为末行注脚。
                         ⚠ 不再写 `title`：同一元素禁 `title` + 富提示并存（两个提示路径互顶）。 */
                      {...hoverTipProps(
                        /* 2026-09-29 船长令：修理类装备的卡要显示"装上船之后的实修值" ⇒ 这张卡是**已装**的，
                           把 engine ＋ 本舰 id 一并传下去（不传的卡 = "还没上船"，只显示基础值）。 */
                        moduleHoverContent(
                          fittedDef,
                          tr("ui.FitPage.150", { p1: i + 1, p2: stealthTraitNote(fittedDef) }),
                          engine,
                          effectiveTarget,
                          /* **本件在同族里的位序**（2026-09-29：多装递减装备的「有效值（原值）」要用它折权）：
                             按高→中→低槽位序遍历，数到本槽为止同收敛族的件数（含本件）。 */
                          (() => {
                            const kind = stackingOf(fittedDef).kind
                            let n = 0
                            for (const r of ['high', 'mid', 'low'] as const) {
                              const arr = state.fleet[effectiveTarget]?.fitted?.[r] ?? []
                              for (let k = 0; k < arr.length; k++) {
                                const id = arr[k]
                                if (!id) continue
                                const d = engine.ctx.modules.get(id)
                                if (!d || stackingOf(d).kind !== kind) continue
                                n += 1
                                if (r === rack && k === i) return n
                              }
                            }
                            return Math.max(1, n)
                          })(),
                        ),
                      )}
                    >
                      <span className="app-fit-slot-icon-glyph">
                        <Glyph name={fittedDef.slot} size={22} color={tone} />
                      </span>
                      <span className="app-fit-slot-icon-name">{fittedDef.name}</span>
                      <span
                        className="app-fit-slot-icon-unfit"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleUnfit(rack, i)
                        }}
                      >
                        {tr("ui.FitPage.052")}
                      </span>
                    </button>
                  )
                })}
                </div>
              </div>
            )
          })}
          {/* 弹药档位已上移到本栏最上方（2026-09-26 船长令），此处不再渲染 */}
          {/**
           * **舰船插件槽（只读）**（**2026-09-26 船长令**：「舰船插件是一种类似装备的东西，同样装备在
           * 舰船上，但是**不可拆卸，不可替换**」）。
           *
           * 与高/中/低槽**刻意不同**：这里**没有卸下按钮、没有浮层选装**——不可拆是**结构性**的
           * （core 的 `plugs.ts` 连 `removePlug` 都不存在），界面这一块只是**读数**。
           * 槽位上限与已装清单都走 core 单点 `plugInfoOf`；短效果复用装备行同一把尺 `moduleShortEffect`。
           */}
          <PluginSlotsSection engine={engine} target={effectiveTarget} />
          {/* 无人机舱已移到左栏（2026-09-26 船长令：「无人机仓位移动到左半边」） */}
        </div>
          </div>
        </div>
      </Panel>

      {/* 装配方案浮层（2026-09-14 船长）：套用 / 重命名 / 删除 / 一键卸下 */}
      {presetOpen ? (
        <div className="app-fit-overlay" onClick={() => setPresetOpen(false)}>
          <div className="app-fit-modal app-fit-preset-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>
                {tr("ui.FitPage.053")} {shipName}
                <HintIcon tip={tr("ui.FitPage.054")} />
              </span>
              <button className="app-btn is-small" onClick={() => setPresetOpen(false)}>
                {tr("ui.FitPage.055")}
              </button>
            </div>
            {presets.length === 0 ? (
              <div className="app-dim app-inv-empty">
                {tr("ui.FitPage.056")}
              </div>
            ) : (
              <div className="app-fit-preset-list">
                {presets.map((p, i) => {
                  // 明细每渲染算一次（件名解析走 core 单点 `fitPresetDetailOf`，界面不自己拼）
                  // ⚠ 2026-09-28：把**实际可用槽位**（含插件扩槽，本页 `slots` 已是单点结果）一并传下去，
                  //    否则装了扩槽插件的船会把扩出来的那一格当 overflow 报（玩家报障那批）
                  const detail = presetDetailAt === i && shipDef ? fitPresetDetailOf(p, engine.ctx, shipDef, slots) : null
                  return (
                  <div className="app-fit-preset-item" key={`${p.name}-${i}`}>
                  <div className="app-fit-preset-row">
                    {presetRename?.index === i ? (
                      <>
                        <input
                          className="app-mkt-search-input app-fit-preset-name"
                          value={presetRename.name}
                          maxLength={FIT_PRESET_NAME_MAX}
                          spellCheck={false}
                          onChange={(e) => setPresetRename({ index: i, name: e.target.value })}
                        />
                        <span className="app-dim">{fitPresetBrief(p)}</span>
                        <button className="app-btn is-small is-primary" onClick={handleRenamePreset}>
                          {tr("ui.FitPage.057")}
                        </button>
                        <button className="app-btn is-small" onClick={() => setPresetRename(null)}>
                          {tr("ui.ActivityBar.004")}
                        </button>
                      </>
                    ) : presetReplaceAt === i ? (
                      /* 替换的两步确认（船长 2026-09-19）：覆盖前先问一句 */
                      <>
                        <b>{p.name}</b>
                        <span className="app-dim">{tr("ui.FitPage.058")}</span>
                        <button
                          className="app-btn is-small is-primary"
                          title={tr("ui.FitPage.059")}
                          onClick={() => handleOverwritePreset(i)}
                        >
                          {tr("ui.FitPage.060")}
                        </button>
                        <button className="app-btn is-small" onClick={() => setPresetReplaceAt(null)}>
                          {tr("ui.ActivityBar.004")}
                        </button>
                      </>
                    ) : (
                      <>
                        <b>{p.name}</b>
                        <span className="app-dim">{fitPresetBrief(p)}</span>
                        <button
                          className="app-btn is-small"
                          onClick={() => setPresetDetailAt(presetDetailAt === i ? null : i)}
                          title={tr("ui.FitPage.061")}
                        >
                          {presetDetailAt === i ? tr("ui.FitPage.062") : tr("ui.FitPage.063")}
                        </button>
                        <button className="app-btn is-small is-primary" disabled={configurationBlock !== null} title={configurationBlock ? cmdText(configurationBlock) : undefined} onClick={() => handleApplyPreset(i)}>
                          {tr("ui.FitPage.064")}
                        </button>
                        <button
                          className="app-btn is-small"
                          title={tr("ui.FitPage.065")}
                          onClick={() => setPresetReplaceAt(i)}
                        >
                          {tr("ui.FitPage.066")}
                        </button>
                        <button
                          className="app-btn is-small"
                          onClick={() => setPresetRename({ index: i, name: p.name })}
                        >
                          {tr("ui.FitPage.067")}
                        </button>
                        <button className="app-btn is-small is-warn" onClick={() => handleDeletePreset(i)}>
                          {tr("ui.FitPage.068")}
                        </button>
                      </>
                    )}
                  </div>
                  {/* 方案明细（2026-09-17 船长）：逐位列出「高 1 件名 · 2 空 …」＋无人机；件名走 core 单点 */}
                  {detail ? (
                    <div className="app-fit-preset-detail">
                      {(['high', 'mid', 'low'] as const).map((rack) => (
                        <div className="app-fit-preset-detail-line" key={rack}>
                          <span className="app-fit-preset-detail-rack">{rackText(rack)}</span>
                          {detail.slots
                            .filter((s) => s.rack === rack)
                            .map((s) => (
                              <span
                                className={`app-fit-preset-detail-cell${s.id === null ? ' is-empty' : ''}${s.missing ? ' is-missing' : ''}`}
                                key={`${rack}-${s.index}`}
                              >
                                <em>{s.index}</em>
                                {s.name}
                                {s.missing ? tr("ui.FitPage.069") : ''}
                              </span>
                            ))}
                        </div>
                      ))}
                      <div className="app-fit-preset-detail-line">
                        <span className="app-fit-preset-detail-rack">{tr("ui.Handbook.004")}</span>
                        {detail.drones.length === 0 ? (
                          <span className="app-fit-preset-detail-cell is-empty">{tr("ui.FitPage.070")}</span>
                        ) : (
                          detail.drones.map((d) => (
                            <span
                              className={`app-fit-preset-detail-cell${d.missing ? ' is-missing' : ''}`}
                              key={d.id}
                            >
                              {d.name} ×{d.count}
                              {d.missing ? tr("ui.FitPage.071") : ''}
                            </span>
                          ))
                        )}
                      </div>
                      {detail.plugs.length > 0 ? <div className="app-fit-preset-detail-line">
                        <span className="app-fit-preset-detail-rack">{tr('ui.wreckFit.002')}</span>
                        {detail.plugs.map((p, at) => <span key={`${p.id}-${at}`} className={`app-fit-preset-detail-cell${p.missing ? ' is-missing' : ''}`}>{p.name}</span>)}
                      </div> : null}
                      {detail.overflow > 0 ? (
                        <div className="app-fit-preset-detail-note">
                          {tr("ui.FitPage.072")} {detail.overflow} {tr("ui.FitPage.073")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  </div>
                  )
                })}
              </div>
            )}
            <div className="app-fit-preset-foot">
              <button className="app-btn is-small" onClick={handleSavePreset}>
                {tr("ui.FitPage.074")}
              </button>
              <button
                className="app-btn is-small is-warn"
                onClick={handleUnfitAll}
                disabled={configurationBlock !== null}
                title={tr("ui.FitPage.075")}
              >
                {tr("ui.FitPage.076")}
              </button>
              <span className="app-dim">
                {tr("ui.FitPage.077")}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 槽位换装浮层：覆盖左侧舰船属性（船长 2026-09-05） */}
      {pickBay ? (
        <div className="app-fit-overlay" onClick={() => setPickBay(null)}>
          <div className="app-fit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>
                {tr('ui.FitPage.164', { rack: rackText(pickBay.rack), n: pickBay.index + 1 })}
                {fitted?.[pickBay.rack]?.[pickBay.index] ? tr("ui.FitPage.078") : tr("ui.FitPage.079")}
                <HintIcon tip={tr("ui.FitPage.080")} />
              </span>
              <button className="app-btn is-small" onClick={() => setPickBay(null)}>
                {tr("ui.FitPage.055")}
              </button>
            </div>
            {/* 筛选与搜索（2026-09-11 船长定：参考市场页；复刻 app-mkt-search 那套"搜索框 + 分类下拉 + 命中计数"） */}
            <div className="app-mkt-search app-fit-pick-filter">
              <input
                className="app-mkt-search-input"
                type="search"
                placeholder={tr("ui.FitPage.081")}
                value={pickKw}
                onChange={(e) => setPickKw(e.target.value)}
                spellCheck={false}
              />
              <select
                className="app-mkt-kind"
                value={pickSlot}
                onChange={(e) => setPickSlot(e.target.value)}
                title={tr("ui.FitPage.082")}
              >
                <option value="all">{tr("ui.FitPage.083")}</option>
                {pickSlotOptions(pickBay.rack).map((o) => (
                  <option key={o.slot} value={o.slot}>
                    {o.label}（{o.count}）
                  </option>
                ))}
              </select>
              <span className="app-dim">
                {pickQuery.length > 0 || pickSlot !== 'all'
                  ? tr("ui.FitPage.151", { p1: pickShown.length })
                  : tr("ui.FitPage.152", { p1: pickShown.length })}
              </span>
            </div>
            <div className="app-fit-pickgrid">
              {pickShown.length === 0 ? (
                <div className="app-dim app-exp-idle">{tr("ui.FitPage.084")}</div>
              ) : null}
              {pickShown.map((m) => {
                const segs = pickDiffs?.get(m.id)
                const sameAsOld = (fitted?.[pickBay.rack]?.[pickBay.index] ?? null) === m.id
                return (
                  <button
                    key={m.id}
                    className="app-fit-pick-item"
                    /* 2026-09-16 同批：候选卡也换成**仓库同款富卡**（标题 + 参数表 + 描述），
                       `fitOptionLabel` 里那串"第 N 件衰减/取最长一件"的行动信息降为末行注脚。
                       ⚠ 不再写 `title`（同一元素禁 `title` + 富提示并存）。 */
                    {...hoverTipProps(moduleHoverContent(m, fitOptionLabel(m), engine, effectiveTarget))}
                    onClick={() => pickModule(m)}
                    disabled={sameAsOld || configurationBlock !== null}
                  >
                    {/* 图标与名称同行（船长 2026-09-05：图标不再单独占一行） */}
                    <span className="app-fit-pick-head">
                      <span className="app-fit-pick-icon">
                        <Glyph name={m.slot} size={20} color={toneOf(m.slot)} />
                      </span>
                      <span className="app-fit-pick-name">{m.name}</span>
                    </span>
                    {/* 说明行：武器 = 弹药类型 chip（攻击类型醒目）+ **弹伤害倍率** + 层位克制 + 射程；
                        2026-09-11 船长：「装配界面更换炮台时，只简略的显示了火力变化，无法看到武器的
                        弹药伤害倍率」⇒ 弹种 chip 旁补一枚克制 chip（复用 DmgChip，悬停给三层全串），
                        文本里给出 `弹伤 ×N`（= 模块 dmgMult，单发 = 弹 dmg × 本倍率）。 */}
                    <span className="app-fit-pick-sub">
                      {WEAPON_SLOTS.has(m.slot) ? (
                        <>
                          {ammoChipOf(m)}
                          <DmgChip t={weaponDamageTypeOf(m)} label={layerShortOf(weaponDamageTypeOf(m))} />
                          <span className="app-fit-pick-subtext">
                            ×{countModule(state, m.id)}
                            {m.dmgMult !== undefined ? tr("ui.FitPage.153", { p1: mulText(m.dmgMult) + ((m.shots ?? 1) > 1 ? `×${m.shots}` : '') }) : ''}
                            {/* ⟪2026-09-22 船长令⟫ 单轮发数并进同一乘式：陵卫连装炮显示「弹伤害 ×4.6×2」 */}
                            {tr('ui.FitPage.162', { r: rangeShort(m) })}
                          </span>
                        </>
                      ) : (
                        <span className="app-fit-pick-subtext">
                          ×{countModule(state, m.id)} · {moduleShortEffect(m)}
                        </span>
                      )}
                    </span>
                    {sameAsOld ? (
                      <span className="app-fit-pick-diff">
                        <span className="dseg is-none">{tr("ui.FitPage.085")}</span>
                      </span>
                    ) : segs && segs.length > 0 ? (
                      <span className="app-fit-pick-diff" title={segs.map((s) => s.t).join('　')}>
                        {segs.slice(0, 4).map((s, i) => (
                          <span key={i} className={`dseg is-${s.c}`}>
                            {s.t}
                          </span>
                        ))}
                        {segs.length > 4 ? <span className="dseg is-none">+{segs.length - 4}</span> : null}
                      </span>
                    ) : (
                      <span className="app-fit-pick-diff">
                        <span className="dseg is-none">{tr("ui.FitPage.086")}</span>
                      </span>
                    )}
                  </button>
                )
              })}
              {candidatesOf(pickBay.rack).length === 0 ? (
                <div className="app-dim app-inv-empty">
                  {tr("ui.FitPage.087")}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}


const AMMO_TYPES: readonly DamageType[] = ['kinetic', 'explosive', 'plasma']

function AmmoTierSection({
  engine,
  onToast,
  target,
}: {
  engine: PageProps['engine']
  onToast: PageProps['onToast']
  target: string
}) {
  const state = engine.state
  const resupplyFromWh = engine.state.resupplyFromWarehouse !== false
  const ctx = engine.ctx
  const ship = state.fleet[target]
  const configurationBlock = shipOperationBlockReason(state, ctx, target, 'configure')
  const spec = ship ? createPlayerSpec(state, ctx, target) : null
  const totals = spec ? ammoLoadTotals(spec, ctx.balance.battle, state) : {}
  const rows = AMMO_TYPES.map((type) => {
    const need = totals[type] ?? 0
    if (need <= 0) return null
    const tiers = ammoTiersOf(ctx, type)
    const base = ctx.items.get(`ammo-${type}-l`)
    const baseName = base?.name ?? DMG_LABEL[type]
    if (tiers.length < 2) return null
    const pref = ship?.ammoPref?.[type]
    const eff = resolveAmmoTier(state, ctx, target, type, need)
    const effName = ctx.items.get(eff.id)?.name ?? eff.id
    const noneLeft = eff.can <= 0 && need > 0
    return (
      <div key={type} className="app-fit-ammotier-row">
        <DmgChip t={type} label={baseName} />
        <span className="app-fit-ammotier-opts">
          {tiers.map((item, index) => <button
            key={item.id}
            aria-pressed={pref ? pref === item.id : index === 0}
            className={`app-fit-ammotier-opt${(pref ? pref === item.id : index === 0) ? ' is-active' : ''}`}
            disabled={configurationBlock !== null}
            onClick={() => {
              const r = engine.setAmmoTierAt(type, index === 0 ? null : item.id, target)
              if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.172'), true)
            }}
            title={configurationBlock ? cmdText(configurationBlock) : index === 0 ? tr('ui.FitPage.154', { baseName, baseName2: baseName })
              : item.id.endsWith('-2') ? tr('ui.FitPage.155', { p1: item.name, p2: item.dmg ?? '?', p3: base?.dmg ?? '?', haveMk2: countWare(state, item.id) })
                : tr('ui.ammoTier.001', { name: item.name, damage: item.dmg ?? '?', stock: countWare(state, item.id) })}
          >
            {item.name}
          </button>)}
        </span>
        <span className="app-dim">
          {tiers.map((item, index) => <span key={item.id}>{index > 0 ? ' · ' : ''}{item.name} ×{fmt(countWare(state, item.id))}</span>)}
          {need > 0 ? (
            <>
              {' · '}
              {tr("ui.FitPage.088")}<b>{effName}</b> {tr("ui.FitPage.089")} {fmt(eff.can)}/{fmt(need)}
            </>
          ) : null}
          {noneLeft ? (
            <>
              {' · '}
              <span className="app-fit-ammotier-warn">{tr("ui.FitPage.090")}</span>
            </>
          ) : eff.fellBack && need > 0 ? (
            <>
              {' · '}
              <span className="app-fit-ammotier-warn">
                ⚠ {pref ? ctx.items.get(pref)?.name ?? tr('ui.FitPage.173') : tr("ui.FitPage.091")}{tr("ui.FitPage.092")}{effName}
              </span>
            </>
          ) : null}
        </span>
      </div>
    )
  }).filter((x): x is NonNullable<typeof x> => x !== null)
  if (rows.length === 0) return null
  return (
    <div className="app-fit-ammotier">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">{tr("ui.FitPage.093")}</span>
        <span className="app-dim">{tr("ui.FitPage.094")}</span>
        <button
          type="button"
          className={`app-btn is-small hud-resupply-toggle${resupplyFromWh ? ' is-primary' : ''}`}
          onClick={() => {
            const next = !resupplyFromWh
            engine.state.resupplyFromWarehouse = next
            void engine.persist()
            onToast(next ? tr('ui.fitKpi.006') : tr('ui.fitKpi.007'))
          }}
          title="点击就地切换补给来源（从母港仓库直接取用 / 仅从舰船货仓取用）"
        >
          {resupplyFromWh ? tr('ui.fitKpi.004') : tr('ui.fitKpi.005')}
        </button>
      </div>
      {rows}
    </div>
  )
}


function PluginSlotsSection({ engine, target }: { engine: PageProps['engine']; target: string }) {
  const state = engine.state
  const ctx = engine.ctx
  const { slots, installed } = plugInfoOf(state, ctx, target)
  const damage = cleanShipDamage(state.fleet[target]?.damagePlugs)
  const [picking, setPicking] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [scrapStep, setScrapStep] = useState<0 | 1 | 2>(0)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      setPicking(false)
      setScrapStep(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const scrap = shipScrapPreviewOf(state, ctx, target)
  const configurationBlock = shipOperationBlockReason(state, ctx, target, 'configure')
  if (slots <= 0 && !damage) return null
  const full = slots > 0 && installed.length >= slots
  const pickable = [...ctx.modules.values()].filter(
    (d) => d.slot === 'plug' && (state.moduleBay[d.id] ?? 0) > 0 && !plugSlotExpansionBlockedOf(state, ctx, target, d),
  )
  const doInstall = (moduleId: string): void => {
    const r = installPlug(state, ctx, moduleId, target)
    if (r.ok) {
      setConfirmId(null)
      setPicking(false)
      setErr(null)
      setNote(tr('ui.FitPage.191'))
    } else {
      setErr(cmdText(r))
      setNote(null)
    }
  }
  return (
    <div className="app-fit-plugslots">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">{tr('ui.itemSubs.042')}</span>
        <span className="app-dim">
          {tr('ui.Expedition.444', { p1: installed.length, p2: slots })}
          {full ? ` · ${tr('ui.FitPage.177')}` : ''}
        </span>
        {damage ? <span className="app-ship-damage-count">{tr('ui.shipDamage.013')} {damage.length}</span> : null}
        {/* 拆船回收入口（2026-09-27 船长令）：位置按船长指定放在插件槽区 */}
        {slots > 0 ? <span style={{ marginLeft: 'auto' }}>
          <button className="app-btn is-small" onClick={() => setScrapStep(1)}>
            {tr('ui.FitPage.184')}
          </button>
        </span> : null}
      </div>
      <div className="app-fit-icongrid">
        {Array.from({ length: slots }, (_, i) => {
          const def = installed[i]
          if (!def) {
            /**
             * 空槽：**可点**（2026-09-27 补的装入入口；见本组件头注）。装满或无可装插件时点开是空列表，
             * 弹层里给一句解释，不让玩家对着没反应的格子点。
             */
            return (
              <span
                key={`plug-${i}`}
                className="app-fit-slot-icon is-empty"
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (configurationBlock) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setErr(null)
                    setConfirmId(null)
                    setPicking(true)
                  }
                }}
                onClick={() => {
                  if (configurationBlock) { setErr(cmdText(configurationBlock)); return }
                  setErr(null)
                  setConfirmId(null)
                  setPicking(true)
                }}
                aria-disabled={configurationBlock !== null}
                title={configurationBlock ? cmdText(configurationBlock) : tr('ui.FitPage.178')}
              >
                <span className="app-fit-slot-icon-glyph">＋</span>
                <span className="app-fit-slot-icon-name">{tr('ui.FitPage.178')}</span>
              </span>
            )
          }
          const tone = toneOf(def.slot)
          return (
            <span
              key={`plug-${i}`}
              className="app-fit-slot-icon is-filled is-readonly"
              {...hoverTipProps(
                /* 插件槽（只读展示）：同批 —— 也给本舰上下文（插件里的维修类效果按同一把尺显示） */
                moduleHoverContent(def, tr('ui.Expedition.443'), engine, target,
                  installed.slice(0, i + 1).filter(p => p.id === def.id).length),
              )}
            >
              <span className="app-fit-slot-icon-glyph">
                <Glyph name="plug" size={22} color={tone} />
              </span>
              <span className="app-fit-slot-icon-name">{def.name}</span>
              <span className="app-fit-slot-icon-sub">{moduleShortEffect(def)}</span>
            </span>
          )
        })}
        <ShipDamageMods ids={damage} management={plugEffectsOf(state, ctx, target).find(mod => mod.damageManagement)?.damageManagement} />
      </div>
      {/* **装入弹层**（2026-09-27 补）：复用本页既有的 `.app-fit-overlay` / `.app-fit-modal` 一族，
          不另造样式；二次确认在同一弹层内完成（第一次点「装入」⇒ 该行变成「确认装入」＋「取消」） */}
      {picking ? (
        <div className="app-mkt-confirm-mask" onClick={() => setPicking(false)}>
          <div className="app-mkt-confirm" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="app-mkt-confirm-title">{tr('ui.FitPage.179')}</div>
            <div className="app-mkt-confirm-row">
              <button className="app-btn is-small" onClick={() => setPicking(false)}>
                {tr('ui.FitPage.183')}
              </button>
            </div>
            {err !== null ? <div className="app-dim">{err}</div> : null}
            {pickable.length === 0 ? (
              <div className="app-dim">{tr('ui.FitPage.180')}</div>
            ) : (
              pickable.map((d) => (
                <div key={d.id} className="app-fit-preset-row">
                  <span className="app-fit-preset-name">{d.name}</span>
                  <span className="app-dim">{moduleShortEffect(d)}</span>
                  {confirmId === d.id ? (
                    <>
                      <span className="app-dim">{tr('ui.FitPage.182')}</span>
                      <button className="app-btn is-small is-primary" onClick={() => doInstall(d.id)}>
                        {tr('ui.FitPage.181')}
                      </button>
                      <button className="app-btn is-small" onClick={() => setConfirmId(null)}>
                        {tr('ui.FitPage.183')}
                      </button>
                    </>
                  ) : (
                    <button className="app-btn is-small" onClick={() => setConfirmId(d.id)}>
                      {tr('ui.FitPage.181')}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
      {note !== null ? <div className="app-dim">{note}</div> : null}
      {/* **拆船回收：两次警告**（2026-09-27 船长令）：走全仓既有确认层 `.app-mkt-confirm*` 家族 */}
      {scrapStep > 0 ? (
        <div className="app-mkt-confirm-mask" onClick={() => setScrapStep(0)}>
          <div className="app-mkt-confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="app-mkt-confirm-title">
              {tr(scrapStep === 1 ? 'ui.FitPage.185' : 'ui.FitPage.186')}
            </div>
            {!scrap.ok ? <div className="app-dim">{scrap.block ?? tr('core.scrap.002')}</div> : null}
            {scrapStep === 2 && scrap.ok ? (
              <>
                <div className="app-dim">{tr('ui.FitPage.187')}</div>
                {scrap.materials.map((m) => (
                  <div key={m.itemId} className="app-fit-preset-row">
                    <span className="app-fit-preset-name">{ctx.items.get(m.itemId)?.name ?? m.itemId}</span>
                    <span className="app-dim">×{m.count.toLocaleString('zh-CN')}</span>
                  </div>
                ))}
                <div className="app-dim">
                  {tr('ui.FitPage.190', { p1: scrap.moduleCount, p2: scrap.plugCount, p3: scrap.droneCount })}
                </div>
                <div className="app-dim">{tr('ui.FitPage.188')}</div>
              </>
            ) : null}
            {err !== null ? <div className="app-dim">{err}</div> : null}
            <div className="app-fit-preset-row">
              {scrapStep === 1 ? (
                <button
                  className="app-btn is-small is-primary"
                  disabled={!scrap.ok}
                  onClick={() => {
                    setErr(null)
                    setScrapStep(2)
                  }}
                >
                  {tr('ui.FitPage.184')}
                </button>
              ) : (
                <button
                  className="app-btn is-small is-danger"
                  disabled={!scrap.ok}
                  onClick={() => {
                    const r = scrapShip(state, ctx, target)
                    if (r.ok) {
                      setScrapStep(0)
                      setErr(null)
                      setNote(tr('ui.FitPage.192'))
                    } else {
                      setErr(r.error)
                      setNote(null)
                    }
                  }}
                >
                  {tr('ui.FitPage.189')}
                </button>
              )}
              <button className="app-btn is-small" onClick={() => setScrapStep(0)}>
                {tr('ui.FitPage.183')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}


function DroneBaySection({
  engine,
  onToast,
  target,
}: {
  engine: PageProps['engine']
  onToast: PageProps['onToast']
  target: string
}) {
  const state = engine.state
  const ctx = engine.ctx
  const entry = state.fleet[target]
  const shipDef = entry?.defId ? fleetDefOf(state, ctx, target) : undefined
  const fitted = entry?.fitted
  const load = entry?.droneLoad ?? {}
  const configurationBlock = shipOperationBlockReason(state, ctx, target, 'configure')
  const cap = droneBayTotalM3(shipDef, fitted, ctx, entry?.plugs)
  if (cap <= 0 && Object.keys(load).length === 0) return null
  const droneTypes = [...ctx.items.values()].filter((d) => d.kind === 'drone')
  const usedM3 = droneLoadM3(load, ctx)
  const droneCpu = droneCpuUsed(load, ctx)
  const pct = cap > 0 ? Math.min(100, (usedM3 / cap) * 100) : 0
  const [open, setOpen] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  const [selN, setSelN] = useState(1)
  const fittedCpu = fitted ? fittedCpuUsed(fitted, ctx, fleetDefOf(state, ctx, target)) : 0
  const cpuTotal = cpuBudgetOf(state, ctx, target)
  const cpuLeftRaw = cpuTotal - fittedCpu - droneCpu
  const cpuLeft = Math.max(0, cpuLeftRaw)

  function adj(id: string, delta: number): void {
    const r = engine.adjustDroneLoadAt(id, delta, target)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
  }
  function clearAll(): void {
    for (const [id, n] of Object.entries(load)) adj(id, -n)
  }
  function maxOf(droneId: string): number {
    const d = ctx.items.get(droneId)
    if (!d) return 0
    const have = countWare(state, droneId)
    const m3Left = Math.max(0, cap - droneLoadM3(load, ctx))
    const byM3 = Math.floor(m3Left / Math.max(0.001, d.unitM3 ?? 0))
    const byCpu = (d.cpuUse ?? 0) > 0 ? Math.floor(cpuLeft / (d.cpuUse ?? 1)) : 1_000_000
    return Math.max(0, Math.min(have, byM3, byCpu))
  }

  const cells = Object.entries(load)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => {
      const def = ctx.items.get(id)
      return { id, n, def }
    })
  const droneShort = autoLoopDroneShortfall(state, target)

  return (
    <div className="app-fit-dronebay">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">
          {tr("ui.FitPage.010")}
          {/* 并入 main（2026-09-20）：对方把这条说明扩写了（补"战斗结束自动补足"）⇒ 换新 id */}
          <span className="app-dim">{tr("ui.FitPage.174")}</span>
          {droneCpu > 0 ? (
            <span className="app-dim">{tr("ui.FitPage.096")} {droneCpu}）</span>
          ) : null}
        </span>
        {cells.length > 0 ? (
          <button className="app-btn is-small is-warn" disabled={configurationBlock !== null} onClick={clearAll} title={configurationBlock ? cmdText(configurationBlock) : tr("ui.FitPage.097")}>
            {tr("ui.FitPage.098")}
          </button>
        ) : null}
      </div>
      {/* 容量条（参考 CPU 条视觉；m³ 口径） */}
      <div className="app-fit-dronecap" title={tr("ui.FitPage.156", { p1: Math.round(usedM3 * 10) / 10, cap: cap, droneCpu: droneCpu })}>
        <span className="app-fit-dronecap-label">{tr("ui.FitPage.099")}</span>
        <span className="app-fit-dronecap-num">
          {Math.round(usedM3 * 10) / 10}/{cap} m³
        </span>
        <span className="app-fit-dronecap-track">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="app-dim">
          {cells.reduce((s, c) => s + c.n, 0)} {tr("ui.FitPage.100")} {droneCpu}
        </span>
      </div>
      {droneShort ? (
        <div className="app-dim" title={tr('ui.FitPage.175')}>
          {tr('ui.FitPage.176', {
            p1: droneShort.need - droneShort.now,
            p2: droneShort.floor,
            p3: droneShort.now,
          })}
        </div>
      ) : null}
      {/* 型卡流：一型一卡 ×N（+ / − 微调）；空态只有「装入」 */}
      <div className="app-fit-dronebay-cells">
        {cells.map(({ id, n, def }) => (
          <div
            key={id}
            className="app-fit-drone-cell"
            /* 2026-09-16 同批：无人机舱单元格也换**仓库同款富卡**（`itemHoverContent` = 仓库页
               `ItemHover` 的内容），原那句"清单口径"降为末行注脚；± 按钮自己的提示照旧内层优先。 */
            {...hoverTipProps(
              def
                ? itemHoverContent(def, (mid) => engine.ctx.items.get(mid)?.name, tr("ui.FitPage.157"))
                : tr("ui.FitPage.158", { id: id }),
            )}
          >
            {def ? (
              <span className="app-fit-drone-cell-glyph">
                <Glyph name="drone" size={16} color={toneOf('drone')} />
              </span>
            ) : null}
            <span className="app-fit-drone-cell-name">{def?.name ?? id} ×{n}</span>
            <button className="app-fit-drone-step" disabled={configurationBlock !== null} title={configurationBlock ? cmdText(configurationBlock) : tr("ui.FitPage.101")} onClick={() => adj(id, -1)}>
              −
            </button>
            <button className="app-fit-drone-step" disabled={configurationBlock !== null} title={configurationBlock ? cmdText(configurationBlock) : tr("ui.FitPage.102")} onClick={() => adj(id, 1)}>
              +
            </button>
          </div>
        ))}
        <button
          className="app-fit-drone-add"
          disabled={configurationBlock !== null}
          onClick={() => {
            setSelId(droneTypes.find((d) => maxOf(d.id) > 0)?.id ?? null)
            setSelN(1)
            setOpen(true)
          }}
          title={tr("ui.FitPage.103")}
        >
          {tr("ui.FitPage.104")}
        </button>
      </div>

      {/* 装入弹层：选型 + 数量（钳到 仓库/舱容/CPU 余量） */}
      {open ? (
        <div className="app-fit-overlay" onClick={() => setOpen(false)}>
          <div className="app-fit-modal app-fit-drone-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>{tr("ui.FitPage.105")} {Math.round(usedM3 * 10) / 10}/{cap} {tr("ui.FitPage.106")} {minus(cpuLeftRaw)}）</span>
              <button className="app-btn is-small" onClick={() => setOpen(false)}>
                {tr("ui.FitPage.055")}
              </button>
            </div>
            <div className="app-fit-drone-picklist">
              {droneTypes.map((d) => {
                const m = maxOf(d.id)
                const have = countWare(state, d.id)
                const active = selId === d.id
                return (
                  <button
                    key={d.id}
                    className={`app-fit-drone-pick${active ? ' is-active' : ''}${m <= 0 ? ' is-off' : ''}`}
                    onClick={() => {
                      setSelId(d.id)
                      setSelN(1)
                    }}
                    disabled={m <= 0}
                    title={tr("ui.FitPage.159", { p1: d.description, p2: d.unitM3, p3: d.cpuUse ?? 0, have: have })}
                  >
                    <Glyph name="drone" size={18} color={toneOf('drone')} />
                    <span className="app-fit-drone-pick-name">{d.name}</span>
                    <span className="app-dim">
                      {m <= 0 ? tr("ui.FitPage.107") : tr("ui.FitPage.160", { have: have, m: m })}
                    </span>
                  </button>
                )
              })}
            </div>
            {selId ? (
              <div className="app-fit-drone-qty">
                <span>{tr("ui.FitPage.108")}</span>
                <button className="app-fit-drone-step" disabled={selN <= 1} onClick={() => setSelN(Math.max(1, selN - 1))}>
                  −
                </button>
                <b>×{selN}</b>
                <button
                  className="app-fit-drone-step"
                  disabled={selN >= maxOf(selId)}
                  onClick={() => setSelN(Math.min(maxOf(selId), selN + 1))}
                >
                  +
                </button>
                <button
                  className="app-btn is-small is-primary"
                  disabled={maxOf(selId) <= 0 || configurationBlock !== null}
                  onClick={() => {
                    const want = Math.min(selN, maxOf(selId))
                    adj(selId, want)
                    setOpen(false)
                  }}
                >
                  {tr("ui.FitPage.109")}{Math.min(selN, Math.max(1, maxOf(selId)))}
                </button>
              </div>
            ) : (
              <div className="app-dim app-fit-drone-empty">{tr("ui.FitPage.110")}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
