/**
 * 组装机（制造）收益体检（正式工具，2026-09-08 二号；组装机收益调整第 1 步现状体检）。
 *
 * 背景：精炼/回收线均已按「净口径」配平并有护栏；制造（组装机）侧自 2026-09-08 取消制造费、
 * C2 现货 ≥ 材料成本护栏、劳动者制（手动/AI 核心线）后未做过整线收益体检。
 * 船长分工：组装机收益相关调整 = 大鲸鱼二号（d2 另行处理）。
 *
 * 口径（与精炼配平同源）：
 * - 材料成本 = Σ 需求数 × 矿物站内收价 baseSellPriceIsk（自产机会成本口径；技能折扣按
 *   材料学 −2%/级 × 组件标准化 −1%/级 乘算、下限 0.7——满级 ×0.7）；
 * - 产物价值双口径：① 现货基准价（市场 basePrice，自用/装备库价值）；② 市场变现 =
 *   现货 × 收购档系数 acquisitionFactorOf（common 单件 0.6L / rare 0.65L / 奇货 1.0L 等，
 *   2026-09-08 收购定档）；
 * - 耗时 = 蓝图 buildSeconds × (1 − 5%/级×工业理论) × (1 − 4%/级×批量生产学)
 *   （与 calcBuildDurationMs 同式；无技能 ×1、满技能 ×0.6）；AI 线 = ÷核心效率 ×
 *   (1 − 5%/级×工业自动化，满级 ×0.75)（AI 仅效率差，产出一件同样耗时；返航/出航无关）；
 * - 劳动者价值/h = 单件净收益 ÷ 单件耗时 × 3600（一条线同时一件；供料与市场消化另议）；
 * - **料/价 = 材料成本 ÷ 成品现货价**（2026-09-10 船长定"组装机生产的物品贩卖"平衡口径）：
 *   仓库既有同族锚 = **45%**（MK1 全线 / 民用 / 弹药 / 修理组件实测 44.8~51%），
 *   低于 40% 打 ⚠（= 成品价动过、配方没跟上——本次已按锚补齐 46 张非武器件；
 *   武器族 33~42% 属其族内一致带，不动）。
 *
 * 用法：npm run manufacture:econ
 */
import { buildSimContext } from '@whale/data'
import { acquisitionFactorOf } from '@whale/core'

const ctx = buildSimContext()

/** 满技能时间倍率（工业理论 5 × 批量生产学 5）：(1-0.05×5)×(1-0.04×5) = 0.6 */
const T_FULL = 0.6
/** 满技能材料倍率（材料学 5 × 组件标准化 5）：0.9×0.95 = 0.855 > 下限 0.7 */
const M_FULL = (1 - 0.015 * 5) * (1 - 0.008 * 5)
/** AI 自动化 5 的时间倍率（在 AI ÷效率之后再乘）：×0.75 */
const AUTO5 = 1 - 0.05 * 5
/** AI 核心效率（基础/伽马/贝塔/阿尔法） */
const EFF = { basic: 0.4, gamma: 0.5, beta: 0.6, alpha: 0.75 }

/** 市场商品（kind+refId → def；装备/舰船/蓝图书都走市场目录） */
function goodOf(kind: string, refId: string) {
  for (const g of ctx.marketGoods.values()) {
    if (g.kind === kind && g.refId === refId) return g
  }
  return undefined
}

/** 产物名与价值（units = 单次制造产出数量：弹药/修理组件等 item 类 >1，装备/舰船 = 1） */
function productOf(kind: 'module' | 'ship' | 'item', refId: string, units: number): { name: string; base: number; acq: number; acqRatio: number } {
  const good = goodOf(kind, refId)
  const base = (good?.basePrice ?? 0) * units
  const acqRatio = good ? acquisitionFactorOf(good) : 0
  return {
    name: kind === 'module' ? (ctx.modules.get(refId)?.name ?? refId) : kind === 'ship' ? (ctx.ships.get(refId)?.name ?? refId) : (ctx.items.get(refId)?.name ?? refId),
    base,
    acq: Math.round(base * acqRatio),
    acqRatio,
  }
}

