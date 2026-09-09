/**
 * 装配页（V18 槽位制）：给"当前驾驶的船"装配装备。
 * 高/中/低三类物理槽 × 位序（ShipDef.slots 数量，复数安装）；模块按 rack 归槽
 * （高 = 炮台/采集器/无人机装置；中 = 盾系/推进；低 = 甲系/货舱扩展）。
 * 装备随船：换船后看到的是那艘船自己的装配；弃船时装备随船损失。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
  allFittedIds,
  countModule,
  countWare,
  createPlayerSpec,
  droneCpuUsed,
  droneLoadM3,
  effectiveCpu,
  fittedCpuUsed,
  fleetDefOf,
  RACK_LABELS,
  rackLabel,
  rackOf,
  sameKindCount,

  shipDisplayName,
  shipSlotsOf,
  stackingOf,
  stackWeight,
} from '@whale/core'
import { Panel } from '@whale/ui'
import { combatBadges, DmgChip, DMG_LABEL, InfoTable, moduleShortEffect, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import { Glyph, toneOf } from '../ui/Glyphs'
import { ShipSprite } from '../ui/ShipSprite'
import type { PageProps } from './common'


/** 装配台主表的战斗基础行（由"装后合成"行取代，避免基础/合成重复；火力加成例外——船长
 * 2026-09-05：不入血量徽章组，作为下方属性行展示，故从过滤名单中放行） */
const COMBAT_BASE_KEYS = new Set([
  '护盾',
  '护盾抗性',
  '装甲',
  '装甲抗性',
  '结构',
  '结构抗性',
  '命中加成',
  '回避率',
])

/** 槽类可装家族简述（空位引导文案；V18.1 支援件：伤害/射速 = 低槽，命中/闪避 = 中槽） */
const RACK_FAMILIES: Record<RackSlot, string> = {
  high: '炮台 / 导弹架 / 激光炮 / 采集器 / 无人机装置',
  mid: '护盾增强・扩展 / 矢量推进器 / 索敌・陀螺（命中・闪避支援）',
  low: '装甲镀层・增厚板 / 货舱扩展 / 稳定器・射速计算机（伤害・射速支援）',
}

/** 数字千分位 */
const fmt = (n: number): string => n.toLocaleString('zh-CN')

/** 抗性三系恒显 chips（船长 2026-09-05：0 抗也列出——不做"缺行=0"的隐性省略） */
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

/** 换装对比段（装配浮层卡片底部；船长 2026-09-05：显示装后 DPS/属性是否有变化） */
interface FitSeg {
  /** 展示文本（如 "火力 +14%" / "盾 960→1032" / "CPU 剩 42→35"） */
  t: string
  /** 着色：up=绿（升）· down=红（降）· info=中性青（值变化）· none=灰（占位说明） */
  c: 'up' | 'down' | 'info' | 'none'
}

const HP_KEY_LABEL: Record<'s' | 'a' | 'h', string> = { s: '盾', a: '甲', h: '结构' }
const TYPE_SN: Record<string, string> = { kinetic: '动', explosive: '爆', plasma: '热' }

/** 名义火力（全命中、无距离衰减、弹药不断供）：Σ 各武器 单发/装填秒。
 * 仅供"同条件下换装相对比较"——战斗实际 DPS 还乘命中/距离衰减（基础舰炮恒在，剔除避免稀释）。 */
function rawDpsOf(spec: UnitSpec): number {
  let sum = 0
  for (const w of spec.weapons) {
    if (w.label === '基础舰炮') continue
    const per = w.kind === 'gun' ? Object.values(w.shotsByType ?? {})[0] ?? 0 : (w.shotDmg ?? 0)
    sum += per / Math.max(0.1, w.reloadMs / 1000)
  }
  return sum
}

/** 整机命中近似（口径：炮台命中率均值 × 开火失稳，再乘索敌乘子；beam 必中计 1）——
 * 供"命中 ≈ ±%"相对变化段（覆盖索敌阵列/失稳惩罚/换炮基础命中差） */
function meanHitMul(spec: UnitSpec): number | null {
  const ws = spec.weapons.filter((w) => w.kind === 'gun' || w.kind === 'beam')
  if (ws.length === 0) return null
  let s = 0
  for (const w of ws) s += w.kind === 'beam' ? 1 : (w.hitRate ?? 0.5) * (w.eqHitMul ?? 1)
  return (spec.hitMul ?? 1) * (s / ws.length)
}

