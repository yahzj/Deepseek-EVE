/**
 * 全流程模拟验证（2026-09-05 船长需求）——AI 玩家从零开始跑完整内容链：
 * 技能训练 / 采矿 / 精炼 / 制造 / 市场买卖 / 换船配装 / 悬赏远征 / 声望 / 星系探索扫描 /
 * AI 副船 / 随机事件 / 低安遭遇，直到「全部星系点亮 + DSI 声望 ≥13 +
 * 稳定击败最高 threat 96 的 ano-vault-sentinel（连打 5 局）」。
 *
 * 运行：tsx tools/playthrough-sim.ts [--max-days 60] [--real-training] [--seed 1] [--report out.json]
 *       [--goal boss|tril|collect|all]（目标制，2026-09-05 船长：boss=通关连打 5/5；
 *       tril=现金 ≥1 万亿 ISK；collect=全收集（全舰船/全可造蓝图/全装备）；all=三者都要；默认 boss）
 * 默认 debugQuick=true（技能 1s/级、扫描 1s）——聚焦系统链一致性（平衡归二号 C4）。
 * 在独立副本钉死基线运行；主仓库并行开发不受干扰。
 * v1.1（B3 + 目标制）：AI 打捞任务（轮换、单趟自动返港）+ 主控低频打捞会话 + 残骸回收炉
 *   （打捞五技能效果随实际作业被触发：整备/漂流物/富集识别走打捞，回收/提纯走炉）；
 *   目标达成或天数上限/终局受阻黑洞即止。v1.0：主链 = 训练/采矿/市场/精炼/制造/换船/战斗/声望/探索/AI 采矿。
 */
import { writeFileSync } from 'node:fs'
import {
  aiSlotsUsed,
  assignAiMining,
  assignAiSalvage,
  battleWinPreview,
  bountyCooldownRemainingMs,
  buyAtMarket,
  buyBasicAiCore,
  buyShip,
  cancelAiTask,
  cancelStandby,
  changeShip,
  countAiCore,
  countItem,
  countModule,
  countWare,
  createInitialState,
  advanceGame,
  enqueueSkill,
  fitModule,
  findBuildable,
  fleetDefOf,
  frontierGalaxyIds,
  goStandbyAt,
  HOME_GALAXY_ID,
  idleAiShipIds,
  isAtHome,
  isExplored,
  learnBlueprint,
  marketSellHolding,
  maxAiSlots,
  missingMaterials,
  oreAvailable,
  ownsBlueprint,
  recallExpedition,
  salvagerCyclesOf,
  setMiningAutoCycle,
  startExpedition,
  startManufacturing,
  startMining,
  startRecycleRun,
  startSalvageOp,
  startRefineRun,
  standingOf,
  startScan,
  startTransitHome,
  stopMining,
  stopSalvageOp,
  stopScan,
  unfitAt,
  unloadCargoToWarehouse,
  DSI_FACTION_ID,
} from '@whale/core'
import type { GameState, SimContext, AnomalyDef, ShipDef } from '@whale/core'
import { buildSimContext } from '@whale/data'

const ARGS = process.argv.slice(2)
const argVal = (name: string, dflt: number): number => {
  const i = ARGS.indexOf(name)
  return i >= 0 && ARGS[i + 1] !== undefined ? Number(ARGS[i + 1]) : dflt
}
const MAX_DAYS = argVal('--max-days', 60)
const SEED = argVal('--seed', 20260905)
const REAL_TRAINING = ARGS.includes('--real-training')
const REPORT_IDX = ARGS.indexOf('--report')
const REPORT = REPORT_IDX >= 0 ? ARGS[REPORT_IDX + 1] : null

/** 目标制（--goal boss|tril|collect|all；可逗号组合；默认 boss=原通关语义） */
const GOAL_IDX = ARGS.indexOf('--goal')
const GOAL_RAW = GOAL_IDX >= 0 ? ARGS[GOAL_IDX + 1] : 'boss'
const goalSet = new Set(GOAL_RAW.split(',').map((s) => s.trim()))
const WANTS = {
  boss: goalSet.has('all') || goalSet.has('boss'),
  tril: goalSet.has('all') || goalSet.has('tril'),
  collect: goalSet.has('all') || goalSet.has('collect'),
}
const GOAL_NAMES: Record<'boss' | 'tril' | 'collect', string> = {
  boss: '通关：终局悬赏连打 5/5',
  tril: '万亿现金：钱包 ≥1,000,000,000,000 ISK',
  collect: '全收集：全舰船 + 全可造蓝图 + 全装备',
}

const ctx: SimContext = buildSimContext()
const state: GameState = createInitialState({ nowWallMs: Date.now(), seed: SEED })
state.debugQuick = !REAL_TRAINING
const MAX_MS = MAX_DAYS * 86_400_000
const STEP_MS = 60_000

/* ═══════════ 目录与计划 ═══════════ */
const GALAXY_IDS = [...ctx.galaxies.keys()]
const BELT_LIST = [...ctx.belts.values()]
  .map((b) => ({ b, value: beltValue(b) }))
  .sort((a, b) => b.value - a.value)
const ANOMALY_LIST = [...ctx.anomalies.values()].filter((a) => !a.hidden)
const SHIP_LIST = [...ctx.ships.values()].filter((s) => s.role === 'armed' || s.role === 'armored').sort((a, b) => a.priceIsk - b.priceIsk)
const AMMO_KEYS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']
const AMMO_GOODS = [...ctx.marketGoods.values()].filter((g) => AMMO_KEYS.includes(g.refId))

function beltValue(b: { oreId: string; outputs?: ReadonlyArray<{ itemId: string; weight: number }> }): number {
  const rows = b.outputs?.length ? b.outputs : [{ itemId: b.oreId, weight: 1 }]
  const ws = rows.reduce((s, r) => s + r.weight, 0)
  return rows.reduce((s, r) => s + (ctx.items.get(r.itemId)?.baseSellPriceIsk ?? 0) * (r.weight / ws), 0)
}

function standing(): number {
  return standingOf(state, DSI_FACTION_ID)
}
function exploredCount(): number {
  return GALAXY_IDS.filter((g) => isExplored(state, g)).length
}
function isHome(): boolean {
  return isAtHome(state)
}
function meBusy(): boolean {
  return (
    state.mining.active ||
    state.expedition.active ||
    state.scanning.active ||
    state.standby.active ||
    state.transit.active ||
    (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) ||
    state.encounter.active
  )
}

/* ═══════════ 收集与里程碑 ═══════════ */
const issuesRaw = new Map<string, number>()
function issue(text: string): void {
  issuesRaw.set(text, (issuesRaw.get(text) ?? 0) + 1)
}
const milestones: string[] = []
const milestoneSeen = new Set<string>()
let lastLogIdx = 0
let lastAuditMs = -300_000
let soldTotal = 0
const LOG_KINDS = new Set(['info', 'warn', 'error', 'trade', 'queue', 'levelup', 'combat', 'explore', 'system', 'encounter'])

function day(): number {
  return state.gameMs / 86_400_000
}
function mark(msg: string): void {
  if (milestoneSeen.has(msg)) return
  milestoneSeen.add(msg)
  milestones.push(`[${day().toFixed(2)}d] ${msg}`)
}

function auditLogs(): void {
  for (let i = lastLogIdx; i < state.logs.length; i++) {
    const l = state.logs[i]!
    if (!LOG_KINDS.has(l.kind)) issue(`日志未知 kind「${l.kind}」：${l.text.slice(0, 100)}`)
    else if (l.kind === 'warn' || l.kind === 'error') issue(`引擎[${l.kind}] ${l.text.slice(0, 150)}`)
  }
  lastLogIdx = state.logs.length
}

