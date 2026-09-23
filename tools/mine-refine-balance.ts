/**
 * **采矿 vs 精炼 速度配平**（`npm run balance:mine-refine`）
 *
 * **用途**：船长 2026-09-22 的问题——「我打算添加新技能，用于平衡采矿和精炼的速度。以鲸王+3MK3采集器
 * 满技能作为满配标准。现有的精炼炉应该加强多少才能达到 2 精炼炉搭配 1 鲸王的挖掘速度？」
 * 本工具用**真数据 + 真公式口径**把两边的每小时吞吐算出来，给出"差多少倍"和"要补多少"。
 *
 * **口径（全部照抄引擎实现，不是估算）**：
 * - 采矿（`mining.ts getMiningParams`）：`每循环 = floor(船只 oreUnitsPerCycle × 产量乘链 × (1 + Σ矿枪加成))`、
 *   `循环 = 船只 cycleSeconds × (1 − 采矿舰入门学 3%/级)`；产量乘链 = 采矿技术 6%/级 × 星质地质学 4%/级（全矿）
 *   × 采矿舰操作 4%/级（工业族）× 深井爆破学 6%/级（≤55 ISK 低品级矿）× 深空采集学 5%/级（气/冰）。
 * - 精炼（`industry.ts startRefineRun`）：`单批 = round(refineBatchUnits ×(1+炉膛扩容学 6%/级))`、
 *   `周期 = round(refineCycleMs ÷ 核心效率 ×(1−炉心熔炼学 4%/级)×(1−产线节拍学 5%/级))`；
 *   主控亲身 ♯效率 1，AI 核心按 `balance.aiCore.efficiency` + AI 核心调度学 2%/级（封顶 1）。
 * - 两边的**"速度"取"矿石单位/小时"**（精炼侧算的是**吃矿速度**；精炼产出倍率另有 `refineRate`，不影响吃矿快慢）。
 *
 * **用法**：`npx tsx tools/mine-refine-balance.ts`（可选 `--furnaces 2`、`--core beta`、`--pilot` 只看主控炉）
 * **输出**：控制台表格 + `tools/_ui-artifacts/mine-refine-balance.txt`（可重建、不入库）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '../packages/data/src/index'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/shipyard'
import { getMiningParams } from '../packages/core/src/mining'
import { aiEfficiency } from '../packages/core/src/ai'
import type { AiCoreType } from '../packages/core/src/types'
import type { GameState } from '../packages/core/src/state'

const ctx = buildSimContext()
const argv = process.argv.slice(2)
const argOf = (n: string, d?: string): string | undefined => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 ? argv[i + 1] : d
}
const FURNACES = Number(argOf('furnaces', '2'))
const CORE = (argOf('core', 'alpha') ?? 'alpha') as AiCoreType
const SHIP = argOf('ship', 'whale-king') as string
const MINER = argOf('miner', 'mod-miner-3') as string
const MINERS = Number(argOf('miners', '3'))

const MAXLV = 5
const isk = (n: number): string => n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })

/** 全技能满级的状态（只点亮本工具用得着的那些） */
function maxedState(fittedHigh: string[]): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 1 })
  // ⚠ 船型 id **不统一**：多数是 `sh-xxx`（如 `sh-humpback`），但鲸王/鲸是 `whale-king` / `whale` ⇒ 直接传 defId
  if (!ctx.ships.get(SHIP)) throw new Error(`没有这个船型：${SHIP}（现有：${[...ctx.ships.keys()].slice(0, 12).join(', ')}…）`)
  const uid = addShipToFleet(s, SHIP)
  s.shipId = uid
  s.fleet[uid]!.fitted = { high: fittedHigh, mid: [], low: [] }
  for (const id of [
    'mining',
    'mining-frigate',
    'astro-geology',
    'industrial-ops',
    'deep-hole-blasting',
    'deep-space-harvesting',
    'refining',
    'reprocessing',
    'core-smelting',
    'furnace-expansion',
    'industrial-automation',
    'ai-core-dispatch',
    'ai-expert',
  ]) {
    s.skills.trained[id] = MAXLV
  }
  s.aiCores[CORE] = 4
  return s
}

const out: string[] = []
const say = (line = ''): void => {
  console.log(line)
  out.push(line)
}

/* ── 一、采矿（满配：鲸王 + 3×MK3 + 满技能） ── */
const mineState = maxedState(Array.from({ length: MINERS }, () => MINER))
const beltIds = [...ctx.belts.keys()]
const pickBelt = (pred: (oreId: string) => boolean): { id: string; oreId: string } | null => {
  for (const id of beltIds) {
    const oreId = ctx.belts.get(id)?.oreId
    if (oreId && pred(oreId)) return { id, oreId }
  }
  return null
}
const normal = pickBelt((o) => {
  const d = ctx.items.get(o)
  return !!d && d.kind !== 'gas' && d.kind !== 'ice' && (d.baseSellPriceIsk ?? 0) > 55
})
const lowGrade = pickBelt((o) => {
  const d = ctx.items.get(o)
  return !!d && d.kind !== 'gas' && d.kind !== 'ice' && (d.baseSellPriceIsk ?? 0) > 0 && (d.baseSellPriceIsk ?? 0) <= 55
})
const gasIce = pickBelt((o) => {
  const d = ctx.items.get(o)
  return !!d && (d.kind === 'gas' || d.kind === 'ice')
})

