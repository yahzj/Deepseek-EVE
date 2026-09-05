/**
 * B3 回收链经济体检（正式工具，P3 校准用，2026-09-05；满技能行 2026-09-05 收尾）：
 * 锚：回收链保底 EV/h（炉时 100%）≈ 采矿环 ×1.1（采矿参照 ~50,000 ISK/h → 目标 55,000）。
 * 口径：回收批 10 m³/25s（劳动者 100%）→ 炉时 1440 m³/h；残骸计数 = 体积（乙案）。
 * 满技能行口径：残骸回收学 5（批周期 −20%，下限 60%）→ 炉时 1800 m³/h；
 *   残骸提纯学 5（保底 +40%）→ 保底 EV 乘 ×1.75（技能效果一律 5 级封顶，引擎同款 Math.min(5,…)）。
 * 彩头/碎片概率不随技能变化（每 m³ 掷骰）。
 * 输出各档保底 EV、彩头 EV（按真实市场 basePrice 均值）与守卫（彩头 ≤ 保底 10%），
 * 以及 AI 核心档（40/50/60/75%）折算行与产能/积压提示。
 * 用法：npm run salvage:econ（挂 script）
 */
import { buildSimContext } from '@whale/data'
import {
  RECYCLE_YIELD_PER_M3,
  RECYCLE_CHANCE,
  RECYCLE_BASE_MODULES,
  RECYCLE_MK2_MODULES,
  FRAGMENT_RECIPES,
  RECYCLE_BATCH_M3,
  RECYCLE_CYCLE_MS,
} from '@whale/core'

const ctx = buildSimContext()
/** 炉时（m³/h，劳动者 100%、无技能） */
const FURNACE_M3_H = Math.round(RECYCLE_BATCH_M3 * (3_600_000 / RECYCLE_CYCLE_MS))
/** 采矿参照（平衡检查中段口径——其策略均先练采矿技术 5；线性可调） */
const MINING_REF = 50_000
/** 满技能口径（Lv5，引擎封顶）：回收学 −20% 批周期 → 炉速 ×1.25；提纯学 +40% 保底 */
const REC_LV5_CYCLE = Math.max(0.6, 1 - 0.04 * 5)
const FURNACE_M3_H_FULL = Math.round(FURNACE_M3_H / REC_LV5_CYCLE)
const REFINE_LV5_MULT = 1 + 0.08 * 5
const FULL_SKILL_MULT = (FURNACE_M3_H_FULL / FURNACE_M3_H) * REFINE_LV5_MULT
/** 打捞侧满技能产能系数（供料侧提示用）：整备学 −15% 周期 → 轮次 ×1/0.85；
 * 漂流物打捞学 +60% 单轮；富集识别 1%×1.2^5 ≈ 2.49% 完好舰体 ×2 期望 */
const DIVE_LV5_MULT = 1 + 0.12 * 5
const ASSAY_LV5_EXPECT = 1 + 0.01 * Math.pow(1.2, 5)
const SALVAGE_FULL_RATE = (1 / REC_LV5_CYCLE) * DIVE_LV5_MULT * ASSAY_LV5_EXPECT

/** 池期望单价（按权重 × 矿物 baseSellPrice） */
const POOLS: Record<'common' | 'risky' | 'dire', Array<[string, number]>> = {
  common: [
    ['min-tritanium', 65],
    ['min-pyerite', 30],
    ['min-mexallon', 5],
  ],
  risky: [
    ['min-pyerite', 45],
    ['min-mexallon', 35],
    ['min-nocxium', 12],
    ['min-isotope', 8],
  ],
  dire: [
    ['min-mexallon', 30],
    ['min-nocxium', 25],
    ['min-isotope', 30],
    ['min-starcore', 13],
    ['min-darkiron', 2],
  ],
}

function poolAvgPrice(tier: keyof typeof POOLS): number {
  const rows = POOLS[tier]!
  const wSum = rows.reduce((s, [, w]) => s + w, 0)
  let v = 0
  for (const [id, w] of rows) {
    const item = ctx.items.get(id)
    v += (w / wSum) * (item?.baseSellPriceIsk ?? 0)
  }
  return v
}

function moduleAvgPrice(ids: readonly string[]): number {
  const prices = ids
    .map((id) => ctx.marketGoods.get(id)?.basePrice)
    .filter((p): p is number => typeof p === 'number' && p > 0)
  return prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
}