function audit(): void {
  const bad = (label: string, v: number): void => {
    if (!Number.isFinite(v) || v < 0 || v > 1e15) issue(`${label} 异常 ${v}`)
  }
  bad('钱包', state.wallet.isk)
  for (const [k, v] of Object.entries(state.warehouse.items)) {
    if (v < 0 || !Number.isFinite(v)) issue(`仓库 ${k} = ${v}`)
    // B3 乙案：残骸计数 = 体积（打捞单轮可为小数 m³）——残骸类允许小数，其余物品仍须整数
    const isWreck = ctx.items.get(k)?.kind === 'wreck'
    if (!isWreck && !Number.isInteger(v)) issue(`仓库 ${k} = ${v}`)
    if (!ctx.items.has(k)) issue(`仓库引用缺失 ${k}`)
  }
  for (const [uid, f] of Object.entries(state.fleet)) {
    bad(`船${uid}耐久`, f.durability)
    for (const [k, v] of Object.entries(f.cargo ?? {})) {
      if (!ctx.items.has(k)) issue(`货仓引用缺失 ${k}`)
      if (v < 0) issue(`货仓 ${k} = ${v}`)
    }
    for (const slot of ['high', 'mid', 'low'] as const) {
      for (const m of f.fitted[slot] ?? []) {
        if (m !== null && !ctx.modules.has(m)) issue(`装配引用缺失 ${m}`)
      }
    }
  }
  for (const [k, v] of Object.entries(state.moduleBay)) {
    if (!ctx.modules.has(k)) issue(`装备库引用缺失 ${k}`)
    if (v < 0) issue(`装备库 ${k} = ${v}`)
  }
  for (const o of state.orders) {
    if (!ctx.marketGoods.has(o.good)) issue(`挂单引用缺失 ${o.good}`)
  }
  for (const k of Object.keys(state.escrowItems)) {
    if (!ctx.marketGoods.has(k)) issue(`escrow 引用缺失 ${k}`)
  }
  for (const k of Object.keys(state.blueprintStock)) {
    if (!ctx.blueprints.has(k) && !ctx.shipBlueprints.has(k)) issue(`蓝图库存引用缺失 ${k}`)
  }
  for (const k of Object.keys(state.bountyCooldowns)) {
    if (!ctx.anomalies.has(k)) issue(`冷却引用缺失 ${k}`)
  }
  for (const uid of Object.keys(state.aiAssignments)) {
    if (!state.fleet[uid]) issue(`AI 指派引用缺失 ${uid}`)
  }
}

/* ═══════════ 玩家决策动作 ═══════════ */
const TRAIN_ORDER: string[] = []
function buildTrainOrder(): void {
  if (TRAIN_ORDER.length > 0) return
  TRAIN_ORDER.push('ai-expert') // 先出 AI 名额，副船尽早开工
  const groups = ['舰船', '工业', '战斗', '工程', '贸易', '探索', '物流']
  for (const g of groups) {
    for (const s of ctx.skills.values()) {
      if (s.group === g && s.id !== 'ai-expert') TRAIN_ORDER.push(s.id)
    }
  }
}

function refillSkills(): void {
  if (state.skills.queue.length > 0) return
  buildTrainOrder()
  while (true) {
    const next = TRAIN_ORDER.shift()
    if (!next) break
    const cur = state.skills.trained[next] ?? 0
    if (cur >= 5) continue
    // 一次只排一级（T2 连锁），排队放满无妨
    const r = enqueueSkill(state, next, cur + 1, ctx.skills)
    if (!r.ok) issue(`入队失败 ${next} Lv${cur + 1}：${r.error}`)
    else if (state.skills.queue.length > 60) break
    else continue
    break
  }
  if (TRAIN_ORDER.length === 0 && state.skills.queue.length === 0) {
    // 全部练满：兜底重扫一遍（可能有失败的技能）
    for (const s of ctx.skills.values()) {
      const cur = state.skills.trained[s.id] ?? 0
      if (cur < 5) TRAIN_ORDER.push(s.id)
    }
  }
}

/** 当前待造蓝图（最便宜、有市场书、未造过）对某材料的最高需求；
 * 只保留当前一张的量（全量囤积会掐死早期现金流——2026-09-05 模拟器缺陷#2 修正） */
function currentCraftNeed(itemId: string): number {
  const bp = [...ctx.blueprints.values()]
    .filter((b) => goodOf('blueprint', b.id) !== undefined)
    .sort((a, b) => a.priceIsk - b.priceIsk)
    .find((b) => !craftedOnce.has(b.id))
  if (!bp) return 0
  for (const n of bp.materials) if (n.itemId === itemId) return n.count
  return 0
}

function sellEverything(): void {
  const moved = unloadCargoToWarehouse(state)
  if (moved > 0) mark('卸载入仓')
  for (const g of ctx.marketGoods.values()) {
    if (g.kind === 'ship' || g.kind === 'aicore' || g.kind === 'blueprint' || g.kind === 'module') continue // 装备不卖
    const def = ctx.items.get(g.refId)
    if (!def || def.kind === 'ammo' || def.kind === 'drone') continue // 弹药/无人机自用不卖
    const keep = def.kind === 'mineral' ? Math.max(120, currentCraftNeed(g.refId)) : def.kind === 'ore' || def.kind === 'gas' || def.kind === 'ice' ? 150 : 0
    const avail = Math.max(0, countWare(state, g.refId) - keep) + Math.max(0, countItem(state, g.refId) - keep)
    if (avail <= 0) continue
    const res = marketSellHolding(state, ctx, g.key, avail)
    if (!res.ok && res.error !== '没有可卖的库存。') issue(`卖出 ${g.key} 失败：${res.error}`)
    else if (res.sold > 0) {
      soldTotal += res.total
      mark(`市价卖出 ${g.key}`)
    }
  }
}

function doMine(): void {
  if (state.mining.active) return
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return
  if (state.expedition.active || state.scanning.active || state.standby.active || state.transit.active) return
  // 任意已探索星系的高价值矿带（本地带价值低，远程带采矿会自动往返）
  const pick = BELT_LIST.find(({ b }) => {
    if ((b.standingReq ?? 0) > standing()) return false
    if (b.galaxyId !== undefined && b.galaxyId !== HOME_GALAXY_ID && !isExplored(state, b.galaxyId)) return false
    return true
  })
  if (!pick) return
  const r = startMining(state, pick.b.id, ctx)
  if (r.ok) {
    setMiningAutoCycle(state, false) // 单趟：满舱返航后停下，回港决策
    mark(`采矿 ${pick.b.name}`)
  } else issue(`采矿 ${pick.b.id} 失败：${r.error}`)
}

let lastRefineDay = -99
function doRefineCraft(): void {
  // pilot 精炼限频：每 6h 至多一轮（验证链即可，避免长期占主控挡采矿/远征）
  if (day() - lastRefineDay < 0.25) return
  if (state.refineRuns.length === 0) {
    const cand = [...ctx.items.values()].find(
      (i) => (i.kind === 'gas' || i.kind === 'ice' || i.kind === 'ore') && i.refine && i.refine.length > 0 && oreAvailable(state, i.id) >= 200 && isHome(),
    )
    if (cand) {
      const r = startRefineRun(state, cand.id, 'pilot', ctx)
      if (r.ok) {
        lastRefineDay = day()
        mark(`精炼 ${cand.name}`)
      } else issue(`精炼 ${cand.id} 失败：${r.error}`)
    }
  }
  // 制造链统一由 doLearnCraft 走（市场买书→学习→造一件）；此处不再另起制造，避免同 bp 重复占产线
}

