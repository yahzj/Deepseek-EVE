/**
 * 敌方混伤副作用复核工具（正式入库，2026-09-10 船长交办「战斗复核」）。
 *
 * 只回答一个问题：**混伤上线后玩家承伤涨了多少、堆单系抗的收益掉了多少**，
 * 以及两个副系份额旋钮（常驻 8:2→9:1、窝点 6:4→7:3）各能回收多少。
 * 结果与结论见 `docs/design/mixed-damage-review-20260910.md`。
 *
 * 三段：
 *  A. **解析式**（零取样噪声）：逐卡算「击穿玩家所需敌总输出」（TTK 代理，逐发真实结算、
 *     含盾→甲→结构层迁移），对比 纯主系 / 9:1 / 8:2 / 7:3 / 6:4 的**承伤倍数**；
 *     并量化「对该卡主系硬化」的收益被削掉多少（护盾/装甲抗性件是**纯抗性**、不加容量，
 *     故"无抗件 / 硬化主系 / 硬化副系"三者血量完全相同——差异 100% 来自抗性取向）。
 *  B. **实战复核**（真实模拟）：纯主系 / 9:1 / 8:2 三臂**同种子**对照 胜率·时长·残血。
 *  C. **份额灵敏度标价**：7:3 与 6:4（与 A 同口径，只换份额；窝点真实战斗含威胁倍率与波次，不在本工具内）。
 *  D. **P1 复调轮口径复跑**（2026-09-10 船长「重跑 P1 口径」）：复刻 `power-ladder-rework.md` §五
 *     定稿表的行与列，按今日口径重跑 + 纯主系对照列，用于把下滑**归因**到混伤或更早的漂移。
 *
 * 口径保证：各臂的**敌总伤、武器形态、命中、近盲、距离衰减完全一致**（只改伤害构成），
 * 故承伤差异 100% 来自"各系各吃各的层抗与层位克制"——这正是要复核的副作用。
 * 自检：A 段开头会校验"纯系口径与旧路径 `applyDamage` 逐字等价"，不通过即为口径坏了。
 *
 * 用法：`npm run battle:mixed-review`（或 `npx tsx tools/mixed-damage-review.ts`）
 * 输出：stdout，并镜像一份到 `docs/design/battle-data/mixed-damage-review-20260910.txt`
 */