function main(): void {
  console.log('══ B3 回收链经济体检（锚：保底 ≈ 采矿 ×1.1）══')
  console.log(
    `采矿参照 X = ${MINING_REF.toLocaleString('zh-CN')} ISK/h（中段口径：平衡模拟策略均先练采矿技术 5）；目标保底 = ${(MINING_REF * 1.1).toLocaleString('zh-CN')} ISK/h`,
  )
  console.log(`炉时：无技能 ${FURNACE_M3_H} m³/h（批 ${RECYCLE_BATCH_M3} m³ / ${(RECYCLE_CYCLE_MS / 1000)}s）→ 满技能 ${FURNACE_M3_H_FULL} m³/h（残骸回收学 5：周期 −20%）`)
  console.log(`满技能保底乘数 = ×${FULL_SKILL_MULT.toFixed(3)}（回收学 5 炉速 ×1.25 × 提纯学 5 保底 ×${REFINE_LV5_MULT.toFixed(1)}；效果 Lv5 封顶与引擎同款）`)
  const baseAvg = moduleAvgPrice(RECYCLE_BASE_MODULES)
  const mk2Avg = moduleAvgPrice(RECYCLE_MK2_MODULES)
  console.log(`彩头池均价：基础件 ${Math.round(baseAvg).toLocaleString('zh-CN')} ISK / MK2 ${Math.round(mk2Avg).toLocaleString('zh-CN')} ISK`)
  const target = MINING_REF * 1.1
  for (const tier of ['common', 'risky', 'dire'] as const) {
    const avg = poolAvgPrice(tier)
    const ev = FURNACE_M3_H * RECYCLE_YIELD_PER_M3[tier] * avg
    const dev = ((ev - target) / target) * 100
    const full = ev * FULL_SKILL_MULT
    const fullDev = ((full - target) / target) * 100
    console.log(
      `· ${tier.padEnd(6)} 池均价 ${avg.toFixed(1).padStart(6)} ISK/单位 | Y = ${RECYCLE_YIELD_PER_M3[tier]} unit/m³ | 保底 EV/h：无技能 ${Math.round(ev).toLocaleString('zh-CN')}（偏差 ${dev.toFixed(1)}%）→ 满技能 ${Math.round(full).toLocaleString('zh-CN')}（偏差 ${fullDev.toFixed(1)}%）`,
    )
  }
  // 彩头 EV（每 m³ 概率 × 均价；MK2 仅低安池子、碎片按各自片值；概率不受技能影响）
  const baseEv = FURNACE_M3_H * RECYCLE_CHANCE.base * baseAvg
  const mk2Ev = FURNACE_M3_H * RECYCLE_CHANCE.mk2 * mk2Avg
  let fragEv = 0
  for (const moduleId of Object.keys(FRAGMENT_RECIPES)) {
    const r = FRAGMENT_RECIPES[moduleId]!
    const bpPrice = ctx.marketGoods.get(r.blueprintId)?.basePrice ?? 0
    const p = r.need === 1000 ? RECYCLE_CHANCE.fragT3 : RECYCLE_CHANCE.fragT2
    fragEv += FURNACE_M3_H * p * (bpPrice / r.need)
  }
  const bonusEv = baseEv + mk2Ev + fragEv
  console.log(`彩头 EV/h：基础件 ${Math.round(baseEv).toLocaleString('zh-CN')} + MK2(低安) ${Math.round(mk2Ev).toLocaleString('zh-CN')} + 碎片 ${Math.round(fragEv).toLocaleString('zh-CN')} ≈ ${Math.round(bonusEv).toLocaleString('zh-CN')} ISK（≤ 保底 10% = ${Math.round(target * 0.1).toLocaleString('zh-CN')}；满技能保底下占比 ≈ ${((bonusEv / (target * FULL_SKILL_MULT)) * 100).toFixed(1)}%）`)
  console.log('AI 核心档折算（炉周期 ÷ 效率，再乘技能项）：' + [0.4, 0.5, 0.6, 0.75].map((e) => `${Math.round(e * 100)}% → 无技能 ${Math.round(target * e).toLocaleString('zh-CN')} / 满技能 ${Math.round(target * e * FULL_SKILL_MULT).toLocaleString('zh-CN')} ISK/h`).join('；'))
  console.log('供料侧（打捞，技能 5：整备学 −15% 周期 + 漂流物打捞学 +60% 单轮 + 富集识别 ~+2.5% 期望 → 产能 ≈ ×1.93）：')
  console.log('  · 4×MK1 低密度(mul≈1) ≈ 3.9k → 满技能 ≈ 7.5k m³/h；满技能炉速 1800 m³/h → 仍富余（仓库缓冲，AI 炉可 24/7）；')
  console.log('  · 深空平衡密度(mul≈3.6)：无技能 ≈ 14k → 满技能 ≈ 27k m³/h → 炉速仍是瓶颈，积压明显——批容量为 P3 旋钮（如调 20 m³/批）。')
  console.log(`校准注：锚 X 的口径含「采矿技术 5」（模拟策略统一前置）；回收链两行（无技能/满技能）为同链成长差；若采矿侧再把护卫舰操作/地质学等点满，X 同步抬升 ≈ ×1.8（富凡级口径），两链满级比例仍落在 ×1 上下——目测以本表为主。`)
}

void main()