function doExplore(): void {
  if (state.scanning.active) return
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return // 主控开炉时不出港扫描
  const f = frontierGalaxyIds(state, ctx).find((g) => !isExplored(state, g))
  if (f) {
    const r = startScan(state, f, ctx)
    if (r.ok) mark(`扫描 ${f}`)
    else issue(`扫描 ${f} 失败：${r.error}`)
  }
}

/** 下一个解锁链上但星系未探的悬赏 → 返回其星系（用于指引扫描优先） */
function nextUnseenBountyGalaxy(): string | null {
  const next = ANOMALY_LIST.filter((a) => a.standingReq <= standing() + 2 && !isExplored(state, a.galaxyId)).sort((a, b) => a.standingReq - b.standingReq)[0]
  return next?.galaxyId ?? null
}

let lastAiRotateDay = -99
function doAi(): void {
  if (state.wallet.isk < 60_000) return
  const max = maxAiSlots(state, ctx)
  if (max <= 0) return
  if (countAiCore(state, 'basic') <= 0) {
    const rb = buyBasicAiCore(state, ctx)
    if (!rb.ok) return
  }
  // AI 采矿是无限循环任务（名额不自动释放）——要派打捞就得主动召回轮换：
  // 无打捞在途且采矿 ≥3 时，每天至多召回一艘采矿船腾名额（B3 打捞链覆盖用）
  if (countAiKind('salvage') < 1 && countAiKind('mining') >= 3 && day() - lastAiRotateDay >= 1.0) {
    const victim = Object.keys(state.aiAssignments).find((uid) => {
      const t = state.aiAssignments[uid]?.task
      return t && t.kind === 'mining'
    })
    if (victim) {
      if (cancelAiTask(state, victim, ctx)) {
        lastAiRotateDay = day()
        mark(`AI 采矿轮换：召回 ${victim} 腾打捞名额`)
      }
    }
  }
  if (aiSlotsUsed(state) >= max) return
  const idle = idleAiShipIds(state)
  if (idle.length === 0) {
    // 买一艘便宜工业船给 AI 用
    const cheap = [...ctx.ships.values()].filter((s) => s.priceIsk > 0 && s.priceIsk < 400_000).sort((a, b) => a.priceIsk - b.priceIsk)[0]
    if (cheap && state.wallet.isk > cheap.priceIsk * 2) {
      const r = buyShip(state, cheap.id, ctx)
      if (!r.ok) issue(`AI 购船 ${cheap.id} 失败：${r.error}`)
    }
    return
  }
  // B3：有打捞点（星系有残骸池）时采矿只占 3 名，其余名额留给打捞轮换（船没打捞器可现场补装）；
  // 无打捞点时全部名额采矿，避免闲置
  const salvagable = salvageGalaxyPick() !== null
  const reserve = salvagable ? Math.min(2, Math.max(0, max - 3)) : 0
  const miningN = countAiKind('mining')
  if (miningN < max - reserve) {
    // 采矿：只派母港/已探明星系的矿带
    const belt = BELT_LIST.find(({ b }) => {
      if ((b.standingReq ?? 0) > standing()) return false
      if (b.galaxyId !== undefined && b.galaxyId !== HOME_GALAXY_ID && !isExplored(state, b.galaxyId)) return false
      return true
    })
    if (belt) {
      const r = assignAiMining(state, idle[0]!, 'basic', belt.b.id, ctx)
      if (!r.ok) issue(`AI 采矿指派失败：${r.error}`)
      else mark(`AI 副船采矿 ${belt.b.id}`)
    }
    return
  }
  // 打捞名额：优先用已装打捞器的空闲船；没有则现场补装（驾驶切过去装 1 台再切回）后派发
  const gal = salvageGalaxyPick()
  if (!gal) return
  for (let tries = 0; tries < Math.min(3, idle.length); tries++) {
    const ship = idle[tries]!
    const hasGear = (state.fleet[ship]?.fitted?.high ?? []).some((m) => m && ctx.modules.get(m)?.slot === 'salvager')
    if (!hasGear && !fitSalvagersTo(ship)) continue
    const r = assignAiSalvage(state, ship, 'basic', gal, ctx)
    if (r.ok) {
      act.aiSalvage++
      mark(`AI 副船打捞 ${ctx.galaxies.get(gal)?.name ?? gal}`)
      return
    }
    if (r.error?.includes('打捞器')) continue // 换下一艘试（装配没成功的场合）
    issue(`AI 打捞指派失败（${ship} → ${gal}）：${r.error}`)
    return
  }
}

/**
 * 驾驶船策略：在港空闲时始终换驾舰队里最强武装/装甲船（powerBonus 最高）。
 * 修复 v1.0 缺陷：useFreeFalconet 每次回港都把驾驶切回白送隼枭，导致升级船永远只停在仓库、
 * 终局战力被免费艇封顶（顶配 68% 黑洞——2026-09-05 记录，模拟器自身策略缺陷）。
 */
function useFreeFalconet(): void {
  if (meBusy() || !isHome() || (state.refineRuns.some((r) => r.active && r.worker === 'pilot'))) return
  if (state.mining.active || state.expedition.active || state.scanning.active || state.salvaging.active) return
  const cur = fleetDefOf(state, ctx, state.shipId)
  let best: { uid: string; power: number } | null = null
  for (const [uid, f] of Object.entries(state.fleet)) {
    if (state.aiAssignments[uid]) continue // 副船出勤中的不抢
    const def = fleetDefOf(state, ctx, uid)
    if (!def || (def.role !== 'armed' && def.role !== 'armored')) continue
    const power = def.powerBonus ?? 0
    if (best === null || power > best.power) best = { uid, power }
  }
  if (!best) return
  const curPower = cur?.powerBonus ?? 0
  if (best.power > curPower + 0.01 && best.uid !== state.shipId) {
    const bdef = fleetDefOf(state, ctx, best.uid)
    const r = changeShip(state, best.uid, ctx)
    if (r.ok) mark(`换驾 ${bdef?.name ?? best.uid}（舰队最强，power ${best.power.toFixed(2)}）`)
  }
}

/** 按品质降序找某个装备家族的成员（用于自动配装） */
function familyBest(
  slot: string,
  quality: (m: { shieldHpBonus?: number; armorHpBonus?: number }) => number,
): { id: string; name: string } | undefined {
  const pool = [...ctx.modules.values()]
    .filter((m) => m.slot === slot && m.rack !== 'high')
    .sort((a, b) => quality(b) - quality(a))
  const top = pool[0]
  return top ? { id: top.id, name: top.name } : undefined
}

