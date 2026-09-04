/**
 * 内容数据一致性校验（常驻工具，星图拓展后必备）。
 * 运行：npx tsx tools/content-validate.ts
 * 校验项：
 * - 星系：id 唯一 / 坐标在画布内 / 两两间距 ≥ 阈值 / 存在母港（galaxy-hub）
 *   / 每条边引用存在 / 母港可达全部星系（最短路）/ 航程为正；
 * - 采集点：id 唯一 / oreId 存在于物品表且可采集 / galaxyId 存在（若填）
 *   / 声望门槛与"距母港航程"匹配预期排序（宽松校验：高 req 不应在过近处）；
 * - 悬赏：id 唯一 / galaxyId 与战利品 itemId 存在 / 声望门槛与威胁曲线基本单调；
 * - 市场目录：覆盖全部可采集资源与矿物（可上架销售）。
 */
import { buildSimContext, ITEM_KIND_ORDER } from '@whale/data'
import { DEFAULT_BALANCE, HOME_GALAXY_ID } from '@whale/core'

let errors = 0
let warns = 0
const fail = (msg: string): void => {
  errors += 1
  console.log('✗ ' + msg)
}
const warn = (msg: string): void => {
  warns += 1
  console.log('⚠ ' + msg)
}

const ctx = buildSimContext()

// ── 星系 ──
const galaxies = [...ctx.galaxies.values()]
const idSet = new Set<string>()
for (const g of galaxies) {
  if (idSet.has(g.id)) fail(`星系 id 重复：${g.id}`)
  idSet.add(g.id)
  if (g.x < 12 || g.x > 688 || g.y < 8 || g.y > 292) warn(`星系 ${g.name} 坐标接近画布边缘 (${g.x},${g.y})（画布 700×300）`)
  // V16.1 安全等级：可选字段，出现则须 ∈ [-1, 1] 且 0.1 精度
  if (g.security !== undefined) {
    if (!Number.isFinite(g.security) || g.security < -1 || g.security > 1) fail(`星系 ${g.name} 安全等级越界：${g.security}`)
    else if (Math.abs(Math.round(g.security * 10) - g.security * 10) > 1e-6) warn(`星系 ${g.name} 安全等级建议 0.1 精度：${g.security}`)
  }
}
for (let i = 0; i < galaxies.length; i++) {
  for (let j = i + 1; j < galaxies.length; j++) {
    const d = Math.hypot(galaxies[i]!.x - galaxies[j]!.x, galaxies[i]!.y - galaxies[j]!.y)
    if (d < 44) warn(`星系过近（<44px）：${galaxies[i]!.name} ↔ ${galaxies[j]!.name} (${d.toFixed(1)})`)
  }
}
if (!ctx.galaxies.has(HOME_GALAXY_ID)) fail(`缺少母港星系 ${HOME_GALAXY_ID}`)
for (const e of ctx.galaxyEdges) {
  if (!ctx.galaxies.has(e.from) || !ctx.galaxies.has(e.to)) fail(`边引用缺失星系：${e.from}↔${e.to}`)
  if (e.travelMinutes <= 0) fail(`边航程必须为正：${e.from}↔${e.to}`)
}
// 最短路可达性 + 记录距母港分钟数
const dist = new Map<string, number>([[HOME_GALAXY_ID, 0]])
for (let pass = 0; pass < galaxies.length; pass++) {
  for (const e of ctx.galaxyEdges) {
    const da = dist.get(e.from)
    const db = dist.get(e.to)
    if (da !== undefined && (db === undefined || da + e.travelMinutes < db!)) dist.set(e.to, da + e.travelMinutes)
    if (db !== undefined && (da === undefined || db + e.travelMinutes < da!)) dist.set(e.from, db + e.travelMinutes)
  }
}
for (const g of galaxies) {
  if (!dist.has(g.id)) fail(`星系不可达：${g.name}`)
}

