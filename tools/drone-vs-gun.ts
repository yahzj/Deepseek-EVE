/**
 * C6 无人机流 vs 炮击流：高槽伤害比例评估（2026-09-10 船长点开工；正式工具，可复跑）。
 *
 * 用法：npx tsx tools/drone-vs-gun.ts
 *
 * 四张表：
 * ① **免 CPU 约束的槽位边际**——把无人机每架 CPU 临时压到 1（只留舱容约束），看"一件高槽
 *    究竟换来多少火力"：炮台 vs 战术导控/甲板扩展/中继天线/目标锁定。用于回答"高槽本身
 *    值多少 DPS"，排除 CPU 挤压的干扰。
 * ② **真实装配的流派对比**——CPU/舱容都按现网真实钳制（无人机 = 装置 CPU + 每架 CPU 双份），
 *    同船内比纯炮流 / 无人机流 / 混装：名义 DPS、命中修正 DPS、每高槽 DPS、真实放飞机群。
 * ③ **实战**——代表卡 5 种子真实引擎：胜率 / 中位交火秒 / 我方残血%。
 * ④ **情景推演**——把候选调整（导控加成、无人机 CPU、机群清单）临时注入 `ctx` 后重跑，
 *    给出"调到多少能拉平"的菜单；推演结束恢复原值，不改任何源码。
 *
 * 名义 DPS = Σ 单发 ÷ 装填（gun 取 shotsByType 首键，beam/fixed 取 shotDmg）；
 * 命中修正 DPS = 名义 × 武器命中率（beam 必中 = 1；无人机 0.6；炮台 hitRate×eqHitMul）。
 * 名义口径不含距离衰减/接近期/目标抗性——真实差异看表 ③④。
 */
import { addShipToFleet, createInitialState, repairDeprecatedModules, type GameState, type ModuleDef } from '@whale/core'
import { buildSimContext } from '@whale/data'
import {
  advanceBattleFor,
  createPlayerSpec,
  startBattleFor,
  waveGapTotalMs,
  type UnitSpec,
  type WeaponSpec,
} from '../packages/core/src/combat'

const ctx = buildSimContext()
const SEEDS = [1, 7, 13, 29, 51]
const DRONE_IDS = ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry'] as const

const FULL_SKILLS: Record<string, number> = {
  gunnery: 5,
  'kinetic-gunnery': 5,
  'missile-launching': 5,
  'laser-cannon': 5,
  'fire-control': 5,
  'reload-drills': 5,
  'drone-warfare': 5,
  'drone-servicing': 5,
  'ammunition-condensing': 5,
  'shield-operation': 5,
  'energy-management': 5,
  'hull-upgrades': 5,
  'shield-tuning': 5,
  'armor-tuning': 5,
  'armed-ops': 5,
  'armored-ops': 5,
  'vector-maneuvering': 5,
  'evasion-maneuvering': 5,
  'targeting-integration': 5,
  'ship-systems-engineering': 5,
}

/** 中/低槽火力向支援件（各行统一，差异只来自高槽选择；注意：这些件对无人机火力无效） */
const SUP_MID = ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2']
const SUP_LOW = ['mod-stab-kin-2', 'mod-rof-2', 'mod-armor-kin-2']

const D3_FLEET = { 'drone-heavy': 4, 'drone-sentry': 6 } // 官方 D3 口径（4 猎鹰 + 6 雷鸥 = 320 m³）
const FALCON16 = { 'drone-heavy': 16 } // 舱容最优（16 猎鹰 = 320 m³，每 m³ 伤害最高的三型之一）

type Cfg = {
  name: string
  ship: string
  high: (string | null)[]
  drones?: Record<string, number>
  mid?: string[]
  low?: string[]
}

function makeState(cfg: Cfg, seed = 1): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  addShipToFleet(state, cfg.ship)
  state.shipId = cfg.ship
  for (const [id, lv] of Object.entries(FULL_SKILLS)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  const entry = state.fleet[cfg.ship]!
  if (cfg.drones) entry.droneLoad = { ...cfg.drones }
  entry.fitted = { high: [...cfg.high], mid: [...(cfg.mid ?? [])], low: [...(cfg.low ?? [])] }
  repairDeprecatedModules(state, ctx)
  return state
}