/** 给当前驾驶船自动配装：高槽武器 + 中槽盾 + 低槽甲 + 支援件（逐件尝试，CPU 超了就跳过） */
function autoFitGear(): void {
  const cur = fleetDefOf(state, ctx, state.shipId)
  if (!cur) return
  const fitted = state.fleet[state.shipId]?.fitted
  if (!fitted) return
  const allFitted = [...fitted.high, ...fitted.mid, ...fitted.low].filter((x): x is string => x !== null)
  const roomIn = (rack: 'high' | 'mid' | 'low'): boolean => fitted[rack].filter((x) => x !== null).length < (cur.slots?.[rack] ?? 0)
  // 高槽武器（动能）：空位装买得起的最低档；已有旧枪则升级到买得起最高档
  const GUN_TIERS = ['mod-turret-kin-3', 'mod-turret-kin-2', 'mod-turret-kin-1'] // 高档在前
  const gunGood = (id: string): { key: string; price: number } | undefined => {
    const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'module' && x.refId === id)
    return g ? { key: g.key, price: g.basePrice ?? 100_000 } : undefined
  }
  const highCap = cur.slots?.high ?? 1
  for (let i = 0; i < highCap; i++) {
    const curGun = fitted.high[i]
    if (!curGun) {
      for (const gunId of ['mod-turret-kin-1', 'mod-turret-kin-2', 'mod-turret-kin-3']) {
        const g = gunGood(gunId)
        if (!g) continue
        if (state.wallet.isk < g.price * 1.5 + 20_000) continue
        buyAtMarket(state, ctx, g.key, 1)
        if (fitModuleTo(state, gunId)) {
          mark(`装配 ${gunId}`)
          break
        }
      }
    } else {
      const curTier = GUN_TIERS.indexOf(curGun)
      if (curTier < 0) continue
      for (const gunId of GUN_TIERS) {
        const tier = GUN_TIERS.indexOf(gunId)
        if (tier >= curTier) continue
        const g = gunGood(gunId)
        if (!g) continue
        if (state.wallet.isk < g.price * 1.5 + 20_000) continue
        unfitAt(state, 'high', i)
        buyAtMarket(state, ctx, g.key, 1)
        if (fitModuleTo(state, gunId)) {
          mark(`升级武器 ${gunId}`)
          break
        }
        fitModuleTo(state, curGun) // 装不回退旧枪
      }
    }
  }
  // 单件补强：只装一件，已有同 id 或槽满即跳过（防重复购买抽血）
  const tryOne = (rack: 'high' | 'mid' | 'low', defId: string, priceRef: number): void => {
    if (allFitted.includes(defId) || !roomIn(rack)) return
    if (state.wallet.isk < priceRef * 1.5 + 20_000) return
    buyAtMarket(state, ctx, [...ctx.marketGoods.values()].find((x) => x.kind === 'module' && x.refId === defId)!.key, 1)
    if (fitModuleTo(state, defId)) mark(`装配 ${defId}`)
  }
  const sh = familyBest('shield', (m) => m.shieldHpBonus ?? 0)
  if (sh) tryOne('mid', sh.id, [...ctx.marketGoods.values()].find((x) => x.refId === sh.id)?.basePrice ?? 50_000)
  const ar = familyBest('armor', (m) => m.armorHpBonus ?? 0)
  if (ar) tryOne('low', ar.id, [...ctx.marketGoods.values()].find((x) => x.refId === ar.id)?.basePrice ?? 50_000)
  const sup1 = [...ctx.modules.values()].find((m) => m.slot === 'support' && (m.damageTypeBonusPct?.kinetic ?? 0) > 0)
  const sup2 = [...ctx.modules.values()].find((m) => m.slot === 'support' && (m.hitBonusPct ?? 0) > 0)
  if (sup1) tryOne('mid', sup1.id, [...ctx.marketGoods.values()].find((x) => x.refId === sup1.id)?.basePrice ?? 30_000)
  if (sup2) tryOne('mid', sup2.id, [...ctx.marketGoods.values()].find((x) => x.refId === sup2.id)?.basePrice ?? 30_000)
}

const craftedOnce = new Set<string>()
/** 蓝图：市场买书 → 学习 → 制造一件（制造链验证一次；防重复造抽血）。
 * 只处理市场有书可购的配方（碎片/原型专属配方无书，模拟不代打碎片）；无书配方跳过不卡循环。 */
function doLearnCraft(): void {
  if (state.manufacturingRuns.length > 0) return
  const bp = [...ctx.blueprints.values()]
    .filter((b) => goodOf('blueprint', b.id) !== undefined)
    .sort((a, b) => a.priceIsk - b.priceIsk)
    .find((b) => !craftedOnce.has(b.id))
  if (!bp) return
  const book = [...ctx.marketGoods.values()].find((x) => x.kind === 'blueprint' && x.refId === bp.id)
  if (book) {
    const stock = state.blueprintStock[bp.id] ?? 0
    if (stock <= 0) {
      if (state.wallet.isk < book.basePrice + 30_000) return
      buyAtMarket(state, ctx, book.key, 1)
      return
    }
  }
  if (!ownsBlueprint(state, bp.id)) {
    const r = learnBlueprint(state, ctx, bp.id)
    if (r.ok) {
      act.learnBp++
      mark(`学习蓝图 ${bp.name}`)
    } else issue(`学习蓝图 ${bp.id} 失败：${r.error}`)
    return
  }
  // 缺料直接市场补：材料条目从蓝图定义取（missingMaterials 只返回人话提示，不能当数据用——
  // 一号 v1.0 的 m.itemId/m.count 循环从不买料，导致制造永不启动：模拟器自身缺陷，2026-09-05 修）
  const bld = findBuildable(ctx, bp.id)
  if (!bld) return
  if (state.wallet.isk < bld.spec.buildCostIsk + 50_000) return // 制造费不足：先攒钱（不再反复失败刷异常）
  if (bld.spec.materials.some((n) => countWare(state, n.itemId) < n.count)) {
    for (const n of bld.spec.materials) {
      const have = countWare(state, n.itemId)
      const want = n.count - have
      if (want <= 0) continue
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === n.itemId)
      if (g && state.wallet.isk > (g.basePrice ?? 10) * want * 2) buyAtMarket(state, ctx, g.key, want)
    }
    return
  }
  const r = startManufacturing(state, bp.id, ctx)
  if (r.ok) {
    craftedOnce.add(bp.id)
    act.craft++
    mark(`制造 ${bp.name}`)
  } else issue(`制造 ${bp.id} 失败：${r.error}`)
}

let lastShipUpgradeDay = -99
function buyShipAndGear(): void {
  if (meBusy() || !isHome() || state.mining.active) return
  const curDef = fleetDefOf(state, ctx, state.shipId)
  // 升级船（武装族）：只买"尚未拥有"且更强 powerBonus 的船；每天至多尝试一次
  if (curDef && day() - lastShipUpgradeDay >= 1) {
    const owned = new Set<string>()
    for (const f of Object.values(state.fleet)) if (f?.defId) owned.add(f.defId)
    const target = [...ctx.ships.values()]
      .filter(
        (s) =>
          s.role === 'armed' &&
          (s.powerBonus ?? 0) > (curDef.powerBonus ?? 0) + 0.05 &&
          !owned.has(s.id) &&
          state.wallet.isk > s.priceIsk * 1.3 + 400_000,
      )
      .sort((a, b) => (b.powerBonus ?? 0) - (a.powerBonus ?? 0))[0]
    if (target) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'ship' && x.refId === target.id)
      if (g) {
        const got = buyAtMarket(state, ctx, g.key, 1)
        if (got.shipUid) {
          const r = changeShip(state, got.shipUid, ctx)
          if (r.ok) {
            lastShipUpgradeDay = day()
            mark(`换驾 ${target.name}`)
          }
        }
      }
    }
  }
  // 弹药补货
  for (const g of AMMO_GOODS) {
    if (countWare(state, g.refId) < 500) {
      const want = 1000 - countWare(state, g.refId)
      if (state.wallet.isk > want * g.basePrice * 2 + 30_000) buyAtMarket(state, ctx, g.key, want)
    }
  }
  // 无人机补给（装配外战力：bay 自动放飞；drone-sentry/assault/heavy 各备 5 架）
  for (const droneId of ['drone-sentry', 'drone-heavy', 'drone-assault']) {
    if (countWare(state, droneId) < 5 && state.wallet.isk > 1_000_000) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === droneId)
      if (g) buyAtMarket(state, ctx, g.key, 5 - countWare(state, droneId))
    }
  }
  autoFitGear()
}

