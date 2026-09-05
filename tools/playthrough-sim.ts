/**
 * 全流程模拟验证（2026-09-05 船长需求）——AI 玩家从零开始跑完整内容链：
 * 技能训练 / 采矿 / 精炼 / 制造 / 市场买卖 / 换船配装 / 悬赏远征 / 声望 / 星系探索扫描 /
 * AI 副船 / 随机事件 / 低安遭遇，直到「全部星系点亮 + DSI 声望 ≥13 +
 * 稳定击败最高 threat 96 的 ano-vault-sentinel（连打 5 局）」。
 *
 * 运行：tsx tools/playthrough-sim.ts [--max-days 60] [--real-training] [--seed 1] [--report out.json]
 * 默认 debugQuick=true（技能 1s/级、扫描 1s）——聚焦系统链一致性（平衡归二号 C4）。
 * 在独立副本钉死基线运行；主仓库并行开发不受干扰。
 * v1.0：主链 = 训练/采矿/市场/精炼/制造/换船/战斗/声望/探索/AI 采矿；站台交付与对话留 v2。
 */
import { writeFileSync } from 'node:fs'
import {
  aiSlotsUsed,
  assignAiMining,
  battleWinPreview,
  bountyCooldownRemainingMs,
  buyAtMarket,
  buyBasicAiCore,
  buyShip,
  cancelStandby,
  changeShip,
  countAiCore,
  countItem,
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
  setMiningAutoCycle,
  startExpedition,
  startManufacturing,
  startMining,
  startRefineRun,
  standingOf,
  startScan,
  startTransitHome,
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
    (state.refineRun.active && state.refineRun.worker === 'pilot') ||
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
    if (v < 0 || !Number.isInteger(v)) issue(`仓库 ${k} = ${v}`)
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

function sellEverything(): void {
  const moved = unloadCargoToWarehouse(state)
  if (moved > 0) mark('卸载入仓')
  for (const g of ctx.marketGoods.values()) {
    if (g.kind === 'ship' || g.kind === 'aicore' || g.kind === 'blueprint' || g.kind === 'module') continue // 装备不卖
    const def = ctx.items.get(g.refId)
    if (!def || def.kind === 'ammo' || def.kind === 'drone') continue // 弹药/无人机自用不卖
    const keep = def.kind === 'mineral' ? 120 : def.kind === 'ore' || def.kind === 'gas' || def.kind === 'ice' ? 150 : 0
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
  if (state.refineRun.active && state.refineRun.worker === 'pilot') return
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
  if (!state.refineRun.active) {
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
  if (!state.manufacturing.active) {
    const bp = [...ctx.blueprints.values()].find((b) => ownsBlueprint(state, b.id))
    if (bp) {
      const buildable = findBuildable(ctx, bp.id)
      if (buildable && missingMaterials(state, ctx, buildable.spec).length === 0) {
        const r = startManufacturing(state, bp.id, ctx)
        if (!r.ok) issue(`制造 ${bp.id} 失败：${r.error}`)
        else mark(`制造 ${bp.name}`)
      }
    }
  }
}

function doExplore(): void {
  if (state.scanning.active) return
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

function doAi(): void {
  if (state.wallet.isk < 60_000) return
  if (aiSlotsUsed(state) >= maxAiSlots(state, ctx)) return
  if (maxAiSlots(state, ctx) <= 0) return
  if (countAiCore(state, 'basic') <= 0) {
    const rb = buyBasicAiCore(state, ctx)
    if (!rb.ok) return
  }
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
  // 只派母港/已探明星系的矿带
  const belt = BELT_LIST.find(({ b }) => {
    if ((b.standingReq ?? 0) > standing()) return false
    if (b.galaxyId !== undefined && b.galaxyId !== HOME_GALAXY_ID && !isExplored(state, b.galaxyId)) return false
    return true
  })
  if (!belt) return
  const r = assignAiMining(state, idle[0]!, 'basic', belt.b.id, ctx)
  if (!r.ok) issue(`AI 采矿指派失败：${r.error}`)
  else mark(`AI 副船采矿 ${belt.b.id}`)
}

/** 初始白送的隼枭级武装艇：尽早换驾（武装船才能打悬赏）；免费送的最早利用 */
function useFreeFalconet(): void {
  if (state.shipId === 'sh-falconet') return
  if (state.mining.active) {
    stopMining(state, ctx)
    return
  }
  if (state.fleet['sh-falconet'] && !meBusy()) {
    const r = changeShip(state, 'sh-falconet', ctx)
    if (r.ok) mark('换驾 隼枭级武装艇（初始赠送）')
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
/** 蓝图：市场买书 → 学习 → 制造一件（制造链验证一次；防重复造抽血） */
function doLearnCraft(): void {
  if (state.manufacturing.active) return
  const bp = [...ctx.blueprints.values()].sort((a, b) => a.priceIsk - b.priceIsk).find((b) => !craftedOnce.has(b.id))
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
    if (r.ok) mark(`学习蓝图 ${bp.name}`)
    else issue(`学习蓝图 ${bp.id} 失败：${r.error}`)
    return
  }
  const miss = findBuildable(ctx, bp.id) ? missingMaterials(state, ctx, findBuildable(ctx, bp.id)!.spec) : ['?']
  if (miss.length > 0) {
    // 缺料直接市场补（材料均为矿物）
    for (const m of miss) {
      const g = [...ctx.marketGoods.values()].find((x) => x.kind === 'item' && x.refId === m.itemId)
      if (g && state.wallet.isk > (g.basePrice ?? 10) * m.count * 2) buyAtMarket(state, ctx, g.key, m.count)
    }
    return
  }
  const r = startManufacturing(state, bp.id, ctx)
  if (r.ok) {
    craftedOnce.add(bp.id)
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
  if (state.refineRun.active && state.refineRun.worker === 'pilot') return
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
  if (state.refineRun.active && state.refineRun.worker === 'pilot') return
  const boss = ctx.anomalies.get('ano-vault-sentinel')
  if (boss && battleWinPreview(state, ctx, boss) >= 0.85) return
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
    // 胜利后停留目标星系（awayGalaxy=boss 星系），回母港继续
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

/* ═══════════ 主循环 ═══════════ */
const wall0 = Date.now()
let won = false
let noProgressDays = 0
let prevNetWorth = -1

while (state.gameMs < MAX_MS && !won) {
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
      buyShipAndGear()
      if (standing() < 13) {
        doBounty()
        if (!state.expedition.active && !state.scanning.active) {
          doExplore() // 解锁下一批星系（无 frontier 时自然空转）
          if (!state.expedition.active && !state.scanning.active) doFarm() // 打不过新目标时先刷钱升装
        }
      } else if (exploredCount() < GALAXY_IDS.length) {
        doExplore()
      } else if (!state.expedition.active) {
        if (battleWinPreview(state, ctx, ctx.anomalies.get('ano-vault-sentinel')!) >= 0.85) won = tryFinalRun()
        else doFarm() // 打不过最终目标：刷高奖悬赏换钱买装备
      }
      // 打不过/未就绪时才去采矿攒钱；通关就绪时不挖矿空转
      if (!won && !state.expedition.active && !state.scanning.active && !state.mining.active) doMine()
    } else if (state.gameMs % 1_800_000 < STEP_MS) {
      sellEverything() // 采矿往返间歇在港时卸货卖货
    }
  } else if (!meBusy()) {
    // 野外（胜利停留）：连续出击优先，不回港空转
    if (standing() < 13) doBounty()
    if (!state.expedition.active && standing() >= 13 && exploredCount() < GALAXY_IDS.length) doExplore()
    if (!state.expedition.active) goHomeIfAway()
  }
  // 进度探针（每 0.5 天）
  if (state.gameMs % (43_200_000) < STEP_MS) {
    mark(
      `进度：声望${standing()} 星系${exploredCount()}/20 现金${Math.round(state.wallet.isk / 1000)}k 船${Object.keys(state.fleet).length}艘`,
    )
  }
  // 停滞护栏：净资产天数不涨 → 强制回港采矿卖货
  if (state.gameMs % (86_400_000 * 2) === 0) {
    const net = state.wallet.isk
    if (net <= prevNetWorth && prevNetWorth >= 0) noProgressDays += 2
    else noProgressDays = 0
    prevNetWorth = net
    if (noProgressDays > 10) {
      issue(`停滞护栏：净资产 ${noProgressDays} 天无增长（现金 ${Math.round(net)}）`)
      noProgressDays = 0
      // 强制定居母港采矿
      if (state.expedition.active) recallExpedition(state, ctx)
      if (state.scanning.active) stopScan(state, ctx)
      if (state.standby.active) cancelStandby(state, ctx)
    }
  }
  advanceGame(state, STEP_MS, ctx)
}

auditLogs()
audit()
const wallSec = ((Date.now() - wall0) / 1000).toFixed(1)

/* ═══════════ 报告 ═══════════ */
const lines: string[] = []
lines.push('══════════ 全流程模拟报告 ══════════')
lines.push(`debugQuick=${!REAL_TRAINING} seed=${SEED} 上限 ${MAX_DAYS} 天`)
lines.push(`结果：${won ? '✅ 通关' : '❌ 未通关（天数上限/中途退出）'}  游戏内 ${(state.gameMs / 86_400_000).toFixed(2)} 天 / 墙钟 ${wallSec}s`)
lines.push(`现金 ${Math.round(state.wallet.isk).toLocaleString('zh-CN')} ISK · DSI 声望 ${standing()} · 星系 ${exploredCount()}/${GALAXY_IDS.length} · 累计卖出 ${Math.round(soldTotal).toLocaleString('zh-CN')} ISK`)
lines.push(`训练总级数 ${Object.values(state.skills.trained).reduce((a, b) => a + b, 0)} · 队列 ${state.skills.queue.length} · 舰船 ${Object.keys(state.fleet).length} 艘 · AI 任务 ${Object.keys(state.aiAssignments).length} · 日志 ${state.logs.length} 条`)
lines.push('')
lines.push('—— 里程碑（节选前 150 条）——')
for (const m of milestones.slice(0, 150)) lines.push(`  ${m}`)
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
process.exit(won && issuesRaw.size === 0 ? 0 : 1)