interface Dps {
  nominal: number
  hitAdj: number
  bySrc: Record<string, number>
  drones: Record<string, number>
}
function dpsOf(spec: UnitSpec): Dps {
  let nominal = 0
  let hitAdj = 0
  const bySrc: Record<string, number> = {}
  const drones: Record<string, number> = {}
  for (const w of spec.weapons as WeaponSpec[]) {
    const per = w.kind === 'gun' ? (Object.values(w.shotsByType ?? {})[0] ?? 0) : (w.shotDmg ?? 0)
    const dps = (per / Math.max(1, w.reloadMs)) * 1000
    const hit = w.kind === 'beam' ? 1 : (w.hitRate ?? 0.5) * (w.eqHitMul ?? 1)
    const src = w.src ?? 'base'
    nominal += dps
    hitAdj += dps * hit
    bySrc[src] = (bySrc[src] ?? 0) + dps
    if (w.src === 'drone' && w.artId) drones[w.artId] = (drones[w.artId] ?? 0) + 1
  }
  return { nominal, hitAdj, bySrc, drones }
}

function specOf(cfg: Cfg, seed = 1): UnitSpec | null {
  return createPlayerSpec(makeState(cfg, seed), ctx, cfg.ship)
}
function dpsOfCfg(cfg: Cfg): Dps | null {
  const spec = specOf(cfg)
  return spec ? dpsOf(spec) : null
}

/** 真实模拟：胜率 / 中位交火秒 / 我方残血比（同 battle-calibrate 口径） */
function battle(cfg: Cfg, anomalyId: string): { winRate: number; medSec: number; remain: number } {
  const rows: Array<{ win: boolean; sec: number; remain: number }> = []
  for (const seed of SEEDS) {
    const state = makeState(cfg, seed)
    const b = startBattleFor(state, ctx, cfg.ship, anomalyId, 0)
    if (!b) continue
    const spec = createPlayerSpec(state, ctx, cfg.ship)
    const maxHp = spec ? spec.hp.s + spec.hp.a + spec.hp.h : 1
    state.gameMs =
      ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(anomalyId), ctx.balance.battle)
    advanceBattleFor(state, ctx, b, cfg.ship, anomalyId)
    const u = b.units['player']
    const hp = u ? u.hp.s + u.hp.a + u.hp.h : 0
    rows.push({
      win: b.ended === 'me',
      sec: Math.round(
        Math.min(ctx.balance.battle.maxBattleMs, Math.max(0, b.lastTickGameMs - b.startedAtGameMs)) / 1000,
      ),
      remain: maxHp > 0 ? hp / maxHp : 0,
    })
  }
  if (rows.length === 0) return { winRate: 0, medSec: 0, remain: 0 }
  const secs = rows.map((r) => r.sec).sort((a, b) => a - b)
  return {
    winRate: Math.round((rows.filter((r) => r.win).length / rows.length) * 100),
    medSec: secs[Math.floor(secs.length / 2)]!,
    remain: rows.reduce((s, r) => s + r.remain, 0) / rows.length,
  }
}

const n = (v: number): string => Math.round(v).toLocaleString('zh-CN')
const fleetText = (drones: Record<string, number>): string => {
  const parts = Object.entries(drones)
    .filter(([, c]) => c > 0)
    .map(([id, c]) => `${(ctx.items.get(id)?.name ?? id).replace(/无人机$/, '')}×${c}`)
  return parts.length > 0 ? parts.join('+') : '无'
}
const droneTotal = (d: Dps): number => Object.values(d.drones).reduce((s, c) => s + c, 0)
const m3Used = (d: Dps): number =>
  Object.entries(d.drones).reduce((s, [id, c]) => s + (ctx.items.get(id)?.unitM3 ?? 0) * c, 0)

/** 免 CPU 约束：把无人机每架 CPU 压到 1（仍 >0 才会放飞），只留舱容约束；结束必恢复 */
function withDroneCpuCheap<T>(fn: () => T): T {
  const saved = DRONE_IDS.map((id) => [id, ctx.items.get(id)?.cpuUse ?? 1] as const)
  for (const [id] of saved) {
    const def = ctx.items.get(id)
    if (def) (def as { cpuUse?: number }).cpuUse = 1
  }
  try {
    return fn()
  } finally {
    for (const [id, v] of saved) {
      const def = ctx.items.get(id)
      if (def) (def as { cpuUse?: number }).cpuUse = v
    }
  }
}