function fitModuleTo(state: GameState, moduleId: string): boolean {
  const r = fitModule(state, moduleId, ctx)
  return r.ok
}

function doBounty(): void {
  if (state.expedition.active || state.encounter.active || state.transit.active || state.standby.active || state.scanning.active) return
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return
  // 只打：未首胜（推进声望）+ 门槛达标 + 星系已探索 + 非冷却 + 有把握
  const canDo = ANOMALY_LIST.filter(
    (a) =>
      !state.completedBounties.includes(a.id) &&
      a.standingReq <= standing() &&
      isExplored(state, a.galaxyId) &&
      bountyCooldownRemainingMs(state, a.id) <= 0,
  )
  if (canDo.length === 0) return
  let best: AnomalyDef | null = null
  let bestScore = 0.5
  for (const a of canDo) {
    const w = battleWinPreview(state, ctx, a)
    if (w > bestScore) {
      bestScore = w
      best = a
    }
  }
  if (!best) return
  const r = startExpedition(state, best.id, ctx)
  if (r.ok) mark(`远征 ${best.name}`)
  else issue(`远征 ${best.id} 失败：${r.error}`)
}

/** 刷钱：打当前可赢的收益最高悬赏（含已首胜；boss 够强前都可用） */
function doFarm(): void {
  if (state.expedition.active || state.encounter.active || state.transit.active || state.standby.active || state.scanning.active) return
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return
  // 通关目标仍挂起时，boss 达到 85%+ 就留给「最终验证」；通关后（万亿现金目标）boss 悬赏也进刷钱池
  if (WANTS.boss && !goalDone.boss) {
    const boss = ctx.anomalies.get('ano-vault-sentinel')
    if (boss && battleWinPreview(state, ctx, boss) >= 0.85) return
  }
  const candidates = ANOMALY_LIST.filter(
    (a) => isExplored(state, a.galaxyId) && bountyCooldownRemainingMs(state, a.id) <= 0,
  )
    .map((a) => ({ a, w: battleWinPreview(state, ctx, a) }))
    .filter((x) => x.w > 0.6)
    .sort((x, y) => y.a.rewardIsk * y.w - x.a.rewardIsk * x.w)
  const pick = candidates[0]
  if (!pick) return
  const r = startExpedition(state, pick.a.id, ctx)
  if (r.ok) {
    if (state.gameMs - lastFarmMark > 43_200_000) {
      lastFarmMark = state.gameMs
      mark(`刷钱：远征 ${pick.a.name}（胜率 ${Math.round(pick.w * 100)}%）`)
    }
  } else issue(`刷钱远征 ${pick.a.id} 失败：${r.error}`)
}
let lastFarmMark = -86_400_000

function goHomeIfAway(): void {
  if (state.awayGalaxy === null || state.awayGalaxy === HOME_GALAXY_ID) return
  if (state.standby.active || state.transit.active) return
  if (state.scanning.active || state.expedition.active || state.mining.active) return
  const r = startTransitHome(state, ctx)
  if (!r.ok) {
    const r2 = goStandbyAt(state, HOME_GALAXY_ID, ctx)
    if (!r2.ok) issue(`返航失败：${r.error}`)
  }
}

function homeLull(): boolean {
  // 人在母港且不占着远程作业（采矿往返间歇也允许卖货/购物/开炉由引擎互斥把关）
  return (
    state.awayGalaxy === null &&
    isHome() &&
    !state.expedition.active &&
    !state.scanning.active &&
    !state.standby.active &&
    !state.transit.active &&
    !state.encounter.active
  )
}

/* ═══════════ 目标制（boss 通关 / 万亿现金 / 全收集） ═══════════ */
const goalDone = { boss: false, tril: false, collect: false }
const goalDay: Record<string, string> = {}
/** B3/工业 覆盖计数（报告「活动统计」用） */
const act = { aiSalvage: 0, pilotSalvage: 0, recycle: 0, craft: 0, learnBp: 0 }

function goodOf(kind: string, refId: string): { key: string; basePrice: number } | undefined {
  const g = [...ctx.marketGoods.values()].find((x) => x.kind === kind && x.refId === refId)
  return g ? { key: g.key, basePrice: g.basePrice ?? 0 } : undefined
}

function collectStatus(): { ships: number; shipsTotal: number; bps: number; bpsTotal: number; mods: number; modsTotal: number } {
  const ownedShips = new Set(Object.values(state.fleet).map((f) => f?.defId).filter((x): x is string => !!x))
  const fittedMods = new Set<string>()
  for (const f of Object.values(state.fleet)) {
    for (const rack of ['high', 'mid', 'low'] as const) {
      for (const m of f?.fitted?.[rack] ?? []) if (m) fittedMods.add(m)
    }
  }
  const buyableMods = [...ctx.modules.keys()].filter((id) => goodOf('module', id))
  let ownedMods = 0
  for (const id of buyableMods) {
    if ((state.moduleBay[id] ?? 0) > 0 || fittedMods.has(id)) ownedMods++
  }
  const bpTotal = [...ctx.blueprints.keys()].filter((id) => goodOf('blueprint', id)).length
  const bpOwned = [...ctx.blueprints.keys()].filter((id) => goodOf('blueprint', id) && ownsBlueprint(state, id)).length
  return {
    ships: ownedShips.size,
    shipsTotal: ctx.ships.size,
    bps: bpOwned,
    bpsTotal: bpTotal,
    mods: ownedMods,
    modsTotal: buyableMods.length,
  }
}

function checkGoals(): void {
  if (WANTS.tril && !goalDone.tril && state.wallet.isk >= 1_000_000_000_000) {
    goalDone.tril = true
    goalDay.tril = day().toFixed(2)
    mark(`🎯 目标达成【万亿现金】：第 ${day().toFixed(2)}d 现金 ${state.wallet.isk.toLocaleString('zh-CN')} ISK`)
  }
  if (WANTS.collect && !goalDone.collect) {
    const c = collectStatus()
    if (c.ships >= c.shipsTotal && c.bps >= c.bpsTotal && c.mods >= c.modsTotal) {
      goalDone.collect = true
      goalDay.collect = day().toFixed(2)
      mark(`🎯 目标达成【全收集】：第 ${day().toFixed(2)}d 舰船 ${c.ships}/${c.shipsTotal} · 蓝图 ${c.bps}/${c.bpsTotal} · 装备 ${c.mods}/${c.modsTotal}`)
    }
  }
}

function allGoalsDone(): boolean {
  return !((WANTS.boss && !goalDone.boss) || (WANTS.tril && !goalDone.tril) || (WANTS.collect && !goalDone.collect))
}

/** 收集购物（全收集目标：缺的船/装备按最便宜的补；每次最多推进一件，防卡单步） */
function doCollectShop(): void {
  if (!WANTS.collect || goalDone.collect) return
  if (meBusy() || !isHome() || (state.refineRuns.some((r) => r.active && r.worker === 'pilot'))) return
  const ownedShips = new Set(Object.values(state.fleet).map((f) => f?.defId).filter((x): x is string => !!x))
  const missingShip = [...ctx.ships.values()].filter((s) => !ownedShips.has(s.id)).sort((a, b) => a.priceIsk - b.priceIsk)[0]
  if (missingShip) {
    const g = goodOf('ship', missingShip.id)
    if (g && state.wallet.isk > g.basePrice * 1.3 + 150_000) {
      buyAtMarket(state, ctx, g.key, 1)
      mark(`收集舰船 ${missingShip.name}`)
    }
    return
  }
  const fittedMods = new Set<string>()
  for (const f of Object.values(state.fleet)) {
    for (const rack of ['high', 'mid', 'low'] as const) {
      for (const m of f?.fitted?.[rack] ?? []) if (m) fittedMods.add(m)
    }
  }
  const missingMod = [...ctx.modules.values()]
    .filter((m) => goodOf('module', m.id) && (state.moduleBay[m.id] ?? 0) <= 0 && !fittedMods.has(m.id))
    .sort((a, b) => (goodOf('module', a.id)!.basePrice) - goodOf('module', b.id)!.basePrice)[0]
  if (missingMod) {
    const g = goodOf('module', missingMod.id)!
    if (state.wallet.isk > g.basePrice * 1.2 + 30_000) {
      buyAtMarket(state, ctx, g.key, 1)
      mark(`收集装备 ${missingMod.name}`)
    }
  }
}