/** 装后 − 装前 差异段；数值全部来自 createPlayerSpec 同源合成（与战斗引擎一致），只报真实变化 */
function diffSegs(cur: UnitSpec, next: UnitSpec, cpuCur: number, cpuNext: number, cpuTotal: number): FitSeg[] {
  const segs: FitSeg[] = []
  const add = (t: string, c: FitSeg['c']): void => {
    segs.push({ t, c })
  }
  const dir = (d: number): 'up' | 'down' => (d > 0 ? 'up' : 'down')
  // CPU 减法视角（船长 2026-09-05：显示剩余 CPU 的变化）
  const remCur = Math.max(0, cpuTotal - cpuCur)
  const remNext = Math.max(0, cpuTotal - cpuNext)
  if (remNext !== remCur) add(`CPU 剩 ${remCur}→${remNext}`, 'info')
  // 血量层（取变化最大的两层，避免长卡）
  const hpPairs: Array<{ lab: string; c: number; n: number }> = []
  for (const k of ['s', 'a', 'h'] as const) {
    const c = cur.hp[k]
    const n = next.hp[k]
    if (n !== c) hpPairs.push({ lab: HP_KEY_LABEL[k], c: Math.round(c), n: Math.round(n) })
  }
  hpPairs.sort((x, y) => Math.abs(y.n - y.c) - Math.abs(x.n - x.c))
  for (const p of hpPairs.slice(0, 2)) add(`${p.lab} ${fmt(p.c)}→${fmt(p.n)}`, dir(p.n - p.c))
  // 抗性（盾/甲两层 × 三系；取百分点变化最大的两条）
  const resDiffs: Array<{ t: string; c: number; n: number }> = []
  for (const layer of ['shield', 'armor'] as const) {
    const cb = cur.resists[layer] ?? {}
    const nb = next.resists[layer] ?? {}
    for (const ty of ['kinetic', 'explosive', 'plasma'] as const) {
      const cpp = Math.round((cb[ty] ?? 0) * 100)
      const npp = Math.round((nb[ty] ?? 0) * 100)
      if (npp !== cpp) resDiffs.push({ t: `${layer === 'shield' ? '盾' : '甲'}·${TYPE_SN[ty]}抗`, c: cpp, n: npp })
    }
  }
  resDiffs.sort((a, b) => Math.abs(b.n - b.c) - Math.abs(a.n - a.c))
  for (const d of resDiffs.slice(0, 2)) add(`${d.t} ${d.c}→${d.n}%`, dir(d.n - d.c))
  // 回避 / 机动速度
  const epp = Math.round((next.evasion - cur.evasion) * 100)
  if (epp !== 0) add(`回避 ${Math.round(cur.evasion * 100)}→${Math.round(next.evasion * 100)}%`, dir(epp))
  const spd = Math.round(next.speedMps - cur.speedMps)
  if (spd !== 0) add(`速度 ${Math.round(cur.speedMps)}→${Math.round(next.speedMps)}`, dir(spd))
  // 火力（名义口径见 rawDpsOf 注释；数值直接给，不带 ≈ 前缀）
  const cd = rawDpsOf(cur)
  const nd = rawDpsOf(next)
  if (cd <= 0 && nd > 0) add('火力 新增', 'up')
  else if (nd <= 0 && cd > 0) add('火力 归零', 'down')
  else if (cd > 0 && nd > 0) {
    const pct = (nd / cd - 1) * 100
    if (Math.abs(pct) >= 0.5) {
      // 绝对值格式化（船长 2026-09-05：避免负值自带符号与前缀符号叠成双负号）
      const absPct = Math.abs(pct)
      const show = absPct >= 10 ? String(Math.round(absPct)) : absPct.toFixed(1)
      add(`火力 ${pct > 0 ? '+' : '−'}${show}%`, pct > 0 ? 'up' : 'down')
    }
  }
  // 命中近似（整机相对变化；口径见 meanHitMul）
  const ch = meanHitMul(cur)
  const nh = meanHitMul(next)
  if (ch !== null && nh !== null && ch > 0) {
    const hp = (nh / ch - 1) * 100
    if (Math.abs(hp) >= 2) {
      // 同上：绝对值格式化，符号只由前缀给一次
      const absHp = Math.abs(hp)
      const show = absHp >= 10 ? String(Math.round(absHp)) : absHp.toFixed(1)
      add(`命中 ${hp > 0 ? '+' : '−'}${show}%`, hp > 0 ? 'up' : 'down')
    }
  }
  return segs
}