const shipDef = ctx.ships.get(SHIP)
const minerDef = ctx.modules.get(MINER)
say(`═══ 一、采矿（满配基准：${shipDef?.name ?? SHIP} ＋ ${MINERS}×${minerDef?.name ?? MINER} ＋ 相关技能全 Lv${MAXLV}）═══`)
say(`  船体：产能 ${shipDef?.oreUnitsPerCycle} 单位 / ${shipDef?.cycleSeconds} 秒 · 高槽 ${shipDef?.slots.high} 个 · 货舱 ${isk(shipDef?.cargoM3 ?? 0)} m³`)
say(`  矿枪：每台 +${Math.round((minerDef?.bonus ?? 0) * 100)}% ⇒ ${MINERS} 台合计 +${Math.round((minerDef?.bonus ?? 0) * MINERS * 100)}%（线性叠加）`)
for (const [tag, belt] of [
  ['普通矿', normal],
  ['低品级矿（≤55 ISK）', lowGrade],
  ['气/冰', gasIce],
] as const) {
  if (!belt) continue
  mineState.mining.beltId = belt.id
  const p = getMiningParams(mineState, ctx)
  if (!p) continue
  const perHour = (p.unitsPerCycle * 3_600_000) / p.cycleMs
  say(
    `  ${tag.padEnd(20)}（${ctx.items.get(belt.oreId)?.name ?? belt.oreId}）：` +
      `${p.unitsPerCycle} 单位 / ${(p.cycleMs / 1000).toFixed(2)} 秒 ⇒ **${isk(perHour)} 单位/小时**`,
  )
}

/* ── 二、精炼（每台炉吃矿速度） ── */
const lv = (id: string): number => mineState.skills.trained[id] ?? 0
const smeltMul = Math.max(0.6, 1 - 0.04 * lv('core-smelting'))
const autoMul = Math.max(0, 1 - 0.05 * lv('industrial-automation'))
const expMul = 1 + 0.06 * lv('furnace-expansion')
const effPilot = 1
const effCore = aiEfficiency(mineState, ctx, CORE)
say()
say(`═══ 二、精炼（每台炉吃矿速度，技能全 Lv${MAXLV}）═══`)
say(
  `  乘区：炉膛扩容学 ×${expMul.toFixed(2)}（批容）· 炉心熔炼学 ×${smeltMul.toFixed(2)} × 产线节拍学 ×${autoMul.toFixed(2)} = ×${(smeltMul * autoMul).toFixed(3)}（周期）`,
)
say(`  劳动者：主控 效率 ${effPilot.toFixed(2)} · AI 核心「${CORE}」效率 ${effCore.toFixed(2)}（含 AI 核心调度学 +2%/级）`)

/** 每台炉的吃矿速度（单位/小时）：批容×倍率 ÷ 周期(ms) ×3.6e6 */
function furnaceRate(batchUnits: number, cycleMs: number, eff: number): { batch: number; cycle: number; perHour: number } {
  const batch = Math.max(1, Math.round(batchUnits * expMul))
  const cycle = Math.max(1, Math.round((cycleMs / eff) * smeltMul * autoMul))
  return { batch, cycle, perHour: (batch * 3_600_000) / cycle }
}

const oreDefs = [...ctx.items.values()].filter((d) => (d.refine?.length ?? 0) > 0 && d.refineBatchUnits !== undefined)
say(`  可精炼资源 ${oreDefs.length} 种；下表取样本（括号内为数据里的单批/周期）`)
say()
say('  资源                 单批   周期(主控)   主控炉 单位/时     AI 炉 单位/时   2 台炉合计(AI)')
const samples = oreDefs
  .map((d) => ({ d, r: furnaceRate(d.refineBatchUnits!, d.refineCycleMs ?? 6000, effCore) }))
  .sort((a, b) => a.r.perHour - b.r.perHour)
const lines: Array<{ name: string; base: string; pilot: number; ai: number; total: number }> = []
for (const s of samples) {
  const pilot = furnaceRate(s.d.refineBatchUnits!, s.d.refineCycleMs ?? 6000, effPilot)
  lines.push({
    name: s.d.name,
    base: `${s.d.refineBatchUnits}/${(s.d.refineCycleMs ?? 6000) / 1000}s`,
    pilot: pilot.perHour,
    ai: s.r.perHour,
    total: s.r.perHour * FURNACES,
  })
}
const show = [...lines.slice(0, 3), ...lines.slice(Math.floor(lines.length / 2) - 1, Math.floor(lines.length / 2) + 1), ...lines.slice(-3)]
for (const l of show) {
  say(
    `  ${l.name.padEnd(18)} ${l.base.padEnd(12)} ${String(l.pilot.toFixed(0)).padStart(10)} ${String(l.ai.toFixed(0)).padStart(14)} ${String(l.total.toFixed(0)).padStart(16)}`,
  )
}