/* ═══════════ B3 打捞/回收闭环（2026-09-05：AI 打捞 + 主控低频会话 + 残骸回收炉） ═══════════ */

/** 市场买一件装备入装备库（已有则直接返回 true） */
function buyOneModule(id: string): boolean {
  if (countModule(state, id) > 0) return true
  const g = goodOf('module', id)
  if (!g || state.wallet.isk < g.basePrice * 1.2 + 20_000) return false
  buyAtMarket(state, ctx, g.key, 1)
  return countModule(state, id) > 0
}

/** 已存在且空闲、装了打捞器的非驾驶船（可作为打捞作业船） */
function findSalvageShip(): string | null {
  for (const [uid, f] of Object.entries(state.fleet)) {
    if (uid === state.shipId || state.aiAssignments[uid]) continue
    for (const m of f?.fitted?.high ?? []) {
      if (m && ctx.modules.get(m)?.slot === 'salvager') return uid
    }
  }
  return null
}

/** 给某艘船的高槽装打捞器 MK1（先把驾驶切过去，装完切回；返回是否装上 ≥1 台） */
function fitSalvagersTo(uid: string): boolean {
  const f = state.fleet[uid]
  const def = fleetDefOf(state, ctx, uid)
  if (!f || !def) return false
  const high = f.fitted?.high ?? []
  for (const m of high) if (m && ctx.modules.get(m)?.slot === 'salvager') return true
  const slots = def.slots?.high ?? high.length
  if (high.filter((x) => x !== null).length >= slots) return false
  const prev = state.shipId
  if (prev !== uid) {
    const r = changeShip(state, uid, ctx)
    if (!r.ok) return false
  }
  let done = false
  for (let i = 0; i < slots && i < 4; i++) {
    if (high[i] !== null) continue
    if (!buyOneModule('mod-salvager-1')) break
    const r = fitModule(state, 'mod-salvager-1', ctx, { rack: 'high', index: i })
    if (!r.ok) break
    done = true
  }
  if (prev !== uid) {
    const r = changeShip(state, prev, ctx)
    if (!r.ok) issue(`切回驾驶船失败（${uid} → ${prev}）：${r.error}`)
  }
  return done
}

/** 确保有一艘可用的打捞作业船（缺则买最便宜的高槽船并装打捞器） */
function ensureSalvageFleet(): void {
  if (findSalvageShip()) return
  if (meBusy() || !isHome() || (state.refineRuns.some((r) => r.active && r.worker === 'pilot'))) return
  const owned = new Set(Object.values(state.fleet).map((x) => x?.defId).filter((x): x is string => !!x))
  const cand = [...ctx.ships.values()]
    .filter((s) => (s.slots?.high ?? 0) > 0 && !owned.has(s.id) && state.wallet.isk > s.priceIsk * 1.5 + 200_000)
    .sort((a, b) => a.priceIsk - b.priceIsk)[0]
  if (!cand) return
  const g = goodOf('ship', cand.id)
  if (!g) return
  const got = buyAtMarket(state, ctx, g.key, 1)
  if (!got.shipUid) return
  if (fitSalvagersTo(got.shipUid)) mark(`购入打捞作业船 ${cand.name}（打捞器 MK1）`)
}

/** 可选打捞目标星系：已探索、非母港、有敌群型号池；低安优先（彩头池更肥） */
function salvageGalaxyPick(): string | null {
  const hasPool = (id: string): boolean => {
    for (const a of ctx.anomalies.values()) if (a.galaxyId === id) return true
    return false
  }
  const list = GALAXY_IDS.filter((id) => id !== HOME_GALAXY_ID && isExplored(state, id) && hasPool(id))
  if (list.length === 0) return null
  return [...list].sort((a, b) => (ctx.galaxies.get(a)?.security ?? 0) - (ctx.galaxies.get(b)?.security ?? 0))[0]!
}

function countAiKind(kind: string): number {
  let n = 0
  for (const a of Object.values(state.aiAssignments)) {
    const t = a?.task
    if (t && t.kind === kind) n++
  }
  return n
}

/** 残骸回收炉：仓库有残骸且炉空闲就整批入炉（料尽自动停）。
 * 优先 AI 核心驱动（背景运转，主控可以继续远征/扫描/打捞；核心不足就买一颗）；
 * 只有买不起核心时才用主控亲自开炉。 */
function doRecycle(): void {
  if (state.refineRuns.length > 0 || state.mining.active || !isHome()) return
  if (countAiCore(state, 'basic') <= 0) {
    if (state.wallet.isk < 100_000) return
    buyBasicAiCore(state, ctx)
    if (countAiCore(state, 'basic') <= 0) return
  }
  const wreckIds = [...ctx.items.values()]
    .filter((i) => i.kind === 'wreck' && oreAvailable(state, i.id) >= 10)
    .sort((a, b) => oreAvailable(state, b.id) - oreAvailable(state, a.id))
  const pick = wreckIds[0]
  if (!pick) return
  const qty = Math.floor(oreAvailable(state, pick.id)) // 先读数再入炉（入炉即锁定出库）
  const r = startRecycleRun(state, pick.id, 'basic', ctx)
  if (r.ok) {
    act.recycle++
    mark(`残骸回收 ${pick.name}（${qty} m³ 入炉，AI 核心驱动）`)
  } else issue(`残骸回收失败 ${pick.id}：${r.error}`)
}

let lastPilotSalvageDay = -99
/** 主控低频打捞会话（通关就绪后隔 0.5 天一次；验证主控打捞状态机/满仓自动返港/技能乘区） */
function doPilotSalvageSession(): void {
  if (WANTS.boss && !goalDone.boss) return // 通关前不占用主控
  if (day() - lastPilotSalvageDay < 0.5) return
  if (state.salvaging.active || state.mining.active || state.expedition.active || (state.refineRuns.some((r) => r.active && r.worker === 'pilot'))) return
  const uid = findSalvageShip()
  const gal = salvageGalaxyPick()
  if (!uid || !gal) return
  const prev = state.shipId
  if (prev !== uid) {
    const r = changeShip(state, uid, ctx)
    if (!r.ok) return
  }
  const r = startSalvageOp(state, gal, ctx)
  if (!r.ok) {
    issue(`主控打捞失败（${gal}）：${r.error}`)
    if (state.shipId === uid) changeShip(state, prev, ctx)
    return
  }
  mark(`主控打捞会话 ${ctx.galaxies.get(gal)?.name ?? gal}`)
  act.pilotSalvage++
  let guard = 0
  while (state.salvaging.active && guard < 2400) {
    advanceGame(state, STEP_MS, ctx)
    auditLogs()
    guard++
  }
  // 未满仓自动结束（会话上限内截停）→ 回港把残骸卸入仓库
  if (state.salvaging.active) {
    stopSalvageOp(state, ctx)
    let g2 = 0
    while (state.awayGalaxy !== null && !meBusy() && g2 < 600) {
      goHomeIfAway()
      advanceGame(state, STEP_MS, ctx)
      g2++
    }
  }
  if (state.shipId === uid && isHome()) unloadCargoToWarehouse(state)
  if (state.shipId === uid) {
    const r2 = changeShip(state, prev, ctx)
    if (!r2.ok) issue(`打捞会话后切回驾驶失败：${r2.error}`)
  }
  lastPilotSalvageDay = day()
}