/** 情景推演：临时改导控加成 / 无人机 CPU，结束恢复 */
function withPatch<T>(patch: { tac3Bonus?: number; droneCpuMul?: number }, fn: () => T): T {
  const tac = ctx.modules.get('mod-drone-tac-3') as ModuleDef | undefined
  const savedTac = tac?.droneDmgBonus
  const savedCpu = DRONE_IDS.map((id) => [id, ctx.items.get(id)?.cpuUse ?? 0] as const)
  if (tac && patch.tac3Bonus !== undefined) (tac as { droneDmgBonus?: number }).droneDmgBonus = patch.tac3Bonus
  if (patch.droneCpuMul !== undefined) {
    for (const [id, v] of savedCpu) {
      const def = ctx.items.get(id)
      if (def) (def as { cpuUse?: number }).cpuUse = Math.max(1, Math.round(v * patch.droneCpuMul))
    }
  }
  try {
    return fn()
  } finally {
    if (tac && savedTac !== undefined) (tac as { droneDmgBonus?: number }).droneDmgBonus = savedTac
    for (const [id, v] of savedCpu) {
      const def = ctx.items.get(id)
      if (def) (def as { cpuUse?: number }).cpuUse = v
    }
  }
}

/** 分组字符串：炮台/导弹架/激光炮/无人机/基础舰炮 */
function groupText(d: Dps): string {
  const b = d.bySrc
  return `${n(b['turret'] ?? 0)}/${n(b['missile'] ?? 0)}/${n(b['laser'] ?? 0)}/${n(b['drone'] ?? 0)}/${n(b['base'] ?? 0)}`
}

/** 无人机真实 CPU 单价（表 1 免 CPU 口径下用于展示真实成本，不被临时压值污染） */
const REAL_DRONE_CPU: Record<string, number> = Object.fromEntries(
  DRONE_IDS.map((id) => [id, ctx.items.get(id)?.cpuUse ?? 0]),
)

/* ══════════ 表 1：免 CPU 约束的槽位边际（基准船 王鲭级：6 高槽 / 机巢 320m³ / CPU 320）══════════ */
const SENT = 'sh-sentinel'
/** 装载清单给足以免舱容被清单卡住：甲板扩展的边际 = 舱容换架数 */
const BIG_FLEET = { 'drone-heavy': 40 }
console.log('══ 表 1a：一件高槽换多少火力（王鲭级；免 CPU 约束口径——无人机每架 CPU 压到 1，仅留舱容）══')
console.log('配置\t高槽件CPU\t机群CPU\t名义DPS\t命中修正DPS\tΔ名义/槽\tΔ有效/槽\t放飞机群\t名义分组(炮/弹/光/机/基础)')
withDroneCpuCheap(() => {
  const rows: Array<{ label: string; cfg: Cfg; gearCpu: number }> = [
    { label: '1×攻坚炮台MK3（无无人机）', cfg: { name: '', ship: SENT, high: ['mod-turret-kin-3'] }, gearCpu: 52 },
    { label: '2×攻坚炮台MK3（无无人机）', cfg: { name: '', ship: SENT, high: ['mod-turret-kin-3', 'mod-turret-kin-3'] }, gearCpu: 104 },
    { label: '3×攻坚炮台MK3（无无人机）', cfg: { name: '', ship: SENT, high: Array(3).fill('mod-turret-kin-3') }, gearCpu: 156 },
    { label: '无高槽件+满舱16猎鹰（无人机基准）', cfg: { name: '', ship: SENT, high: [], drones: BIG_FLEET }, gearCpu: 0 },
    { label: '＋战术导控MK3 ×1', cfg: { name: '', ship: SENT, high: ['mod-drone-tac-3'], drones: BIG_FLEET }, gearCpu: 45 },
    { label: '＋战术导控MK3 ×2', cfg: { name: '', ship: SENT, high: ['mod-drone-tac-3', 'mod-drone-tac-3'], drones: BIG_FLEET }, gearCpu: 90 },
    { label: '＋甲板扩展MK3 ×1（舱容→更多架）', cfg: { name: '', ship: SENT, high: ['mod-drone-rack-3'], drones: BIG_FLEET }, gearCpu: 40 },
    { label: '＋甲板扩展MK3 ×2', cfg: { name: '', ship: SENT, high: ['mod-drone-rack-3', 'mod-drone-rack-3'], drones: BIG_FLEET }, gearCpu: 80 },
    { label: '＋中继天线MK3 ×1（不增伤，只增射程）', cfg: { name: '', ship: SENT, high: ['mod-drone-relay-3'], drones: BIG_FLEET }, gearCpu: 46 },
  ]
  let prev: { d: Dps; slots: number } | null = null
  for (const r of rows) {
    const d = dpsOfCfg(r.cfg)
    if (!d) continue
    const slots = r.cfg.high.filter(Boolean).length
    const fleetCpu = Object.entries(d.drones).reduce((s, [id, c]) => s + (REAL_DRONE_CPU[id] ?? 0) * c, 0)
    let dNom = ''
    let dEff = ''
    if (prev && slots > prev.slots) {
      dNom = n((d.nominal - prev.d.nominal) / (slots - prev.slots))
      dEff = n((d.hitAdj - prev.d.hitAdj) / (slots - prev.slots))
    }
    console.log(
      `${r.label}\t${r.gearCpu}\t${fleetCpu}\t${n(d.nominal)}\t${n(d.hitAdj)}\t${dNom || '—'}\t${dEff || '—'}\t` +
        `${fleetText(d.drones)}（${droneTotal(d)}架/${m3Used(d)}m³）\t${groupText(d)}`,
    )
    prev = { d, slots }
  }
})
console.log(
  '注：目标锁定阵列不在静态卡内（结算期乘入：集火模式 + 被锁目标受击加深 8/12/20%），其效果见表 3 实战行。',
)