import type { AnomalyDef, DamageType, Hp3, UnitSpec, WeaponSpec } from '@whale/core'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  addShipToFleet,
  applyFoeShot,
  createInitialState,
  createPlayerSpec,
  foeDamageComposition,
  foeMainDamageType,
  LAIR_SUB_DMG_SHARE,
  repairDeprecatedModules,
  subDamageTypeOf,
  type GameState,
  type SimContext,
} from '@whale/core'
import { ANOMALIES, SHIPS, buildSimContext } from '@whale/data'
import { advanceBattleFor, applyDamage, createFoeSpecs, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const ctx = buildSimContext()
const bal = ctx.balance.battle

/* ═══════════ 通用：火力构成与"击穿所需敌总输出" ═══════════ */

type MixSpec = { main: DamageType; sub: DamageType; subShare: number }

/** 份额 → shotsByType（subShare = 0 即纯主系；纯系返回 undefined，与旧行为一字不差） */
function shotsOf(mix: MixSpec): Partial<Record<DamageType, number>> | undefined {
  if (mix.subShare <= 0) return undefined
  return {
    [mix.main]: Math.round((1 - mix.subShare) * 10),
    [mix.sub]: Math.round(mix.subShare * 10),
  } as Partial<Record<DamageType, number>>
}

/**
 * 击穿玩家所需**敌总输出**（TTK 代理）：反复按真实单发结算直到三层耗尽，累计原始伤害。
 * 越大 = 越耐打。纯系口径 ÷ 混伤口径 = 「承伤倍数」（> 1 = 混伤更疼）。
 */
function rawToKill(
  hp0: Hp3,
  resists: UnitSpec['resists'],
  weaponBase: WeaponSpec,
  mix: MixSpec,
  rawShot: number,
): number {
  const shots = shotsOf(mix)
  const weapon: WeaponSpec = shots ? { ...weaponBase, shotsByType: shots } : { ...weaponBase, shotsByType: undefined }
  let hp: Hp3 = { ...hp0 }
  let raw = 0
  for (let i = 0; i < 20000; i++) {
    if (hp.s <= 0 && hp.a <= 0 && hp.h <= 0) return raw
    hp = applyFoeShot(hp, resists, weapon, rawShot, mix.main)
    raw += rawShot
  }
  return raw // 打不穿（极端免疫）——回报上限，正文按"不可击穿"处理
}

/* ═══════════ 装配行（与 battle-calibrate 同源；`@@` = 该卡主系抗性件、`##` = 副系抗性件） ═══════════ */
type Loadout = { name: string; ship: string; high: string[]; mid?: string[]; low?: string[]; drones?: Record<string, number> }

const S2_HIGH = ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2']
const S4_HIGH = ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3']

const L_NAKED: Loadout = { name: '裸船(基础舰炮)', ship: 'sh-falconet', high: [] }
const L_S1: Loadout = { name: 'S1 虎鲨4×MK2', ship: 'sh-tigershark', high: S2_HIGH, mid: ['mod-prop-1'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }
const L_S2: Loadout = { name: 'S2 灰鲭鲨4×MK2+支援', ship: 'sh-mako', high: S2_HIGH, mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }
const L_S4: Loadout = { name: 'S4 大白鲨5×MK3+支援', ship: 'sh-whiteshark', high: S4_HIGH, mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }
const L_T3H: Loadout = { name: 'T3 锤头鲨炮巡5×kin3+支援', ship: 'sh-hammerhead', high: S4_HIGH, mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'] }
const L_D3: Loadout = { name: 'D3 王鲭无人机重装', ship: 'sh-sentinel', high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'], drones: { 'drone-heavy': 4, 'drone-sentry': 6 } }

const L_NONE: Loadout = { name: 'S2 无抗件(对照)', ship: 'sh-mako', high: S2_HIGH, mid: ['mod-prop-2', 'mod-track-2'], low: ['mod-stab-kin-2'] }
const L_HARD_MAIN: Loadout = { name: 'S2 硬化主系', ship: 'sh-mako', high: S2_HIGH, mid: ['mod-prop-2', 'mod-shield-@@-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-@@-2'] }
const L_HARD_SUB: Loadout = { name: 'S2 硬化副系', ship: 'sh-mako', high: S2_HIGH, mid: ['mod-prop-2', 'mod-shield-##-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-##-2'] }

const ANCHORS = [L_NAKED, L_S1, L_S2, L_S4, L_T3H, L_D3]

const SUFFIX: Record<DamageType, string> = { kinetic: 'kin', explosive: 'exp', plasma: 'pla' }

/** 把 `@@`/`##` 占位替换为该卡的主系/副系抗性件 */
function fitFor(ld: Loadout, main: DamageType, sub: DamageType): Loadout {
  const sub1 = (arr?: string[]): string[] | undefined =>
    arr?.map((id) => id.replace('@@', SUFFIX[main]).replace('##', SUFFIX[sub]))
  return { ...ld, mid: sub1(ld.mid), low: sub1(ld.low) }
}

/* ═══════════ 技能档与状态构造（与 battle-calibrate 同源） ═══════════ */
const FULL_SKILLS: Record<string, number> = {
  gunnery: 5, 'kinetic-gunnery': 5, 'missile-launching': 5, 'laser-cannon': 5, 'fire-control': 5,
  'reload-drills': 5, 'drone-warfare': 5, 'drone-servicing': 5, 'ammunition-condensing': 5,
  'shield-operation': 5, 'energy-management': 5, 'hull-upgrades': 5, 'shield-tuning': 5,
  'armor-tuning': 5, 'armed-ops': 5, 'armored-ops': 5, 'vector-maneuvering': 5,
  'evasion-maneuvering': 5, 'targeting-integration': 5, 'ship-systems-engineering': 5,
}
const MID_SKILLS: Record<string, number> = Object.fromEntries(Object.keys(FULL_SKILLS).map((k) => [k, 3]))
const SKILL_TIERS: Array<{ name: string; skills: Record<string, number> }> = [
  { name: '无技能', skills: {} },
  { name: '中位(战斗系Lv3)', skills: MID_SKILLS },
  { name: '满战斗技能5', skills: FULL_SKILLS },
]

function makeState(shipId: string, ld: Loadout, skills: Record<string, number>, seed: number): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  addShipToFleet(state, shipId)
  state.shipId = shipId
  for (const [id, lv] of Object.entries(skills)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  const entry = state.fleet[shipId]!
  if (ld.drones && Object.keys(ld.drones).length > 0) entry.droneLoad = { ...ld.drones }
  entry.fitted = { high: [...(ld.high ?? [])], mid: [...(ld.mid ?? [])], low: [...(ld.low ?? [])] }
  repairDeprecatedModules(state, ctx as SimContext)
  return state
}

/** 玩家真实抗性/血量（固定 seed=1，与技能档同源） */
function playerSpec(ld: Loadout, skills: Record<string, number>, main: DamageType, sub: DamageType): UnitSpec | null {
  const state = makeState(ld.ship, fitFor(ld, main, sub), skills, 1)
  return createPlayerSpec(state, ctx as SimContext, ld.ship)
}

const cards = [...ANOMALIES].sort((a, b) => a.threat - b.threat)
const isPure = (a: AnomalyDef): boolean => foeDamageComposition(a).length <= 1
const PURE_CARDS = cards.filter(isPure)
const MIXED_CARDS = cards.filter((a) => !isPure(a))

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
const num2 = (v: number): string => v.toFixed(2)

/* ═══════════ A. 解析式承伤复核 ═══════════ */

type Acell = { pure: number; m91: number; m82: number; m73: number; m64: number }

function ttkCell(ld: Loadout, card: AnomalyDef, skills: Record<string, number>): Acell | null {
  const main = foeMainDamageType(card)
  const sub = subDamageTypeOf(card, main)
  const spec = playerSpec(ld, skills, main, sub)
  if (!spec) return null
  const w0 = createFoeSpecs(card, bal)[0]!.weapons[0]!
  const shot = w0.shotDmg
  const base = { main, sub }
  return {
    pure: rawToKill(spec.hp, spec.resists, w0, { ...base, subShare: 0 }, shot),
    m91: rawToKill(spec.hp, spec.resists, w0, { ...base, subShare: 0.1 }, shot),
    m82: rawToKill(spec.hp, spec.resists, w0, { ...base, subShare: 0.2 }, shot),
    m73: rawToKill(spec.hp, spec.resists, w0, { ...base, subShare: 0.3 }, shot),
    m64: rawToKill(spec.hp, spec.resists, w0, { ...base, subShare: LAIR_SUB_DMG_SHARE }, shot),
  }
}

function sectionA(): void {
  console.log('\n════════ A. 解析式承伤复核（基准 = 击穿玩家所需敌总输出）════════')
  console.log(`分母：纯主系口径的 TTK。倍数 = 纯主系 ÷ 该口径，> 1 表示"混伤更疼"（敌总伤不变，纯粹是绕抗）。`)
  console.log(`卡池：${MIXED_CARDS.length} 张混伤卡（教学/纯系卡 ${PURE_CARDS.length} 张作对照）`)

  /* 纯度对照：纯系口径必须与"旧路径"（直接 applyDamage）逐字等价（口径自检） */
  {
    const bad: string[] = []
    for (const tier of SKILL_TIERS) {
      for (const ld of ANCHORS) {
        for (const card of PURE_CARDS) {
          const main = foeMainDamageType(card)
          const sub = subDamageTypeOf(card, main)
          const spec = playerSpec(ld, tier.skills, main, sub)
          if (!spec) continue
          const w0 = createFoeSpecs(card, bal)[0]!.weapons[0]!
          const shot = w0.shotDmg
          // 参考实现：直接调 applyDamage（旧口径，无 shotsByType 分支）
          let hp: Hp3 = { ...spec.hp }
          let ref = 0
          for (let i = 0; i < 20000; i++) {
            if (hp.s <= 0 && hp.a <= 0 && hp.h <= 0) break
            hp = applyDamage(hp, spec.resists, shot, main).hp
            ref += shot
          }
          const mine = rawToKill(spec.hp, spec.resists, w0, { main, sub, subShare: 0 }, shot)
          if (mine !== ref) bad.push(`${ld.name}/${card.id}/${tier.name}`)
          // 纯系口径必须不产生 shotsByType（引擎走旧分支）
          if (shotsOf({ main, sub, subShare: 0 }) !== undefined) bad.push(`shotsOf非空:${card.id}`)
        }
      }
    }
    console.log(`① 口径自检：纯系口径须与旧路径（applyDamage）逐字等价、且不产生 shotsByType → ${bad.length === 0 ? '✅ 全部通过' : `❌ ${bad.length} 处异常：${bad.slice(0, 5).join(', ')}`}`)
    console.log(`   注：纯系卡（${PURE_CARDS.map((c) => c.name).join('/')}）本身不参与混伤；下面的"倍数"栏只统计 ${MIXED_CARDS.length} 张混伤卡`)
  }

  /* ② 各装配行 × 技能档的平均/最大承伤倍数 */
  console.log('\n② 各装配行的承伤倍数（25 张混伤卡平均 / 最大）')
  for (const tier of SKILL_TIERS) {
    console.log(`\n—— 技能档：${tier.name} ——`)
    console.log(`${'装配行'.padEnd(26)}${'9:1 均/最大'.padStart(20)}${'8:2 均/最大(当前)'.padStart(22)}${'7:3 均/最大(窝点候选)'.padStart(22)}${'6:4 均/最大(窝点当前)'.padStart(22)}`)
    for (const ld of ANCHORS) {
      const rs: Array<{ a91: number; a82: number; a73: number; a64: number }> = []
      for (const card of MIXED_CARDS) {
        const c = ttkCell(ld, card, tier.skills)
        if (!c) continue
        rs.push({ a91: c.pure / c.m91, a82: c.pure / c.m82, a73: c.pure / c.m73, a64: c.pure / c.m64 })
      }
      const avg = (f: (r: { a91: number; a82: number; a73: number; a64: number }) => number): number => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length)
      const max = (f: (r: { a91: number; a82: number; a73: number; a64: number }) => number): number => Math.max(...rs.map(f))
      console.log(
        `${ld.name.padEnd(26)}` +
          `${`${num2(avg((r) => r.a91))} / ${num2(max((r) => r.a91))}`.padStart(20)}` +
          `${`${num2(avg((r) => r.a82))} / ${num2(max((r) => r.a82))}`.padStart(22)}` +
          `${`${num2(avg((r) => r.a73))} / ${num2(max((r) => r.a73))}`.padStart(22)}` +
          `${`${num2(avg((r) => r.a64))} / ${num2(max((r) => r.a64))}`.padStart(22)}`,
      )
    }
  }

  /* ③ 副作用最重的卡（以顶配锚 S4 与中位锚 S2 各技能档取最大，列 8:2 倍数最高的 8 张） */
  console.log('\n③ 副作用最重的卡（8:2 倍数 Top 8，取 S4/满技能口径）')
  const ranked = MIXED_CARDS.map((card) => {
    const c = ttkCell(L_S4, card, FULL_SKILLS)!
    const main = foeMainDamageType(card)
    const sub = subDamageTypeOf(card, main)
    const spec = playerSpec(L_S4, FULL_SKILLS, main, sub)!
    return {
      card,
      main,
      sub,
      m82: c.pure / c.m82,
      m64: c.pure / c.m64,
      subResShield: spec.resists.shield?.[sub] ?? 0,
      mainResShield: spec.resists.shield?.[main] ?? 0,
    }
  }).sort((a, b) => b.m82 - a.m82)
  console.log(`${'威胁'.padStart(4)} ${'卡名'.padEnd(20)}${'主系'.padEnd(10)}${'副系'.padEnd(10)}${'8:2倍数'.padStart(9)}${'6:4倍数'.padStart(9)}  S4 盾抗(主/副)`)
  for (const r of ranked.slice(0, 8)) {
    console.log(
      `${String(r.card.threat).padStart(4)} ${r.card.name.padEnd(20)}${r.main.padEnd(10)}${r.sub.padEnd(10)}` +
        `${num2(r.m82).padStart(9)}${num2(r.m64).padStart(9)}  ${pct(r.mainResShield)} / ${pct(r.subResShield)}`,
    )
  }

  /* ④ 堆单系抗的收益（硬化件是纯抗性 → 三组血量相同，差异全来自抗性取向） */
  console.log('\n④ "堆单系抗"收益被削掉多少（S2 船体；硬化件 vs 无抗件的 TTK 提升%）')
  console.log('   （硬化主系 = 装该卡主系的护盾/装甲抗性件；硬化副系 = 装副系的）')
  for (const tier of SKILL_TIERS) {
    let gMainPure = 0, gMain82 = 0, gSub82 = 0, gMain64 = 0, gSub64 = 0, n = 0
    for (const card of MIXED_CARDS) {
      const main = foeMainDamageType(card)
      const sub = subDamageTypeOf(card, main)
      const cNone = ttkCell(L_NONE, card, tier.skills)!
      const cMain = ttkCell(L_HARD_MAIN, card, tier.skills)!
      const cSub = ttkCell(L_HARD_SUB, card, tier.skills)!
      gMainPure += cMain.pure / cNone.pure - 1
      gMain82 += cMain.m82 / cNone.m82 - 1
      gMain64 += cMain.m64 / cNone.m64 - 1
      gSub82 += cSub.m82 / cNone.m82 - 1
      gSub64 += cSub.m64 / cNone.m64 - 1
      n++
    }
    const d = (v: number): string => `${v >= 0 ? '+' : ''}${((v / n) * 100).toFixed(1)}%`
    console.log(
      `   ${tier.name.padEnd(16)} 硬化主系·纯系口径 ${d(gMainPure).padStart(7)} → 硬化主系·8:2 口径 ${d(gMain82).padStart(7)}` +
        `（窝点6:4 ${d(gMain64).padStart(7)}） · 硬化副系·8:2 口径 ${d(gSub82).padStart(7)}（窝点6:4 ${d(gSub64).padStart(7)}）`,
    )
  }
}

/* ═══════════ B. 实战复核（三臂同种子） ═══════════ */

const SEEDS = [1, 7, 13, 29, 51, 83, 101, 137, 199]

/** 构造该副系份额口径下的上下文（纯系卡不动；其余按份额重写 dmgMix，主系不变） */
function ctxWithShare(subShare: number): SimContext {
  const m = new Map<string, AnomalyDef>()
  for (const [id, a] of ctx.anomalies) {
    if (isPure(a)) {
      m.set(id, a)
      continue
    }
    const main = foeMainDamageType(a)
    const sub = subDamageTypeOf(a, main)
    const dmgMix: Partial<Record<DamageType, number>> =
      subShare <= 0
        ? { [main]: 1 }
        : { [main]: Math.round((1 - subShare) * 10), [sub]: Math.round(subShare * 10) }
    m.set(id, { ...a, dmgMix })
  }
  return { ...ctx, anomalies: m }
}

function simulate(state: GameState, c: SimContext, anomalyId: string): { win: boolean; durMs: number; meRemain: number; foeShots: number } {
  const battle = startBattleFor(state, c, state.shipId, anomalyId, 0)
  if (!battle) return { win: false, durMs: 0, meRemain: 0, foeShots: 0 }
  state.gameMs = c.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(c.anomalies.get(anomalyId), c.balance.battle)
  advanceBattleFor(state, c, battle, state.shipId, anomalyId)
  const durMs = Math.min(c.balance.battle.maxBattleMs, Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs))
  const u = battle.units['player']
  return { win: battle.ended === 'me', durMs, meRemain: u ? u.hp.s + u.hp.a + u.hp.h : 0, foeShots: battle.stats.foeShots }
}

function initHpOf(shipId: string): number {
  const def = SHIPS.find((s) => s.id === shipId)
  return def ? (def.shieldHp ?? 0) + (def.armorHp ?? 0) + (def.hullHp ?? 0) : 0
}

type Cell = { winPct: number; durS: number; remPct: number; foeShots: number }

function runCell(ld: Loadout, card: AnomalyDef, skills: Record<string, number>, c: SimContext): Cell {
  const initHp = initHpOf(ld.ship)
  let wins = 0, durSum = 0, ends = 0, remSum = 0, shotsSum = 0
  for (const seed of SEEDS) {
    const state = makeState(ld.ship, ld, skills, seed)
    const r = simulate(state, c, card.id)
    if (r.win) wins++
    if (r.durMs > 0) { durSum += r.durMs; ends++ }
    remSum += r.meRemain
    shotsSum += r.foeShots
  }
  return {
    winPct: Math.round((wins / SEEDS.length) * 100),
    durS: ends > 0 ? Math.round(durSum / ends / 1000) : 0,
    remPct: initHp > 0 ? Math.round((remSum / SEEDS.length / initHp) * 100) : 0,
    foeShots: Math.round(shotsSum / SEEDS.length),
  }
}

function sectionB(): void {
  console.log('\n════════ B. 实战复核（真实模拟：纯主系 / 9:1 / 8:2 三臂同种子）════════')
  console.log(`每格 = 胜率%｜时长s｜战后残血%；${SEEDS.length} 种子。装配行按"当前主系抗性件"装（§A④ 的取向另算）`)
  const arms = [
    { label: '纯主系(旧口径)', c: ctxWithShare(0) },
    { label: '9:1', c: ctxWithShare(0.1) },
    { label: '8:2(当前)', c: ctxWithShare(0.2) },
  ]
  /** 窝点候选口径 70:30 与当前口径 60:40——同一场战斗的第 4/5 个数，给"6:4→7:3"标价 */
  const arm73 = ctxWithShare(0.3)
  const lairArm = ctxWithShare(LAIR_SUB_DMG_SHARE)
  const s4Rows: Array<{ threat: number; name: string; rem0: number; rem8: number; delta: number }> = []
  const detail: Array<{ name: string; cells: Cell[] }> = []

  for (const ld of [L_S2, L_S4, L_T3H]) {
    for (const tier of [SKILL_TIERS[1]!, SKILL_TIERS[2]!]) {
      console.log(`\n—— ${ld.name} · ${tier.name} ——`)
      console.log(`${'威胁'.padStart(4)} ${'卡名'.padEnd(20)} ${arms.map((a) => a.label.padStart(18)).join(' ')}`)
      let rem0 = 0, rem9 = 0, rem8 = 0, rem73 = 0, rem64 = 0, n = 0
      const per: Cell[][] = arms.map(() => [])
      for (const card of cards) {
        const cs = arms.map((a) => runCell(ld, card, tier.skills, a.c))
        cs.forEach((c, i) => per[i]!.push(c))
        const [c0, c9, c8] = cs as [Cell, Cell, Cell]
        const c73 = runCell(ld, card, tier.skills, arm73)
        const c64 = runCell(ld, card, tier.skills, lairArm)
        rem0 += c0.remPct; rem9 += c9.remPct; rem8 += c8.remPct; rem73 += c73.remPct; rem64 += c64.remPct; n++
        if (ld === L_S4 && tier.skills === FULL_SKILLS) {
          s4Rows.push({ threat: card.threat, name: card.name, rem0: c0.remPct, rem8: c8.remPct, delta: c8.remPct - c0.remPct })
        }
        console.log(
          `${String(card.threat).padStart(4)} ${(card.name + (isPure(card) ? '(纯系)' : '')).padEnd(20)} ` +
            [...cs, c73, c64].map((c) => `${c.winPct}%|${c.durS}s|${c.remPct}%`.padStart(18)).join(' '),
        )
      }
      const winSum = per.map((arr) => arr.reduce((s, c) => s + c.winPct, 0) / 100)
      console.log(
        `  汇总：平均残血 纯系 ${(rem0 / n).toFixed(1)}% / 9:1 ${(rem9 / n).toFixed(1)}% / 8:2 ${(rem8 / n).toFixed(1)}% / 7:3窝点候选 ${(rem73 / n).toFixed(1)}% / 6:4窝点当前 ${(rem64 / n).toFixed(1)}%` +
          `（8:2 相对纯系 ${((rem8 / n - rem0 / n >= 0 ? '+' : '') + (rem8 / n - rem0 / n).toFixed(1))} 点；9:1 相对纯系 ${(rem9 / n - rem0 / n >= 0 ? '+' : '') + (rem9 / n - rem0 / n).toFixed(1)} 点）`,
      )
      console.log(
        `  通档合计（26 档胜率之和，满 = 26）：纯系 ${winSum[0]!.toFixed(1)} / 9:1 ${winSum[1]!.toFixed(1)} / 8:2 ${winSum[2]!.toFixed(1)}`,
      )
      detail.push({ name: `${ld.name}·${tier.name}`, cells: per[2]! })
    }
  }

  /* 残血差的两个方向：混伤更疼 / 反而更轻（副系按族签名取，不按玩家弱点取） */
  console.log('\n—— 方向汇总（8:2 vs 纯系 的战后残血差；S4 满技能口径）——')
  const sorted = [...s4Rows].sort((a, b) => a.delta - b.delta)
  console.log('  【更疼】')
  for (const r of sorted.filter((r) => r.delta < 0).slice(0, 10)) {
    console.log(`   ${String(r.threat).padStart(4)} ${r.name.padEnd(20)} 纯系 ${String(r.rem0).padStart(4)}% → 8:2 ${String(r.rem8).padStart(4)}%（${r.delta} 点）`)
  }
  console.log('  【反而更轻】（副系恰好是该玩家抗得更好 / 层位克制更差的那一系）')
  for (const r of sorted.filter((r) => r.delta > 0).reverse().slice(0, 10)) {
    console.log(`   ${String(r.threat).padStart(4)} ${r.name.padEnd(20)} 纯系 ${String(r.rem0).padStart(4)}% → 8:2 ${String(r.rem8).padStart(4)}%（+${r.delta} 点）`)
  }
  console.log(`  【零差异】${sorted.filter((r) => r.delta === 0).length} 档（低中威胁段基本无感）`)
  void detail
}

/* ═══════════ D. P1 复调轮口径复跑（2026-09-10 船长：重跑 P1 口径） ═══════════
 * 复刻 docs/design/power-ladder-rework.md §五「定稿验收」那张表的行与列，按**今日口径**重跑，
 * 并同时给「纯主系口径」一列做归因——差异若在纯系口径下同样存在，就不是混伤造成的，而是
 * 09-09 之后其它批次（多波次/敌速上调/巡洋数值/点防等）的漂移。 */

/** P1 定稿表（2026-09-09 r4，5 种子）：'胜率|秒|残血%'，'—' = 当批未测该格 */
const P1_BASELINE: Record<string, Record<string, string>> = {
  '锤头鲨炮巡·中位': { 噬口: '100%|50s|107%', 坟场: '100%|50s|112%', 虚海: '100%|54s|107%', 穹顶: '100%|72s|109%', 赤潮: '100%|37s', 蜃影: '100%|51s' },
  '锤头鲨炮巡·无技能': { 噬口: '100%|104s|76%', 坟场: '100%|114s|64%', 虚海: '100%|112s|68%', 穹顶: '100%|129s|47%' },
  'S2 灰鲭鲨MK2·中位': { 噬口: '100%|87s', 坟场: '100%|93s', 虚海: '100%|101s', 穹顶: '100%|127s|69%', 赤潮: '100%|47s', 蜃影: '100%|64s|29%' },
  'S1 虎鲨4MK2·中位': { 赤潮: '100%|52s' },
  'S4 大白鲨5MK3·中位': { 噬口: '100%|52s', 坟场: '100%|55s', 虚海: '100%|56s', 穹顶: '100%|69s' },
}

const P1_COLS: Array<{ key: string; id: string }> = [
  { key: '噬口', id: 'ano-maw-hunt' },
  { key: '坟场', id: 'ano-gravekeeper' },
  { key: '虚海', id: 'ano-voidedge-warden' },
  { key: '穹顶', id: 'ano-vault-sentinel' },
  { key: '赤潮', id: 'ano-redring-raiders' },
  { key: '蜃影', id: 'ano-mirage-hijackers' },
]

const P1_ROWS: Array<{ label: string; ld: Loadout; skills: Record<string, number> }> = [
  { label: '锤头鲨炮巡·中位', ld: L_T3H, skills: MID_SKILLS },
  { label: '锤头鲨炮巡·无技能', ld: L_T3H, skills: {} },
  { label: 'S2 灰鲭鲨MK2·中位', ld: L_S2, skills: MID_SKILLS },
  { label: 'S1 虎鲨4MK2·中位', ld: L_S1, skills: MID_SKILLS },
  { label: 'S4 大白鲨5MK3·中位', ld: L_S4, skills: MID_SKILLS },
]

function sectionD(): void {
  console.log('\n════════ D. P1 复调轮口径复跑（2026-09-09 定稿 vs 今日；9 种子）════════')
  console.log('每格 = 今日(8:2 当前口径) 胜率|秒|残血% ／ 今日(纯主系口径) ／ P1 定稿(09-09)')
  console.log('归因读法：若「今日纯系」也已明显低于「P1 定稿」，则该格的下滑**不是混伤造成的**，')
  console.log('          而是 09-09 之后其它批次（多波次/敌速上调/点阵/数值等）的漂移。')
  const armPure = ctxWithShare(0)
  const armNow = ctxWithShare(0.2)
  for (const row of P1_ROWS) {
    console.log(`\n—— ${row.label} ——`)
    for (const col of P1_COLS) {
      const card = ctx.anomalies.get(col.id)
      if (!card) {
        console.log(`  ${col.key}：目标卡缺失`)
        continue
      }
      const base = P1_BASELINE[row.label]?.[col.key]
      const now = runCell(row.ld, card, row.skills, armNow)
      const pure = runCell(row.ld, card, row.skills, armPure)
      const f = (c: Cell): string => `${c.winPct}%|${c.durS}s|${c.remPct}%`
      console.log(
        `  ${col.key.padEnd(4)} 今日8:2 ${f(now).padEnd(13)} 今日纯系 ${f(pure).padEnd(13)} P1定稿 ${(base ?? '—（当批未测）').padEnd(13)}` +
          (base === undefined ? '' : now.winPct < pure.winPct || now.remPct < pure.remPct ? '  ← 混伤亦有影响' : ''),
      )
    }
  }
}

/* ═══════════ E. 敌伤旋钮对照（foeDmgMul 抬高：这两张卡"够不够威胁"） ═══════════
 * 深渊之门卫队(45) / 星髓虫群(72) 是**仅剩两处**仍挂 `foeDmgMul 0.35` 的能量主系卡
 * （能量=光束必中，玩家闪避对它们完全无效 → 当年用 0.35 做等效回退，标注"待实测复核"）。
 * 本段把旋钮逐档抬高，看"到底要多少才够威胁"，并与同段邻居（未挂本旋钮 = 1.0）对照。 */

/** 覆盖某张卡的 foeDmgMul（其余内容不变） */
function ctxWithFoeDmg(anomalyId: string, mul: number): SimContext {
  const m = new Map(ctx.anomalies)
  const a = m.get(anomalyId)
  if (!a) return ctx
  m.set(anomalyId, { ...a, foeDmgMul: mul })
  return { ...ctx, anomalies: m }
}

const FOE_DMG_STEPS = [0.35, 0.5, 0.7, 1.0]

function sectionE(): void {
  console.log('\n════════ E. 敌伤旋钮对照（foeDmgMul 抬高；9 种子）════════')
  console.log('对象：仅剩两处仍挂 0.35 的能量主系卡（光束必中 → 闪避对它们无效）。')
  console.log('参照行：同段邻居（未挂本旋钮，等效 1.0）——用来看"够不够"应该跟谁比。')
  const targets: Array<{ id: string; label: string; target: string }> = [
    { id: 'ano-abyss-guard', label: '深渊之门卫队 45（C 族·能量 8:爆炸 2·kite）', target: '自注标定：S2 灰鲭鲨MK2 中位 ~50s' },
    { id: 'ano-starcore-boss', label: '星髓虫群 72（C 族·能量 8:爆炸 2·brawl 厚甲+2 僚机）', target: '自注标定：S2 灰鲭鲨MK2 中位 ~80s' },
  ]
  const refs: Array<{ id: string; label: string }> = [
    { id: 'ano-ghost-signal', label: '幽灵舰信号 46（D 族·爆炸 8:能量 2）' },
    { id: 'ano-cinder-siege', label: '烬火围攻战 42（G 族·动能 8:爆炸 2）' },
    { id: 'ano-starcore-boss-ref', label: '' },
  ]
  const rows: Array<{ label: string; ld: Loadout }> = [
    { label: 'S2 灰鲭鲨4×MK2+支援 · 中位', ld: L_S2 },
    { label: 'T3 锤头鲨炮巡5×kin3+支援 · 中位', ld: L_T3H },
  ]
  console.log(`\n—— 被调对象（${FOE_DMG_STEPS.map((v) => (v === 0.35 ? '0.35当前' : String(v))).join(' / ')}）——`)
  for (const t of targets) {
    const card = ctx.anomalies.get(t.id)
    if (!card) {
      console.log(`  ${t.label}：卡缺失`)
      continue
    }
    console.log(`\n${t.label}　【${t.target}】`)
    for (const r of rows) {
      const cells: string[] = []
      for (const v of FOE_DMG_STEPS) {
        const c = runCell(r.ld, card, MID_SKILLS, ctxWithFoeDmg(t.id, v))
        cells.push(`${v === 0.35 ? '★' : ''}${c.winPct}%|${c.durS}s|${c.remPct}%`.padStart(17))
      }
      console.log(`  ${r.label.padEnd(34)}${cells.join(' ')}`)
    }
  }
  console.log('\n—— 同段邻居参照（未挂本旋钮 = 1.0；用来看"合格线"长什么样）——')
  for (const rf of refs) {
    const card = ctx.anomalies.get(rf.id)
    if (!card || !rf.label) continue
    for (const r of rows) {
      const c = runCell(r.ld, card, MID_SKILLS, ctx)
      console.log(`  ${rf.label.padEnd(34)}${r.label.slice(-3)} ${String(c.winPct).padStart(4)}%|${String(c.durS).padStart(3)}s|${String(c.remPct).padStart(4)}%`)
    }
  }
  console.log('\n读法：目标卡的时长若**远短于邻居**、残血若**远高于邻居**，才算"威胁不够"；')
  console.log('      若抬高旋钮后胜率仍在 90% 以上，说明缺的不是火力而是别的（血量/波次/机制）。')
}

/* ═══════════ F. 推进器档位对照（2026-09-10 船长「推进器周期爆发」落地后的效果核对） ═══════════
 * 推进器不再常驻：点火 60 秒 / 冷却 60 秒。本段用**同一艘船换中槽推进器档位**打同一批卡，
 * 看"够不着"是否被治好（判据：敌开火次数）——旧口径下 S2 中位对短射程敌一律满血 0 次开火。 */

function sectionF(): void {
  console.log('\n════════ F. 推进器档位对照（点火 60s / 冷却 60s；9 种子；中位技能）════════')
  const base = {
    ship: 'sh-mako',
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
  }
  const tiers: Array<{ label: string; mid: string[] }> = [
    { label: '无推进器（陀螺）', mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'] },
    { label: 'MK1（+40% 点火）', mid: ['mod-prop-1', 'mod-shield-kin-2', 'mod-track-2'] },
    { label: 'MK2（+80% 点火）', mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'] },
    { label: 'MK3（+130% 点火）', mid: ['mod-prop-3', 'mod-shield-kin-2', 'mod-track-2'] },
  ]
  const targets: Array<{ id: string; label: string }> = [
    { id: 'ano-starcore-boss', label: '星髓虫群 72（近战 2.65km）' },
    { id: 'ano-titan-wreck', label: '泰坦残骸勘探 60（近战 2.6km）' },
    { id: 'ano-gravekeeper', label: '坟场守墓人 88（近战 2.8km）' },
    { id: 'ano-abyss-guard', label: '深渊之门卫队 45（狙击 13.3km·对照）' },
  ]
  for (const t of targets) {
    const card = ctx.anomalies.get(t.id)
    if (!card) continue
    console.log(`\n${t.label}`)
    for (const tier of tiers) {
      const ld: Loadout = { name: tier.label, ...base, mid: tier.mid }
      const c = runCell(ld, card, MID_SKILLS, ctx)
      console.log(`  ${tier.label.padEnd(22)}胜率 ${String(c.winPct).padStart(3)}% · 时长 ${String(c.durS).padStart(3)}s · 残血 ${String(c.remPct).padStart(4)}% · 敌开火 ${String(c.foeShots).padStart(3)} 次`)
    }
  }
  console.log('\n读法：**敌开火次数**是"够不够得着"的直接判据——旧口径（常驻推进器）对近战卡恒为 0；')
  console.log('      推进器周期化后，若战斗跨过 60 秒点火期，冷却段玩家变慢 → 敌开火次数应显著上升。')
}

/* 证据落盘：stdout 同步镜像一份到 battle-data（复核材料与既有校准矩阵同目录） */
const MIRROR: string[] = []
const origLog = console.log.bind(console)
console.log = (...args: unknown[]): void => {
  MIRROR.push(args.map((a) => String(a)).join(' '))
  origLog(...args)
}

/** 复用一次 S4/满技能的逐卡结果（避免重复跑） */
function main(): void {
  const only = (process.argv[2] ?? '').toUpperCase() // 可选：只跑指定段（如 `E` / `AD`），缺省全跑
  const want = (s: string): boolean => only === '' || only.includes(s)
  origLog(`（探针运行中，输出会同时镜像到 docs/design/battle-data/mixed-damage-review-20260910.txt${only ? `；仅跑 ${only} 段` : ''}）`)
  if (want('A')) sectionA()
  if (want('B')) sectionB()
  if (want('D')) sectionD()
  if (want('E')) sectionE()
  if (want('F')) sectionF()
  console.log('\n（探针结束）')
  const out = path.join('docs', 'design', 'battle-data', 'mixed-damage-review-20260910.txt')
  if (only === '') {
    mkdirSync(path.dirname(out), { recursive: true })
    writeFileSync(out, `${MIRROR.join('\n')}\n`, 'utf8')
    origLog(`已写入证据文件：${out}`)
  } else {
    // 只跑单段时**不覆盖**证据文件（否则会把完整证据截断成只剩这一段）
    origLog(`（只跑了 ${only} 段：未覆盖证据文件 ${out}；要刷新完整证据请不带参数跑一遍）`)
  }
}

void main()