/** 材料成本（收价口径；matMult = 技能折扣） */
function materialCost(materials: ReadonlyArray<{ itemId: string; count: number }>, matMult: number): number {
  let sum = 0
  for (const m of materials) {
    const item = ctx.items.get(m.itemId)
    sum += Math.max(1, Math.floor(m.count * matMult)) * (item?.baseSellPriceIsk ?? 0)
  }
  return sum
}

/** 单件净收益（现货口径 netBase / 变现口径 netAcq）与每小时（一条线一件） */
function rows(
  bpId: string,
  name: string,
  materials: ReadonlyArray<{ itemId: string; count: number }>,
  buildSeconds: number,
  kind: 'module' | 'ship' | 'item',
  refId: string,
  units: number,
): void {
  const p = productOf(kind, refId, units)
  const mat0 = materialCost(materials, 1)
  const mat5 = materialCost(materials, M_FULL)
  const sec0 = buildSeconds
  const sec5 = Math.round(buildSeconds * T_FULL)
  const net0Base = p.base - mat0
  const net0Acq = p.acq - mat0
  const net5Base = p.base - mat5
  const net5Acq = p.acq - mat5
  const grossPct = mat0 > 0 ? Math.round((net0Base / mat0) * 100) : 0
  // 料/价（2026-09-10 补锚口径）：仓库既有同族锚 = 45%（MK1/民用/弹药/修理组件实测 44.8~51%），
  // 低于 40% 视为"价动了、配方没跟上"（本次已按锚补齐 46 张非武器件；武器族 33~42% 属族内一致带，不动）
  const matRatioPct = p.base > 0 ? Math.round((mat0 / p.base) * 1000) / 10 : 0
  const ratioFlag = matRatioPct < 40 ? '⚠' : ''
  const h = (net: number, sec: number): number => Math.round((net / Math.max(1, sec)) * 3600)
  const aiSec = (sec: number, eff: number): number => Math.round((sec / eff) * AUTO5)
  console.log(
    `${bpId.padEnd(10)} ${name.padEnd(14)} 毛利${grossPct}% 料/价${matRatioPct}%${ratioFlag} 材料${mat0}/${mat5} ` +
      `现货${p.base}→收${p.acq}(${p.acqRatio}) 耗时${sec0}s/${sec5}s ` +
      `净/h(现货):无技${h(net0Base, sec0)} 满技${h(net5Base, sec5)} AI基础${h(net5Base, aiSec(sec5, EFF.basic))}` +
      ` AI阿尔法${h(net5Base, aiSec(sec5, EFF.alpha))} ` +
      `净/h(变现):无技${h(net0Acq, sec0)} 满技${h(net5Acq, sec5)} AI基础${h(net5Acq, aiSec(sec5, EFF.basic))}`,
  )
}

console.log('=== 组装机(制造)收益体检（2026-09-08 二号；口径见工具头注）===')
console.log('—— 装备/物品蓝图 ——')
for (const [bpId, bp] of ctx.blueprints) {
  if (bp.moduleId) rows(bpId, ctx.modules.get(bp.moduleId)?.name ?? bpId, bp.materials, bp.buildSeconds, 'module', bp.moduleId, 1)
  else if (bp.itemId) rows(bpId, ctx.items.get(bp.itemId)?.name ?? bpId, bp.materials, bp.buildSeconds, 'item', bp.itemId, bp.outputUnits ?? 1)
}
console.log('—— 舰船蓝图 ——')
for (const [bpId, bp] of ctx.shipBlueprints) {
  if (bp.shipId) rows(bpId, ctx.ships.get(bp.shipId)?.name ?? bpId, bp.materials, bp.buildSeconds, 'ship', bp.shipId, 1)
}