/* ══════════ 表 2：真实装配流派对比（CPU/舱容按现网真实钳制）══════════ */
const SWARM_CFGS: Cfg[] = [
  { name: '梭鱼·纯炮 4×MK3', ship: 'sh-swarm', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', null], mid: SUP_MID, low: SUP_LOW },
  { name: '梭鱼·纯炮 3×MK3+锁定3', ship: 'sh-swarm', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-lock-3', null], mid: SUP_MID, low: SUP_LOW },
  { name: '梭鱼·无人机 D2(rack2×2+tac2×2)', ship: 'sh-swarm', high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2', 'mod-drone-tac-2', null], drones: { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }, mid: SUP_MID, low: SUP_LOW },
  { name: '梭鱼·无人机 D2+中继3', ship: 'sh-swarm', high: ['mod-drone-rack-2', 'mod-drone-rack-2', 'mod-drone-tac-2', 'mod-drone-tac-2', 'mod-drone-relay-3'], drones: { 'drone-assault': 10, 'drone-heavy': 4, 'drone-sentry': 1 }, mid: SUP_MID, low: SUP_LOW },
  { name: '梭鱼·无人机 rack3×2+tac3×2', ship: 'sh-swarm', high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', null], drones: { 'drone-heavy': 4, 'drone-sentry': 6 }, mid: SUP_MID, low: SUP_LOW },
]
const SENT_CFGS: Cfg[] = [
  { name: '王鲭·纯炮 6×MK3', ship: SENT, high: Array(6).fill('mod-turret-kin-3'), mid: SUP_MID, low: SUP_LOW },
  { name: '王鲭·纯炮 6×MK3（无中/低槽支援件）', ship: SENT, high: Array(6).fill('mod-turret-kin-3') },
  { name: '王鲭·纯炮 5×MK3+锁定3', ship: SENT, high: [...Array(5).fill('mod-turret-kin-3'), 'mod-lock-3'], mid: SUP_MID, low: SUP_LOW },
  { name: '王鲭·无人机 D3(rack3×2+tac3×2)', ship: SENT, high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', null, null], drones: D3_FLEET, mid: SUP_MID, low: SUP_LOW },
  { name: '王鲭·无人机 D3+锁定3', ship: SENT, high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', 'mod-lock-3', null], drones: D3_FLEET, mid: SUP_MID, low: SUP_LOW },
  { name: '王鲭·无人机 D3+中继3×2', ship: SENT, high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', 'mod-drone-relay-3', 'mod-drone-relay-3'], drones: D3_FLEET, mid: SUP_MID, low: SUP_LOW },
  { name: '王鲭·混装 4炮+rack3+tac3', ship: SENT, high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-drone-rack-3', 'mod-drone-tac-3'], drones: D3_FLEET, mid: SUP_MID, low: SUP_LOW },
  { name: '王鲭·无人机满舱16猎鹰(rack3×2+tac3×2)', ship: SENT, high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', null, null], drones: FALCON16, mid: SUP_MID, low: SUP_LOW },
  { name: '王鲭·无人机满舱16猎鹰+锁定3', ship: SENT, high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', 'mod-lock-3', null], drones: FALCON16, mid: SUP_MID, low: SUP_LOW },
]
for (const [title, cfgs] of [
  ['══ 表 2a：梭鱼级（5 高槽 / 机巢 160m³ / CPU 235）真实装配对比 ══', SWARM_CFGS],
  ['══ 表 2b：王鲭级（6 高槽 / 机巢 320m³ / CPU 320）真实装配对比 ══', SENT_CFGS],
] as const) {
  console.log(`\n${title}`)
  console.log('配置\t高槽占用\t名义DPS\t命中修正DPS\tDPS/高槽\t有效DPS/高槽\t放飞机群\t名义分组(炮/弹/光/机/基础)')
  for (const cfg of cfgs) {
    const d = dpsOfCfg(cfg)
    if (!d) {
      console.log(`${cfg.name}\t建场失败`)
      continue
    }
    const slots = cfg.high.filter(Boolean).length
    console.log(
      `${cfg.name}\t${slots}\t${n(d.nominal)}\t${n(d.hitAdj)}\t${n(d.nominal / Math.max(1, slots))}\t${n(d.hitAdj / Math.max(1, slots))}\t` +
        `${fleetText(d.drones)}（${droneTotal(d)}架/${m3Used(d)}m³）\t${groupText(d)}`,
    )
  }
}

/* ══════════ 表 3：实战（代表卡 5 种子）══════════ */
const CARDS = ['ano-maw-hunt', 'ano-gravekeeper', 'ano-vault-sentinel']
const cardHeader = CARDS.map((id) => {
  const a = ctx.anomalies.get(id)
  return `${a?.name ?? id}(威胁${a?.threat ?? '?'})`
})
const BATTLE_CFGS: Cfg[] = [
  SENT_CFGS[0]!, // 纯炮 6×MK3（+支援）
  SENT_CFGS[1]!, // 纯炮 6×MK3（无支援）
  SENT_CFGS[2]!, // 纯炮 5×MK3+锁定3
  SENT_CFGS[3]!, // 无人机 D3
  SENT_CFGS[4]!, // 无人机 D3+锁定3
  SENT_CFGS[5]!, // 无人机 D3+中继3×2
  SENT_CFGS[7]!, // 无人机满舱16猎鹰
  SENT_CFGS[8]!, // 无人机满舱16猎鹰+锁定3
  SENT_CFGS[6]!, // 混装 4炮+rack3+tac3
  SWARM_CFGS[0]!,
  SWARM_CFGS[2]!,
]
console.log('\n══ 表 3：实战（满技能，5 种子；格 = 胜率%/中位秒/我方残血%）══')
console.log(`配置\t${cardHeader.join('\t')}`)
for (const cfg of BATTLE_CFGS) {
  const cells = CARDS.map((id) => {
    const r = battle(cfg, id)
    return `${r.winRate}%/${r.medSec}s/${Math.round(r.remain * 100)}%`
  })
  console.log(`${cfg.name}\t${cells.join('\t')}`)
}

/* ══════════ 表 4：情景推演（候选调整注入后重跑；不改源码）══════════ */
console.log('\n══ 表 4：情景推演（无人机流拉平方案；王鲭级；导控/CPU 临时注入，跑完恢复）══')
const SCENARIOS: Array<{ name: string; tac3Bonus?: number; droneCpuMul?: number; fleet: Record<string, number> }> = [
  { name: 'S0 现状（导控40%，无人机CPU现价，D3）', fleet: D3_FLEET },
  { name: 'S1 导控MK3 40→60%，D3', tac3Bonus: 0.6, fleet: D3_FLEET },
  { name: 'S2 无人机CPU×0.65，满舱16猎鹰', droneCpuMul: 0.65, fleet: FALCON16 },
  { name: 'S3 导控60% + 无人机CPU×0.65，满舱16猎鹰', tac3Bonus: 0.6, droneCpuMul: 0.65, fleet: FALCON16 },
  { name: 'S4 导控60% + 无人机CPU×0.5，满舱16猎鹰', tac3Bonus: 0.6, droneCpuMul: 0.5, fleet: FALCON16 },
]
console.log('情景\t名义DPS\t命中修正DPS\t放飞机群\t坟场88 胜/秒/残血\t穹顶96 胜/秒/残血')
const gunBase = dpsOfCfg(SENT_CFGS[0]!)
console.log(
  `  （炮流对照：${SENT_CFGS[0]!.name} 名义 ${n(gunBase?.nominal ?? 0)}｜有效 ${n(gunBase?.hitAdj ?? 0)}｜实战场次见下）`,
)
for (const sc of SCENARIOS) {
  withPatch({ tac3Bonus: sc.tac3Bonus, droneCpuMul: sc.droneCpuMul }, () => {
    const cfg: Cfg = {
      name: sc.name,
      ship: SENT,
      high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3', null, null],
      drones: sc.fleet,
      mid: SUP_MID,
      low: SUP_LOW,
    }
    const d = dpsOfCfg(cfg)
    const g = battle(cfg, 'ano-gravekeeper')
    const v = battle(cfg, 'ano-vault-sentinel')
    if (!d) {
      console.log(`${sc.name}\t建场失败`)
      return
    }
    console.log(
      `${sc.name}\t${n(d.nominal)}\t${n(d.hitAdj)}\t${fleetText(d.drones)}（${droneTotal(d)}架/${m3Used(d)}m³）\t` +
        `${g.winRate}%/${g.medSec}s/${Math.round(g.remain * 100)}%\t${v.winRate}%/${v.medSec}s/${Math.round(v.remain * 100)}%`,
    )
  })
}
console.log(
  `  （炮流对照实战：坟场 ${(() => {
    const r = battle(SENT_CFGS[0]!, 'ano-gravekeeper')
    return `${r.winRate}%/${r.medSec}s/${Math.round(r.remain * 100)}%`
  })()}｜穹顶 ${(() => {
    const r = battle(SENT_CFGS[0]!, 'ano-vault-sentinel')
    return `${r.winRate}%/${r.medSec}s/${Math.round(r.remain * 100)}%`
  })()}）`,
)

/* ══════════ 汇总比例 ══════════ */
{
  const gun = dpsOfCfg(SENT_CFGS[0]!)
  const gunNoSup = dpsOfCfg(SENT_CFGS[1]!)
  const dr = dpsOfCfg(SENT_CFGS[3]!)
  const drFull = dpsOfCfg(SENT_CFGS[7]!)
  if (gun && dr) {
    console.log('\n══ 汇总（王鲭级，真实 CPU/舱容约束）══')
    console.log(
      `名义 DPS：炮流 ${n(gun.nominal)} vs 无人机流(D3) ${n(dr.nominal)} → ${Math.round((dr.nominal / gun.nominal) * 100)}%｜满舱机群 ${n(drFull?.nominal ?? 0)} → ${Math.round(((drFull?.nominal ?? 0) / gun.nominal) * 100)}%`,
    )
    console.log(
      `有效 DPS（命中修正）：炮流 ${n(gun.hitAdj)} vs 无人机流(D3) ${n(dr.hitAdj)} → ${Math.round((dr.hitAdj / gun.hitAdj) * 100)}%｜满舱机群 ${n(drFull?.hitAdj ?? 0)} → ${Math.round(((drFull?.hitAdj ?? 0) / gun.hitAdj) * 100)}%`,
    )
    console.log(
      `每高槽有效：炮流 ${n(gun.hitAdj / 6)} vs 无人机流(D3) ${n(dr.hitAdj / 4)}（${Math.round((dr.hitAdj / 4 / (gun.hitAdj / 6) - 1) * 100)}%）`,
    )
    if (gunNoSup) {
      console.log(
        `支援件贡献（炮流）：名义 ${n(gunNoSup.nominal)}→${n(gun.nominal)}；有效 ${n(gunNoSup.hitAdj)}→${n(gun.hitAdj)}（${Math.round((gun.hitAdj / gunNoSup.hitAdj - 1) * 100)}%）——无人机流拿不到这部分`,
      )
    }
  }
}