/** 武器判定：炮台/导弹架/激光炮（弹种 chip 显示攻击类型，色 = 伤害类型 ↔ 血量层色） */
const WEAPON_SLOTS = new Set<ModuleSlot>(['turret', 'missile', 'laser'])

/** 武器弹药 chip（船长 2026-09-05：换装卡须明示弹药攻击类型） */
function ammoChipOf(m: ModuleDef): ReactNode | null {
  if (m.slot === 'turret') {
    const t = m.damageType ?? 'kinetic'
    return <DmgChip t={t} label={`${DMG_LABEL[t]}弹`} />
  }
  if (m.slot === 'missile') return <DmgChip t="explosive" label="爆破导弹" />
  if (m.slot === 'laser') return <DmgChip t="plasma" label="能量弹药" />
  return null
}

/** 射程短文本（换装卡武器行用；min=0 省略近端） */
function rangeShort(m: ModuleDef): string {
  const max = m.maxRangeM
  if (max === undefined) return '—'
  const hi = max >= 1000 ? `${(max / 1000).toFixed(max % 1000 === 0 ? 0 : 1)} km` : `${max} m`
  const lo = m.minRangeM && m.minRangeM > 0 ? m.minRangeM : 0
  if (lo === 0) return hi
  const loS = lo >= 1000 ? `${(lo / 1000).toFixed(lo % 1000 === 0 ? 0 : 1)} km` : `${lo} m`
  return `${loS} ~ ${hi}`
}