/* ═══════════ 最终目标（连打 5 局） ═══════════ */
function tryFinalRun(): boolean {
  const boss = ctx.anomalies.get('ano-vault-sentinel')!
  if (standing() < boss.standingReq) return false
  const w0 = battleWinPreview(state, ctx, boss)
  if (w0 < 0.85) return false
  mark(`最终验证：预估胜率 ${Math.round(w0 * 100)}% 连打 5 局`)
  for (let i = 0; i < 5; i++) {
    if (!isHome() && state.awayGalaxy !== null) {
      let g = 0
      while (state.awayGalaxy !== null && g < 240 && !meBusy()) {
        goHomeIfAway()
        advanceGame(state, STEP_MS, ctx)
        g++
      }
    }
    if (meBusy()) return false
    const r = startExpedition(state, 'ano-vault-sentinel', ctx)
    if (!r.ok) {
      issue(`最终局 ${i + 1} 出发失败：${r.error}`)
      return false
    }
    let guard = 0
    while (state.expedition.active && guard < 6000) {
      advanceGame(state, STEP_MS, ctx)
      auditLogs()
      guard++
    }
    auditLogs()
    if (state.expedition.active) return false
    const won = [...state.logs].reverse().some((l) => l.text.includes('大捷') && l.atGameMs >= state.gameMs - 86_400_000)
    if (!won) {
      issue(`最终局 ${i + 1} 未胜利`)
      return false
    }
    mark(`最终悬赏击败 ${i + 1}/5`)
    // 2026-09-06：胜利后自动返航回母港（去程并入返航）；连打间隙只需等回港空闲
    if (i < 4) {
      let g = 0
      while (state.awayGalaxy !== null && g < 300 && !meBusy()) {
        goHomeIfAway()
        advanceGame(state, STEP_MS, ctx)
        g++
      }
      if (state.awayGalaxy !== null && g >= 300) return false
    }
  }
  return true
}

/* ═══════════ 策略黑洞：侦测 / 记录 / 分级解救（船长 2026-09-05 定） ═══════════
 * 规则：模拟玩家陷入"黑洞"（无推进的循环）本身要记录进报告（不是引擎 bug）；
 * 但拖太久影响测试时长时按级解救：L1 清仓变现归位 → L2 注资升装 →
 * 终局前置判断：顶配武装仍打不过 boss（疑似平衡项）→ 提前终止并标注转 C4 复核。 */
const holeLogs: string[] = []
let lastMoveDay = 0
let rescueLevel = 0
let lastRescueDay = -99
let lastFp = ''
let holeEarlyExit = false
let topGearDay = -1 // 顶配达成日（终局受阻计时起点）

function progressFingerprint(): string {
  // 主线推进指纹：新首胜/新点亮/换驾驶/现金粗桶（500 万级）——纯赚钱波动不算推进
  return `${state.completedBounties.length}:${exploredCount()}:${state.shipId}:${Math.floor(state.wallet.isk / 5_000_000)}`
}

/** 返回 true = 提前终止（终局受阻判定的黑洞） */
function holeWatch(): boolean {
  const d = day()
  const cur = fleetDefOf(state, ctx, state.shipId)
  const weaponCount = (state.fleet[state.shipId]?.fitted.high ?? []).filter(Boolean).length
  const boss = ctx.anomalies.get('ano-vault-sentinel')
  const bossW = boss ? battleWinPreview(state, ctx, boss) : 0
  // 训练毕业（全部 62 技能满 5 级）才算顶配——real-training 下未毕业不算
  const trainingDone = [...ctx.skills.keys()].every((id) => (state.skills.trained[id] ?? 0) >= 5)
  // 顶配达成登记：训练毕业 + 武装船 + ≥3 武器 + 声望解锁 + 星系全亮
  if (topGearDay < 0 && trainingDone && cur?.role === 'armed' && weaponCount >= 3 && boss && standing() >= boss.standingReq && exploredCount() >= GALAXY_IDS.length) {
    topGearDay = d
  }
  // 终局受阻判定：顶配达成后 10 天仍打不过 boss（farm 循环黑洞）→ 提前终止（疑似 C4 平衡项）；
  // 仅当通关目标仍挂起时适用（万亿/全收集目标不需要打赢 boss，可继续跑）
  if (WANTS.boss && !goalDone.boss && boss && trainingDone && bossW < 0.85 && topGearDay >= 0 && d - topGearDay >= 10) {
    holeLogs.push(
      `[${d.toFixed(1)}d] 黑洞（终局受阻）：顶配武装（${cur?.name ?? state.shipId}×${weaponCount} 门，自 ${topGearDay.toFixed(1)}d 达成）对 ${boss.name} 胜率仍 ${Math.round(bossW * 100)}% < 85% ——疑似平衡项，提前终止并转 C4 复核`,
    )
    holeEarlyExit = true
    return true
  }
  const fp = progressFingerprint()
  if (fp !== lastFp) {
    lastFp = fp
    lastMoveDay = d
    rescueLevel = 0
    return false
  }
  const stuck = d - lastMoveDay
  if (stuck < 6) return false // 6 天无主线推进才算黑洞
  if (d - lastRescueDay < 3) return false // 救援冷却 3 天
  lastRescueDay = d
  rescueLevel += 1
  if (rescueLevel === 1) {
    holeLogs.push(`[${d.toFixed(1)}d] 黑洞：连续 ${stuck.toFixed(0)} 天无推进（指纹 ${fp}）→ 救援1：召回作业+清仓变现+归位采矿`)
    if (state.expedition.active) recallExpedition(state, ctx)
    if (state.scanning.active) stopScan(state, ctx)
    if (state.standby.active) cancelStandby(state, ctx)
    for (const g of ctx.marketGoods.values()) {
      if (g.kind !== 'item') continue
      const def = ctx.items.get(g.refId)
      if (!def || def.kind === 'ammo' || def.kind === 'drone' || def.kind === 'mineral') continue
      const avail = countWare(state, g.refId)
      if (avail > 0) marketSellHolding(state, ctx, g.key, avail)
    }
    lastFp = progressFingerprint()
  } else {
    const inj = rescueLevel === 2 ? Math.round(800_000 + state.wallet.isk * 0.5) : 2_000_000
    holeLogs.push(`[${d.toFixed(1)}d] 黑洞持续 → 救援${rescueLevel}：注资 ${Math.round(inj / 1000)}k ISK（${rescueLevel === 2 ? '升级船与武器' : '维持继续观察'}）`)
    state.wallet.isk += inj
    lastFp = progressFingerprint()
  }
  return false
}

/* ═══════════ 主循环（目标制：通关 / 万亿现金 / 全收集；B3 打捞回收闭环） ═══════════ */
const wall0 = Date.now()