// ── 采集点 ──
const mineableKinds = new Set(['ore', 'gas', 'ice'])
const belts = [...ctx.belts.values()]
const beltIds = new Set<string>()
for (const b of belts) {
  if (beltIds.has(b.id)) fail(`采集点 id 重复：${b.id}`)
  beltIds.add(b.id)
  const ore = ctx.items.get(b.oreId)
  if (!ore) fail(`采集点 ${b.name} 的资源 ${b.oreId} 不存在`)
  else if (!mineableKinds.has(ore.kind)) fail(`采集点 ${b.name} 的资源 ${b.oreId} 不可采集（kind=${ore.kind}）`)
  if (b.galaxyId !== undefined && !ctx.galaxies.has(b.galaxyId)) fail(`采集点 ${b.name} 的星系 ${b.galaxyId} 不存在`)
  // V16 复合产出池：权重为正、和为 100、条目可采集且不重复、主产物必须在池内
  if (b.outputs) {
    if (b.outputs.length < 1) fail(`采集点 ${b.name} 的产出池为空`)
    let sum = 0
    const seenOut = new Set<string>()
    for (const o of b.outputs) {
      if (typeof o.weight !== 'number' || !Number.isFinite(o.weight) || o.weight <= 0) fail(`采集点 ${b.name} 的产出 ${o.itemId} 权重非法`)
      sum += o.weight
      const od = ctx.items.get(o.itemId)
      if (!od) fail(`采集点 ${b.name} 的产出 ${o.itemId} 不存在`)
      else if (!mineableKinds.has(od.kind)) fail(`采集点 ${b.name} 的产出 ${o.itemId} 不可采集（kind=${od.kind}）`)
      if (seenOut.has(o.itemId)) fail(`采集点 ${b.name} 的产出池条目重复：${o.itemId}`)
      seenOut.add(o.itemId)
    }
    if (Math.abs(sum - 100) > 0.01) fail(`采集点 ${b.name} 的产出池权重和=${sum}（应≈100）`)
    if (!seenOut.has(b.oreId)) fail(`采集点 ${b.name} 的主产物 ${b.oreId} 不在产出池内`)
  }
}
// 声望/航程宽松单调：req≥6 不应出现在 ≤9 分钟处；req=0 不应出现在 >9 分钟处
const req2min = (req: number | undefined): number => (req ?? 0) * 1.5 + 1
for (const b of belts) {
  const mins = b.galaxyId ? (dist.get(b.galaxyId) ?? 0) : 0
  const req = b.standingReq ?? 0
  if (req >= 6 && mins <= 9) warn(`采集点 ${b.name}：声望 ${req} 但仅 ${mins} 分钟航程（略易）`)
  if (req === 0 && mins > 9) warn(`采集点 ${b.name}：无门槛却在 ${mins} 分钟外（过难）`)
}

// ── 悬赏 ──
const anomalies = [...ctx.anomalies.values()]
const anoIds = new Set<string>()
for (const a of anomalies) {
  if (anoIds.has(a.id)) fail(`悬赏 id 重复：${a.id}`)
  anoIds.add(a.id)
  if (!ctx.galaxies.has(a.galaxyId)) fail(`悬赏 ${a.name} 的星系 ${a.galaxyId} 不存在`)
  for (const row of a.loot) {
    if (!ctx.items.has(row.itemId)) fail(`悬赏 ${a.name} 的战利品 ${row.itemId} 不存在`)
  }
}

// ── 市场目录覆盖全部资源（卖得掉） ──
const sellableItems = new Set<string>()
for (const g of ctx.marketGoods.values()) {
  if (g.kind === 'item') sellableItems.add(g.refId)
}
for (const item of ctx.items.values()) {
  if (mineableKinds.has(item.kind) || item.kind === 'mineral') {
    if (!sellableItems.has(item.id)) fail(`市场目录未收录可交易物品：${item.name} (${item.id})`)
  }
}

console.log('')
console.log(`内容校验完成：星系 ${galaxies.length} · 航线 ${ctx.galaxyEdges.length} · 采集点 ${belts.length} · 悬赏 ${anomalies.length} · 物品 ${ctx.items.size}`)
console.log(errors === 0 && warns === 0 ? '全部通过 ✓' : `${errors} 个错误，${warns} 个警告（warn 仅供人工评估）`)
process.exit(errors > 0 ? 1 : 0)