/** CPU 剩余条（槽位区顶部；装配+放飞共用静态池，超上限拒绝装配；减法显示剩余——船长 2026-09-05） */
function CpuStrip({ used, total }: { used: number; total: number }): ReactNode {
  const rem = Math.max(0, total - used)
  const remPct = total > 0 ? Math.min(100, (rem / total) * 100) : 0
  // 醒目分级：剩余充足青绿 → ≤15% 琥珀告警 → 0 危险红
  const cls = rem <= 0 ? 'is-full' : remPct <= 15 ? 'is-warn' : 'is-ok'
  return (
    <div
      className={`app-fit-cpustrip ${cls}`}
      title="档位基础：低级 5 / 中级 15 / 高级 40 CPU（炮台更高）；剩余 = 船体上限 − 已装占用，与无人机放飞共用"
    >
      <span className="app-fit-cpustrip-label">CPU 剩余</span>
      <span className="app-fit-cpustrip-num">
        {rem} / {total}
      </span>
      <span className="app-fit-cpustrip-pct">{Math.round(remPct)}%</span>
      <span className={`app-fit-cpustrip-track ${cls}`} role="progressbar" aria-valuenow={Math.round(remPct)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${remPct}%` }} />
      </span>
    </div>
  )
}

export function FitPage({ engine, onToast, fitShipId = null }: PageProps & { fitShipId?: string | null }) {
  const state = engine.state
  // 装配目标船（船长 2026-09-05：入口在舰船页舰队卡片——onGotoFit 带入目标船；直接进入默认当前驾驶船）
  const piloted = state.shipId
  const [targetId] = useState<string>(fitShipId && state.fleet[fitShipId] ? fitShipId : piloted)
  const effectiveTarget = state.fleet[targetId] ? targetId : piloted
  const isPiloted = effectiveTarget === piloted
  const shipDef = fleetDefOf(state, engine.ctx, effectiveTarget)
  const shipName = shipDisplayName(state, engine.ctx, effectiveTarget)
  const fitted = state.fleet[effectiveTarget]?.fitted
  const slots = shipDef ? shipSlotsOf(shipDef) : { high: 1, mid: 1, low: 1 }
  // 装后合成（与战斗引擎同源：血量含容量件、抗性含乘入缺口、速度含加力曲线、回避含陀螺缺口）
  const spec = shipDef ? createPlayerSpec(state, engine.ctx, effectiveTarget) : null
  // V18.1 索敌阵列（命中件）：炮台命中乘子（收敛后；条目层）
  const gunEq = spec?.weapons.find((w) => w.kind === 'gun')?.eqHitMul

  const bayModules: ModuleDef[] = engine.modules.filter((m) => countModule(state, m.id) > 0)
  // CPU 占用（全位合计 + 无人机舱清单预占——2026-09-08 无人机舱大改：装入即占预算）
  const droneLoadOf = state.fleet[effectiveTarget]?.droneLoad
  const cpuUsed = fitted ? fittedCpuUsed(fitted, engine.ctx) + droneCpuUsed(droneLoadOf, engine.ctx) : 0
  // 装配台左右分栏（船长 2026-09-05）：左=船参数，右=装备按槽位图标；装备库列表移到物品页，不再在此显示。

  // ── 舰船形象区自适应（船长 2026-09-09：窗口缩窄优先缩小舰影，图缩到下限仍不够才隐藏间接列；
  //    实测容器宽度分档，避免间接文字被图形顶出窗口） ──
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageFit, setStageFit] = useState({ art: 280, indirect: true })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => {
      // stage 有 padding+border：内容可用宽 = clientWidth − 左右装饰
      const avail = el.clientWidth - 22
      const INDIRECT_MIN = 250 // 间接列表可读最小宽（11px 行 + 折行余量）
      const GAP = 12
      const MIN_ART = 190 // 舰影可读下限（再小就藏间接、图占主位）
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
    if (engine.unfitAtAt(rack, index, effectiveTarget)) onToast('装备已卸下并放回装备库。')
  }

  // ── 槽位换装浮层（船长 2026-09-05：点槽位 → 浮层选装；覆盖左侧舰船属性） ──
  const [pickBay, setPickBay] = useState<{ rack: RackSlot; index: number } | null>(null)
  // 换装对比段缓存（每候选一段；打开浮层时按当前装配/库存试算一次）
  const [pickDiffs, setPickDiffs] = useState<Map<string, FitSeg[]> | null>(null)
  function candidatesOf(rack: RackSlot): ModuleDef[] {
    return bayModules.filter((m) => rackOf(m) === rack)
  }
  /** 试算"该位卸旧件→装候选"后的同源合成快照（只读模拟：浅拷贝 fitted 链，不触碰真实状态） */
  function tryFitSpec(
    m: ModuleDef,
    rack: RackSlot,
    index: number,
  ): { cur: UnitSpec; next: UnitSpec | null; cpuNext: number } | null {
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
      // 2026-09-08：换装对比 CPU 口径同含无人机舱清单占用（清单不变，只反映装配变化）
      cpuNext: fittedCpuUsed(simFitted, engine.ctx) + droneCpuUsed(fleet.droneLoad, engine.ctx),
    }
  }
  function openPick(rack: RackSlot, index: number): void {
    setPickBay({ rack, index })
    const cpuTotal = shipDef ? effectiveCpu(state, engine.ctx, shipDef) : 0
    const segs = new Map<string, FitSeg[]>()
    for (const m of candidatesOf(rack)) {
      const oldId = fitted?.[rack]?.[index] ?? null
      if (oldId === m.id) {
        segs.set(m.id, [])
        continue // 同件重装无对比意义
      }
      const r = tryFitSpec(m, rack, index)
      segs.set(m.id, r && r.next ? diffSegs(r.cur, r.next, cpuUsed, r.cpuNext, cpuTotal) : [])
    }
    setPickDiffs(segs)
  }
  function pickModule(m: ModuleDef): void {
    if (!pickBay) return
    const { rack, index } = pickBay
    // 该位已装 → 先卸下旧件（放回装备库），再装入所选件
    if ((fitted?.[rack]?.[index] ?? null) !== null) engine.unfitAtAt(rack, index, effectiveTarget)
    const r = engine.fitModuleTo(m.id, rack, index, effectiveTarget)
    if (!r.ok) onToast(r.error ?? '装配失败', true)
    else onToast(`${m.name} 已装入${rackLabel(rack)}第 ${index + 1} 位。`)
    setPickBay(null)
  }

  /** 空位候选下拉文案：V18.1 收敛件标注"第 N 件衰减"（避免玩家误以为全效线性叠加） */
  function fitOptionLabel(m: ModuleDef): string {
    const base = `${m.name}（×${countModule(state, m.id)} · ${moduleShortEffect(m)}）`
    if (!fitted) return base
    const st = stackingOf(m)
    if (st.group === 'flat') return base
    const n = sameKindCount(fitted, engine.ctx, m)
    if (n === 0) return base
    if (st.group === 'curve') {
      return `${base} ← 同类第 ${n + 1} 件：按 ${Math.round(stackWeight(n + 1) * 100)}% 生效`
    }
    return `${base} ← 同类第 ${n + 1} 件：只削剩余缺口（收益递减）`
  }

  // 无人机舱总量（船体 + 已装「甲板扩展」= 清单容量上限；装入入口在低槽组下方无人机舱区——
  // 2026-09-08 无人机舱大改：只放飞已装入清单，仓库余量不自动出战）
  const droneBayTotal =
    (shipDef?.droneBayM3 ?? 0) +
    (fitted
      ? Object.values(fitted)
          .flat()
          .reduce(
            (s, id) => (typeof id === 'string' && id.length > 0 ? s + (engine.ctx.modules.get(id)?.droneBayBonusM3 ?? 0) : s),
            0,
          )
      : 0)

  return (
    <div className="page-stack page-fill">
      <Panel className="is-fill" title="装配台" right={<span className="app-dim">装备随船 · 进入其它船的装配台请在「舰船」页点卡片「⚒ 装配」</span>}>
        {/* 装配目标（船长 2026-09-05：醒目左置；入口在舰船页卡片，本页不再切换目标） */}
        <div className="app-fit-target">
          <span className="app-fit-target-label">
            装配目标
            {isPiloted ? <em className="app-belt-flag is-run">当前舰船</em> : <em className="app-belt-flag">非驾驶船</em>}
          </span>
          <span className="app-fit-target-ship">{shipName}</span>
          <span className="app-dim app-fit-target-hint">
            {isPiloted
              ? '当前驾驶船 · 装备随船'
              : '来自「舰船」页卡片 · 此船不在驾驶（装配不影响驾驶状态）'}
          </span>
        </div>
        <div className="app-fit-cols">
          <div className="app-fit-col-left">
        {shipDef ? (
          <>
            {/* 舰船形象 + 间接属性（船长 2026-09-09：左栏顶部插入独立舰影，间接属性移其右侧；
                窄窗优先缩小舰影，图缩至下限仍不够时隐藏间接列——高度守恒：原底部间接块整体上移占位） */}
            <div className="app-fit-stage" ref={stageRef}>
              <div className="app-fit-stage-art">
                <ShipSprite shipId={shipDef.id} role={shipDef.role} size={stageFit.art} engine={false} />
              </div>
              {stageFit.indirect && shipIndirectLines(shipDef).length > 0 ? (
                <div className="app-fit-indirect">
                  <div className="app-info-note app-fit-indirect-note">间接属性</div>
                  <InfoTable lines={shipIndirectLines(shipDef)} />
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
                    ? { hp: { s: Math.round(spec.hp.s), a: Math.round(spec.hp.a), h: Math.round(spec.hp.h) }, resists: spec.resists }
                    : undefined,
                )}
              </span>
            </span>
            <InfoTable
              lines={[
                ...shipInfoLines(shipDef).filter(
                  (l) =>
                    l.k !== '槽位' &&
                    l.k !== '采集性能' &&
                    l.k !== '货舱容量' &&
                    l.k !== 'CPU' && // 上限已由右栏「CPU 剩余」条显示（含技能加成），表格不重复
                    !COMBAT_BASE_KEYS.has(l.k),
                ),
                // 无人机舱（上限 = 船体 + 甲板扩展；战斗只放飞下方「无人机舱」清单——2026-09-08 大改）
                ...(droneBayTotal > 0
                  ? [{ k: '无人机舱（含甲板扩展）', v: `${droneBayTotal} m³ · 战斗只放飞下方清单中已装入的无人机` }]
                  : []),
                // 装后合成预览（V18.1：收敛件多装最终值；血量由顶部徽章承担不重复列出——与最上方徽章同源）
                ...(spec
                  ? [
                      { k: '护盾抗性（含装备）', v: resChipsAll(spec.resists.shield) },
                      { k: '装甲抗性（含装备）', v: resChipsAll(spec.resists.armor) },
                      { k: '结构抗性', v: resChipsAll(spec.resists.hull) },
                      { k: '回避率（含装备）', v: `${Math.round(spec.evasion * 100)}%` },
                      {
                        k: '开火命中修正（含装备）',
                        v: `推进失稳 ×${(spec.hitMul ?? 1).toFixed(2)}${
                          gunEq !== undefined ? ` · 索敌 ×${gunEq.toFixed(2)}` : ''
                        }`,
                      },
                      { k: '机动速度（含加力）', v: `${fmt(Math.round(spec.speedMps))} m/s` },
                    ]
                  : []),
              ]}
              note={`槽位布局：${slots.high} 高 / ${slots.mid} 中 / ${slots.low} 低（复数安装）；抗性按 EVE 式乘入合成（上限 90%）；多装与「动力」细则见手册速览「装配」。`}
            />
          </div>
          </>
        ) : null}
          </div>
          <div className="app-fit-col-right">
        {/* CPU 剩余条（船长 2026-09-05：由左栏移置槽位最上方、减法显示剩余；与放飞共用池） */}
        {shipDef ? (
          <CpuStrip used={cpuUsed} total={effectiveCpu(state, engine.ctx, shipDef)} />
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
                  {RACK_LABELS[rack]} <span className="app-dim">（{RACK_FAMILIES[rack]}）</span>
                  <span className="app-dim">　{filledCount}/{total} 已占</span>
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
                        onClick={() => openPick(rack, i)}
                        title={`第 ${i + 1} 位（空）——点击选择装备`}
                      >
                        <span className="app-fit-slot-icon-glyph">＋</span>
                        <span className="app-fit-slot-icon-name">装入</span>
                      </button>
                    )
                  }
                  const tone = toneOf(fittedDef.slot)
                  return (
                    <button
                      key={`${rack}-${i}`}
                      className="app-fit-slot-icon is-filled"
                      onClick={() => openPick(rack, i)}
                      title={`${fittedDef.name} · ${moduleShortEffect(fittedDef)} · 第${i + 1}位（点击更换）`}
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
                        卸下
                      </span>
                    </button>
                  )
                })}
                </div>
              </div>
            )
          })}
          {/* 弹药档位（2026-09-09 弹药 MK2：有武器弹族才显示；无人机舱上方） */}
          <AmmoTierSection engine={engine} onToast={onToast} target={effectiveTarget} />
          {/* 无人机舱（2026-09-08 大改：低槽组下方；容量条 + 型卡流 + 装入弹层） */}
          <DroneBaySection engine={engine} onToast={onToast} target={effectiveTarget} />
        </div>
          </div>
        </div>
      </Panel>

      {/* 槽位换装浮层：覆盖左侧舰船属性（船长 2026-09-05） */}
      {pickBay ? (
        <div className="app-fit-overlay" onClick={() => setPickBay(null)}>
          <div className="app-fit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>
                {RACK_LABELS[pickBay.rack]} · 第 {pickBay.index + 1} 位
                {fitted?.[pickBay.rack]?.[pickBay.index] ? '（更换）' : '（装入）'}
              </span>
              <button className="app-btn is-small" onClick={() => setPickBay(null)}>
                关闭
              </button>
            </div>
            <div className="app-dim app-note">
              以下为该槽位可安装的全部装备（装备库库存）；点击即装入/更换（旧件自动卸回装备库）。卡片下方绿/红段为装后与当前
              对比：火力按名义值估算（全命中、不计距离衰减）；同类多装同样计入 CPU 校验。
            </div>
            <div className="app-fit-pickgrid">
              {candidatesOf(pickBay.rack).map((m) => {
                const segs = pickDiffs?.get(m.id)
                const sameAsOld = (fitted?.[pickBay.rack]?.[pickBay.index] ?? null) === m.id
                return (
                  <button
                    key={m.id}
                    className="app-fit-pick-item"
                    title={fitOptionLabel(m)}
                    onClick={() => pickModule(m)}
                    disabled={sameAsOld}
                  >
                    {/* 图标与名称同行（船长 2026-09-05：图标不再单独占一行） */}
                    <span className="app-fit-pick-head">
                      <span className="app-fit-pick-icon">
                        <Glyph name={m.slot} size={20} color={toneOf(m.slot)} />
                      </span>
                      <span className="app-fit-pick-name">{m.name}</span>
                    </span>
                    {/* 说明行：武器 = 弹药类型 chip（攻击类型醒目）+ 射程；其余 = 效果短述 */}
                    <span className="app-fit-pick-sub">
                      {WEAPON_SLOTS.has(m.slot) ? (
                        <>
                          {ammoChipOf(m)}
                          <span className="app-fit-pick-subtext">
                            ×{countModule(state, m.id)} · 射程 {rangeShort(m)}
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
                        <span className="dseg is-none">已装在此位</span>
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
                        <span className="dseg is-none">装后：战斗无差异</span>
                      </span>
                    )}
                  </button>
                )
              })}
              {candidatesOf(pickBay.rack).length === 0 ? (
                <div className="app-dim app-inv-empty">
                  装备库没有适配此槽位的装备——市场购买或在「工业」页制造后，回来点击槽位装入。
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ═══════════════ 弹药档位（2026-09-09 弹药 MK2：出战前选档——装配页按弹族选基础弹/MK2；
开战预载按所选档消耗（库存不足整族回退基础弹 + 日志）；连打/离线同源。未设 = 基础弹） ═══════════════ */

const AMMO_SLOT_TYPES: Array<{ slot: 'turret' | 'missile' | 'laser'; type: DamageType }> = [
  { slot: 'turret', type: 'kinetic' },
  { slot: 'missile', type: 'explosive' },
  { slot: 'laser', type: 'plasma' },
]

/** 弹药档位区：只显示装了对应武器（炮台/导弹架/激光炮）的弹族 */
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
  const ctx = engine.ctx
  const ship = state.fleet[target]
  const highIds = new Set((ship?.fitted?.high ?? []).filter((id): id is string => typeof id === 'string'))
  const rows = AMMO_SLOT_TYPES.map(({ slot, type }) => {
    const hasWeapon = [...highIds].some((id) => ctx.modules.get(id)?.slot === slot)
    if (!hasWeapon) return null
    const mk2 = ctx.items.get(`ammo-${type}-2`)
    const baseName = ctx.items.get(`ammo-${type}-l`)?.name ?? DMG_LABEL[type]
    if (!mk2) return null
    const pref = ship?.ammoPref?.[type]
    const onMk2 = pref === mk2.id
    const haveMk2 = countWare(state, mk2.id)
    return (
      <div key={type} className="app-fit-ammotier-row">
        <DmgChip t={type} label={baseName} />
        <span className="app-fit-ammotier-opts">
          <button
            className={`app-fit-ammotier-opt${!onMk2 ? ' is-active' : ''}`}
            onClick={() => {
              const r = engine.setAmmoTierAt(type, null, target)
              if (!r.ok) onToast(r.error ?? '设置失败', true)
            }}
            title={`${baseName}：本船${baseName}档（未设 = 基础弹）`}
          >
            {baseName}
          </button>
          <button
            className={`app-fit-ammotier-opt${onMk2 ? ' is-active' : ''}`}
            onClick={() => {
              const r = engine.setAmmoTierAt(type, mk2.id, target)
              if (!r.ok) onToast(r.error ?? '设置失败', true)
            }}
            title={`${mk2.name}：单发更高（${mk2.dmg ?? '?'} vs ${ctx.items.get(`ammo-${type}-l`)?.dmg ?? '?'}）；开战按档预载，库存不足整族回退${baseName}。仓库 ×${haveMk2}`}
          >
            {mk2.name}
          </button>
        </span>
        <span className="app-dim">
          {haveMk2 > 0 ? `仓库 ×${fmt(haveMk2)}` : `${mk2.name}无库存（将回退${baseName}）`}
        </span>
      </div>
    )
  }).filter((x): x is NonNullable<typeof x> => x !== null)
  if (rows.length === 0) return null
  return (
    <div className="app-fit-ammotier">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">弹药档位</span>
        <span className="app-dim">（出发预载按所选档消耗；连打同源）</span>
      </div>
      {rows}
    </div>
  )
}

/* ═══════════════ 无人机舱（2026-09-08 无人机舱大改：低槽下方；容量条 + 一型一卡 ×N + 全部卸下 + 装入弹层） ═══════════════ */

/** 无人机舱区：只放飞已装入清单；装入/卸下经 adjustDroneLoadAt（舱容 + CPU 预占校验） */
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
  // 舱上限 = 船体 droneBayM3 + 已装甲板扩展（rack 高槽件）
  let cap = shipDef?.droneBayM3 ?? 0
  if (fitted) {
    for (const id of allFittedIds(fitted)) {
      cap += ctx.modules.get(id)?.droneBayBonusM3 ?? 0
    }
  }
  if (cap <= 0 && Object.keys(load).length === 0) return null // 无舱不显示（与机舱平衡表一致）
  const droneTypes = [...ctx.items.values()].filter((d) => d.kind === 'drone')
  const usedM3 = droneLoadM3(load, ctx)
  const droneCpu = droneCpuUsed(load, ctx)
  const pct = cap > 0 ? Math.min(100, (usedM3 / cap) * 100) : 0
  const [open, setOpen] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  const [selN, setSelN] = useState(1)
  const fittedCpu = fitted ? fittedCpuUsed(fitted, ctx) : 0
  const cpuTotal = shipDef ? effectiveCpu(state, ctx, shipDef) : 0
  const cpuLeft = Math.max(0, cpuTotal - fittedCpu - droneCpu)

  function adj(id: string, delta: number): void {
    const r = engine.adjustDroneLoadAt(id, delta, target)
    if (!r.ok) onToast(r.error ?? '操作失败', true)
  }
  function clearAll(): void {
    for (const [id, n] of Object.entries(load)) adj(id, -n)
  }
  /** 某型还能装几架（仓库 × 舱余 × CPU 余 的最小值） */
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

  return (
    <div className="app-fit-dronebay">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">
          无人机舱
          {droneCpu > 0 ? (
            <span className="app-dim">（清单占用 CPU {droneCpu}）</span>
          ) : null}
        </span>
        {cells.length > 0 ? (
          <button className="app-btn is-small is-warn" onClick={clearAll} title="把舱内全部无人机退回仓库">
            全部卸下
          </button>
        ) : null}
      </div>
      {/* 容量条（参考 CPU 条视觉；m³ 口径） */}
      <div className="app-fit-dronecap" title={`无人机舱容量：已装 ${Math.round(usedM3 * 10) / 10} / ${cap} m³（船体 + 甲板扩展）；清单 CPU 占用 ${droneCpu}（计入预算）`}>
        <span className="app-fit-dronecap-label">机舱</span>
        <span className="app-fit-dronecap-num">
          {Math.round(usedM3 * 10) / 10}/{cap} m³
        </span>
        <span className="app-fit-dronecap-track">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="app-dim">
          {cells.reduce((s, c) => s + c.n, 0)} 架 · CPU {droneCpu}
        </span>
      </div>
      {/* 型卡流：一型一卡 ×N（+ / − 微调）；空态只有「装入」 */}
      <div className="app-fit-dronebay-cells">
        {cells.map(({ id, n, def }) => (
          <div key={id} className="app-fit-drone-cell" title={`${def?.name ?? id}：无人机舱清单（战斗只放飞已装入的；仓库中其余无人机不出战）`}>
            {def ? (
              <span className="app-fit-drone-cell-glyph">
                <Glyph name="drone" size={16} color={toneOf('drone')} />
              </span>
            ) : null}
            <span className="app-fit-drone-cell-name">{def?.name ?? id} ×{n}</span>
            <button className="app-fit-drone-step" title="卸下一架（退回仓库）" onClick={() => adj(id, -1)}>
              −
            </button>
            <button className="app-fit-drone-step" title="再装一架（从仓库）" onClick={() => adj(id, 1)}>
              +
            </button>
          </div>
        ))}
        <button
          className="app-fit-drone-add"
          onClick={() => {
            setSelId(droneTypes.find((d) => maxOf(d.id) > 0)?.id ?? null)
            setSelN(1)
            setOpen(true)
          }}
          title="从仓库选择机型与数量装入无人机舱"
        >
          ＋ 装入
        </button>
      </div>

      {/* 装入弹层：选型 + 数量（钳到 仓库/舱容/CPU 余量） */}
      {open ? (
        <div className="app-fit-overlay" onClick={() => setOpen(false)}>
          <div className="app-fit-modal app-fit-drone-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>装入无人机（无人机舱 {Math.round(usedM3 * 10) / 10}/{cap} m³ · 余 CPU {cpuLeft}）</span>
              <button className="app-btn is-small" onClick={() => setOpen(false)}>
                关闭
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
                    title={`${d.description}（单架 ${d.unitM3} m³ · CPU ${d.cpuUse}；仓库 ×${have}）`}
                  >
                    <Glyph name="drone" size={18} color={toneOf('drone')} />
                    <span className="app-fit-drone-pick-name">{d.name}</span>
                    <span className="app-dim">
                      {m <= 0 ? '无法装入' : `仓库 ×${have} · 可装 ${m}`}
                    </span>
                  </button>
                )
              })}
            </div>
            {selId ? (
              <div className="app-fit-drone-qty">
                <span>数量：</span>
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
                  disabled={maxOf(selId) <= 0}
                  onClick={() => {
                    const want = Math.min(selN, maxOf(selId))
                    adj(selId, want)
                    setOpen(false)
                  }}
                >
                  装入 ×{Math.min(selN, Math.max(1, maxOf(selId)))}
                </button>
              </div>
            ) : (
              <div className="app-dim app-fit-drone-empty">仓库没有可装入的无人机（蜂鸟/赤鸢等可在市场购买）。</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