while (state.gameMs < MAX_MS && !allGoalsDone()) {
  auditLogs()
  if (state.gameMs - lastAuditMs > 300_000) {
    audit()
    lastAuditMs = state.gameMs
  }
  refillSkills()
  if (homeLull()) {
    if (!state.mining.active) {
      sellEverything()
      useFreeFalconet()
      doRefineCraft()
      doLearnCraft()
      doAi()
      ensureSalvageFleet()
      doRecycle()
      buyShipAndGear()
      doCollectShop()
      if (standing() < 13) {
        doBounty()
        if (!state.expedition.active && !state.scanning.active) {
          doExplore() // 解锁下一批星系（无 frontier 时自然空转）
          if (!state.expedition.active && !state.scanning.active) doFarm() // 打不过新目标时先刷钱升装
        }
      } else if (exploredCount() < GALAXY_IDS.length) {
        doExplore()
      } else if (!state.expedition.active) {
        // 全部点亮 + 声望达标：按目标分流
        const bossDef = ctx.anomalies.get('ano-vault-sentinel')
        const bossW = bossDef ? battleWinPreview(state, ctx, bossDef) : 0
        if (WANTS.boss && !goalDone.boss) {
          if (bossW >= 0.85) {
            if (tryFinalRun()) {
              goalDone.boss = true
              goalDay.boss = day().toFixed(2)
              mark(`🎯 目标达成【通关】：第 ${day().toFixed(2)}d 终局悬赏连打 5/5`)
            }
          } else doFarm() // 打不过最终目标：刷高奖悬赏换钱买装备
        } else {
          doPilotSalvageSession() // B3：主控低频打捞会话（打捞技能乘区在真实作业上生效）
          // 剩余目标运营：优先打最高奖悬赏攒钱（通关后 boss 也进池，受冷却约束）；空窗采矿兜底
          if (!state.expedition.active && !state.scanning.active && !state.salvaging.active) {
            if (WANTS.tril && !goalDone.tril) doFarm()
            if (!state.expedition.active && !state.scanning.active && !state.salvaging.active && !state.mining.active) doMine()
          }
        }
      }
      // 采矿兜底（早期未就绪或打赏冷却空窗）；boss 冲刺就绪时不挖矿以免拖延最终验证
      if (!allGoalsDone() && !state.expedition.active && !state.scanning.active && !state.salvaging.active && !state.mining.active) {
        const bossDef2 = ctx.anomalies.get('ano-vault-sentinel')
        const bossW2 = bossDef2 ? battleWinPreview(state, ctx, bossDef2) : 0
        if (!(WANTS.boss && !goalDone.boss && bossW2 >= 0.85)) doMine()
      }
    } else if (state.gameMs % 1_800_000 < STEP_MS) {
      sellEverything() // 采矿往返间歇在港时卸货卖货
    }
  } else if (!meBusy()) {
    // 空闲兜底（2026-09-06：野外驻留仅来自掩护巡逻；悬赏/探索优先，随后归位/采矿由上层负责）
    if (WANTS.boss && !goalDone.boss && standing() < 13) doBounty()
    if (!state.expedition.active && standing() >= 13 && exploredCount() < GALAXY_IDS.length) doExplore()
    if (!state.expedition.active && !state.mining.active && !state.salvaging.active) goHomeIfAway()
  }
  // 进度探针（每 0.5 天）
  if (state.gameMs % (43_200_000) < STEP_MS) {
    mark(
      `进度：声望${standing()} 星系${exploredCount()}/${GALAXY_IDS.length} 现金${Math.round(state.wallet.isk / 1000)}k 船${Object.keys(state.fleet).length}艘 打捞船${findSalvageShip() ? '有' : '无'}`,
    )
  }
  // 目标检查（万亿现金 / 全收集）
  checkGoals()
  // 策略黑洞侦测（船长 2026-09-05：黑洞要记录报告；拖太久影响测试时长要分级解救）
  if (holeWatch()) break
  advanceGame(state, STEP_MS, ctx)
}

auditLogs()
audit()
checkGoals()
const wallSec = ((Date.now() - wall0) / 1000).toFixed(1)

/* ═══════════ 报告 ═══════════ */
const lines: string[] = []
lines.push('══════════ 全流程模拟报告 ═══════════')
lines.push(`debugQuick=${!REAL_TRAINING} seed=${SEED} 上限 ${MAX_DAYS} 天 目标=${GOAL_RAW}`)
const resultTxt = allGoalsDone()
  ? '✅ 目标全部达成'
  : holeEarlyExit
    ? '⏹ 提前终止（终局受阻黑洞，见策略黑洞记录）'
    : '❌ 未达成（天数上限）'
lines.push(`结果：${resultTxt}  游戏内 ${(state.gameMs / 86_400_000).toFixed(2)} 天 / 墙钟 ${wallSec}s`)
lines.push(`现金 ${Math.round(state.wallet.isk).toLocaleString('zh-CN')} ISK · DSI 声望 ${standing()} · 星系 ${exploredCount()}/${GALAXY_IDS.length} · 累计卖出 ${Math.round(soldTotal).toLocaleString('zh-CN')} ISK`)
lines.push(`训练总级数 ${Object.values(state.skills.trained).reduce((a, b) => a + b, 0)} · 队列 ${state.skills.queue.length} · 舰船 ${Object.keys(state.fleet).length} 艘 · AI 任务 ${Object.keys(state.aiAssignments).length} · 日志 ${state.logs.length} 条`)
lines.push('')
lines.push('—— 目标达成情况 ——')
for (const k of ['boss', 'tril', 'collect'] as const) {
  if (!WANTS[k]) continue
  const done = goalDone[k]
  const c = collectStatus()
  const extra = k === 'collect' ? `（舰船 ${c.ships}/${c.shipsTotal} · 蓝图 ${c.bps}/${c.bpsTotal} · 装备 ${c.mods}/${c.modsTotal}）` : ''
  lines.push(`  ${done ? '✅' : '⬜'} ${GOAL_NAMES[k]}${done ? `—— 第 ${goalDay[k]} 天达成` : extra}`)
}
if (WANTS.tril && !goalDone.tril) {
  lines.push('  · 万亿为超长程目标：debugQuick 只压缩等待、不放大收益（奖励按真实口径），达天数上限未竟属预期——重点看全程零引擎异常')
}
lines.push('')
lines.push('—— 活动统计（B3/工业 覆盖）——')
lines.push(
  `  AI 打捞派发 ${act.aiSalvage} 次 · 主控打捞会话 ${act.pilotSalvage} 次 · 残骸回收开炉 ${act.recycle} 次 · 制造完工 ${act.craft} 件 · 蓝图学习 ${act.learnBp} 张`,
)
lines.push('')
lines.push('—— 里程碑（节选前 150 条）——')
for (const m of milestones.slice(0, 150)) lines.push(`  ${m}`)
lines.push('')
lines.push(`—— 策略黑洞记录（${holeLogs.length} 次）——`)
for (const h of holeLogs) lines.push(`  ${h}`)
lines.push('')
lines.push(`—— 异常（去重 ${issuesRaw.size} 类）——`)
let i = 0
for (const [text, n] of issuesRaw) {
  if (i++ >= 120) break
  lines.push(`  ×${n} ${text}`)
}
const bossFinal = ctx.anomalies.get('ano-vault-sentinel')
if (bossFinal) {
  const cur = fleetDefOf(state, ctx, state.shipId)
  lines.push(
    `终局评估：当前驾驶 ${cur?.name ?? state.shipId} 对 ano-vault-sentinel 预估胜率 ${Math.round(battleWinPreview(state, ctx, bossFinal) * 100)}%`,
  )
}
const report = lines.join('\n')
console.log(report)
if (REPORT) writeFileSync(REPORT, report, 'utf8')
process.exit((allGoalsDone() || holeEarlyExit) && issuesRaw.size === 0 ? 0 : 1)