/* ── 三、差距与所需加强 ── */
say()
say('═══ 三、差距：2 台 AI 炉 追 1 艘鲸王 ═══')
for (const [tag, belt] of [
  ['普通矿', normal],
  ['低品级矿', lowGrade],
  ['气/冰', gasIce],
] as const) {
  if (!belt) continue
  mineState.mining.beltId = belt.id
  const p = getMiningParams(mineState, ctx)!
  const minePerHour = (p.unitsPerCycle * 3_600_000) / p.cycleMs
  // 同族矿的精炼参数：取该矿自己的 refineBatchUnits/refineCycleMs（没有就用兜底 10/6000）
  const def = ctx.items.get(belt.oreId)!
  const pilot = furnaceRate(def.refineBatchUnits ?? 10, def.refineCycleMs ?? 6000, effPilot)
  const ai = furnaceRate(def.refineBatchUnits ?? 10, def.refineCycleMs ?? 6000, effCore)
  const totalAI = ai.perHour * FURNACES
  const totalPilotMix = pilot.perHour + ai.perHour * (FURNACES - 1) // 1 台主控 + 其余 AI
  say(
    `  ${tag.padEnd(10)} 采矿 ${isk(minePerHour)}/时 · 2 台 AI 炉 ${isk(totalAI)}/时（占 ${((totalAI / minePerHour) * 100).toFixed(1)}%）` +
      ` · 1 主控+1AI ${isk(totalPilotMix)}/时（占 ${((totalPilotMix / minePerHour) * 100).toFixed(1)}%）`,
  )
  const need = minePerHour / totalAI
  say(`      ⇒ 要 2 台 AI 炉刚好追上：精炼吞吐需 **×${need.toFixed(2)}**（每台炉再 +${((need - 1) * 100).toFixed(0)}%）`)
}

/* ── 四、把"往返运回"算进去：有效到货速度（精炼真正要追的那个数） ── */
say()
say('═══ 四、含往返的有效到货速度（货舱 7,000 m³，本地矿带：出航空船 60s + 返程满载 120s）═══')
say('  口径：满载若干循环 → 返程卸货 → 再去 ⇒ 有效到货 = 满仓单位 ÷（出航 60s + 挖矿时间 + 返程 120s）')
const cargo = shipDef?.cargoM3 ?? 0
for (const [tag, belt] of [
  ['普通矿', normal],
  ['低品级矿', lowGrade],
  ['气/冰', gasIce],
] as const) {
  if (!belt) continue
  mineState.mining.beltId = belt.id
  const p = getMiningParams(mineState, ctx)!
  const def = ctx.items.get(belt.oreId)!
  const perUnitM3 = def.unitM3 ?? 1
  const cyclesFull = Math.max(1, Math.floor(cargo / perUnitM3 / p.unitsPerCycle))
  const loadUnits = cyclesFull * p.unitsPerCycle
  const mineMs = cyclesFull * p.cycleMs
  const tripMs = 60_000 + mineMs + 120_000
  const delivered = (loadUnits * 3_600_000) / tripMs
  const ai = furnaceRate(def.refineBatchUnits ?? 10, def.refineCycleMs ?? 6000, effCore)
  const pilot = furnaceRate(def.refineBatchUnits ?? 10, def.refineCycleMs ?? 6000, effPilot)
  say(
    `  ${tag.padEnd(10)}（${def.name}）：满仓 ${isk(loadUnits)} 单位 = ${cyclesFull} 循环（挖 ${(mineMs / 1000).toFixed(0)}s）` +
      ` ⇒ 一趟 ${(tripMs / 1000).toFixed(0)}s ⇒ **有效到货 ${isk(delivered)} 单位/时**（纯挖掘 ${isk((p.unitsPerCycle * 3_600_000) / p.cycleMs)}/时）`,
  )
  const totalAI = ai.perHour * FURNACES
  say(
    `      ⇒ 2 台 AI 炉 ${isk(totalAI)}/时：占**有效到货** ${((totalAI / delivered) * 100).toFixed(1)}%` +
      `（要追上有效到货需 ×${(delivered / totalAI).toFixed(2)}）· 主控炉单台 ${isk(pilot.perHour)}/时`,
  )
}

mkdirSync(join(process.cwd(), 'tools', '_ui-artifacts'), { recursive: true })
writeFileSync(join(process.cwd(), 'tools', '_ui-artifacts', 'mine-refine-balance.txt'), out.join('\n'), 'utf8')
say()
say(`（读数存档：tools/_ui-artifacts/mine-refine-balance.txt）`)