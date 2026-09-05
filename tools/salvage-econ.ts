/**
 * B3 回收链经济体检（正式工具，P3 校准用，2026-09-05）：
 * 锚：回收链保底 EV/h（炉时 100%）≈ 采矿环 ×1.1（采矿参照 ~50,000 ISK/h → 目标 55,000）。
 * 口径：回收批 10 m³/25s（劳动者 100%）→ 炉时 1440 m³/h；残骸计数 = 体积（乙案）。
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
} from '@whale/core'

const ctx = buildSimContext()
/** 炉时（m³/h，劳动者 100%） */
const FURNACE_M3_H = 1440
/** 采矿参照（平衡检查中段口径，线性可调） */
const MINING_REF = 50_000

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
  console.log(`采矿参照 X = ${MINING_REF.toLocaleString('zh-CN')} ISK/h；目标保底 = ${(MINING_REF * 1.1).toLocaleString('zh-CN')} ISK/h（炉时 ${FURNACE_M3_H} m³/h）`)
  const baseAvg = moduleAvgPrice(RECYCLE_BASE_MODULES)
  const mk2Avg = moduleAvgPrice(RECYCLE_MK2_MODULES)
  console.log(`彩头池均价：基础件 ${Math.round(baseAvg).toLocaleString('zh-CN')} ISK / MK2 ${Math.round(mk2Avg).toLocaleString('zh-CN')} ISK`)
  for (const tier of ['common', 'risky', 'dire'] as const) {
    const avg = poolAvgPrice(tier)
    const ev = FURNACE_M3_H * RECYCLE_YIELD_PER_M3[tier] * avg
    const dev = ((ev - MINING_REF * 1.1) / (MINING_REF * 1.1)) * 100
    console.log(
      `· ${tier.padEnd(6)} 池均价 ${avg.toFixed(1).padStart(6)} ISK/单位 | Y = ${RECYCLE_YIELD_PER_M3[tier]} unit/m³ | 保底 EV/h = ${Math.round(ev).toLocaleString('zh-CN')} ISK（偏差 ${dev.toFixed(1)}%）`,
    )
  }
  // 彩头 EV（每 m³ 概率 × 均价；MK2 仅低安池子、碎片按各自片值）
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
  console.log(`彩头 EV/h：基础件 ${Math.round(baseEv).toLocaleString('zh-CN')} + MK2(低安) ${Math.round(mk2Ev).toLocaleString('zh-CN')} + 碎片 ${Math.round(fragEv).toLocaleString('zh-CN')} ≈ ${Math.round(bonusEv).toLocaleString('zh-CN')} ISK（≤ 保底 10% = ${Math.round((MINING_REF * 1.1) * 0.1).toLocaleString('zh-CN')}）`)
  console.log('AI 核心档折算（炉周期 ÷ 效率）：' + [0.4, 0.5, 0.6, 0.75].map((e) => `${Math.round(e * 100)}% → ${Math.round((MINING_REF * 1.1) * e).toLocaleString('zh-CN')} ISK/h`).join('；'))
  console.log('产能提示：4×MK1 打捞轮次 1440/h，每轮体积 = 型号单份(威胁×0.06)×max(0.5,密度/10) m³；')
  console.log('  · 常态低密度(mul≈1, 单份≈2.7 m³) ≈ 3.9k m³/h > 炉时 → 仓库缓冲，AI 炉可 24/7 后处理；')
  console.log('  · 深空平衡密度(mul≈3.6) ≈ 14k m³/h → 打捞时段远大于炉速，积压明显——批容量为 P3 旋钮（如调 20 m³/批）。')
}

void main()
