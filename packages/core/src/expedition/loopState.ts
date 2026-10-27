/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, type BattleState, addLog } from '../state'
import type { CoreBlockReason } from '../engine'

/**
 * **本场机群战损读数**（单点；永久损失制安全阀：2026-09-10 船长拍板「战损过半自动停环提示补货」）。
 *
 * 返回 `{ before, after, attrition }`：`before` = 出发架数 · `after` = **补货前**的存活架数 ·
 * `attrition` = `after / before < 50%`（`before = 0` 时恒 false）。
 *
 * ⚠ **必须读补货前的存活架数**：2026-09-20 起 `settleDroneLosses` 会在扣账之后**立刻按本场出发编制
 * 自动补足机群** ⇒ 直接读 `state.fleet[...].droneLoad` 拿到的是**补满后**的架数，这条安全阀会**静默失效**。
 * 故读战损报告里的 `survivors`（结算时在补货前记下），并与本场 `startedAtGameMs` 配对，避免读到上一场
 * 或 AI 副船留下的旧报告；报告缺失（老档/异常）时回落到"出发架数 − 净损失"。
 */
export function droneBattleOutcome(
  state: GameState,
  battle: BattleState,
): { before: number; after: number; attrition: boolean } {
  const before = Object.values(battle.droneLoadAtStart ?? {}).reduce((s, n) => s + n, 0)
  const rep =
    state.droneLossReport && state.droneLossReport.battleStartedAtGameMs === battle.startedAtGameMs
      ? state.droneLossReport
      : null
  const after = Math.max(0, rep?.survivors ?? before - (rep?.gone ?? 0))
  return { before, after, attrition: before > 0 && after / before < 0.5 }
}

/**
 * **机群缺额**（船长 2026-09-20：战斗结束会自动补足机群 ⇒ 若还缺就是"货源不够"，装配页要看得见还差几架）。
 *
 * 返回 `null` = 没被机群门槛拦着。判据 = 停环记账 `autoLoopDroneFloor` 存在且当前装载**没超过它**
 * （与 `autoLoopReopenBlockReason` 第②条同一把尺，本函数是该判据的**单点**）。
 * `shipId` 可传非驾驶船（装配页支持给别的船装配）。
 */
export function autoLoopDroneShortfall(
  state: GameState,
  shipId: string = state.shipId,
): { now: number; floor: number; need: number } | null {
  const floor = state.autoLoopDroneFloor
  if (typeof floor !== 'number') return null
  const now = Object.values(state.fleet[shipId]?.droneLoad ?? {}).reduce((s, n) => s + n, 0)
  return now <= floor ? { now, floor, need: floor + 1 } : null
}

/**
 * **再开重复清剿的前置**（船长 2026-09-18：「**战损/耐久未恢复则先挡住**」）——返回 null = 放行。
 *
 * 两条都是"可恢复"的前置，且都复用既有那把尺：
 * ① **装甲或结构 < 50%**：与出发门槛、自动停环同一档（`advanceAutoLoopBounty` 里那条）。
 * ② **机群战损未补**：停环那一刻记下的架数 `state.autoLoopDroneFloor`（只有"机群战损过半"那一路会写）
 *    ⇒ 再开要求**当前装载严格大于它**（判据单点 = `autoLoopDroneShortfall`）。
 *
 * ⚠ 2026-09-20 起战斗结束会**立刻按本场出发编制自动补足机群**（货仓 → 仓库）⇒ 第②条实际只在
 * **货仓与物品仓库都没货**时才拦人；文案据此改写（说清缺多少、要补到几架），不再写"请手动补装"。
 */
export function autoLoopReopenBlockReason(state: GameState): CoreBlockReason | null {
  const fs = state.fleet[state.shipId]
  if (!fs) return { error: '舰队里找不到当前驾驶舰船。', errorId: 'core.expedition.032' }
  if ((fs.armorPct ?? 1) < 0.5 || fs.durability < 0.5) {
    return { error: '装甲或结构低于 50%：先修回 50% 以上，或装上船体维修装置并带够组件。', errorId: 'core.expedition.033' }
  }
  const short = autoLoopDroneShortfall(state)
  if (short) {
    return short.floor <= 0
      ? { error: '机群已全灭：货仓与物品仓库都没有可补充的无人机——先在装配页装入（购买或制造）再开启重复清剿。', errorId: 'core.expedition.034' }
      : {
          error: `机群尚未补充（现 ${short.now} 架 · 停环时 ${short.floor} 架）：需补到 ${short.need} 架以上才可再开——先在装配页装入无人机。`,
          errorId: 'core.expedition.035',
          errorParams: { p1: short.now, p2: short.floor, p3: short.need },
        }
  }
  return null
}

/** 停环并记录原因（日志+清开关；2026-09-10 船长定：文案带当前 装甲/结构 数字，
 * 并写入一次性提示 autoLoopStopNotice——玩家在线时由心跳读取弹窗告知） */
export function stopAutoLoopReason(state: GameState, reason: string, droneFloor: number | null = null): void {
  state.autoLoopAnomalyId = null
  // 只有"机群战损过半"那一路传 `droneFloor`（再开前须补货，见 `autoLoopReopenBlockReason`）；其余原因清除记账
  state.autoLoopDroneFloor = droneFloor
  const fs = state.fleet[state.shipId]
  const armorPct = Math.round((fs?.armorPct ?? 1) * 100)
  const structPct = Math.round((fs?.durability ?? 1) * 100)
  const text = `重复清剿已暂停：${reason}（当前 装甲 ${armorPct}% / 结构 ${structPct}%）`
  addLog(state, 'combat', text)
  state.autoLoopStopNotice = text
}

/**
 * **重复清剿当前在等哪一类作业**（`null` = 没有别的作业挡路，继续走冷却/门槛检查）。
 *
 * ⚠ **引擎与活动栏必须共用这一份**（2026-09-17 玩家报障「自动清缴一直处于『即将自动再出击』的状态」）：
 * 原先引擎等 **5 类**（远征 · 采矿 · **星图扫描** · 残骸打捞 · 航行），而活动栏那行只认 **3 类**（采矿 · 航行 · 待命）
 * ⇒ 两者漂移：那两种情况下引擎在等、行文案却一路写「即将自动再出击」。现收成这一份：**增删等待项只改这里**。
 *
 * 🔴 **「星图扫描」已从等待表删除**（2026-09-17 船长追问「星图扫描不是已经不占用主控活动了？」）——
 * 船长 2026-09-15 定案：「**进行修正，玩家扫描星系将不再占用玩家的主控活动**」⇒ 星系扫描改成**无人扫描艇**：
 * **不占主控、不牵动舰船、不阻断任何别的活动**（双向放行，当时把双向互斥判据全删了）。
 * 而这条等待判据是那批**漏掉的一处旧闸** ⇒ 扫描在跑时清剿一直"等"、而扫描可以无限期跑
 * ⇒ 玩家看到的"卡死"**根因就在这里**（只把行文案改诚实是不够的，等待表本身必须跟着改）。
 * `state.salvaging`（残骸打捞）**仍在**表里：打捞要用主控船与打捞器，确实占着主控。
 * ⚠ 掩护巡逻（`standby`）**不在等待表里**：它不挡 `startExpedition` 的资格判定 ⇒ 引擎会真的试一次出发、
 * 失败即按既有口径**停环**（带日志与在线弹窗），所以这行不需要为它显示"等待"。
 */
export function autoLoopWaitLabel(state: GameState): string | null {
  if (state.pendingBattleRange) return '战前准备'
  if (state.expedition.active) return '本次出击'
  if (state.mining.active) return '采矿'
  if (state.salvaging.active) return '残骸打捞'
  if (state.transit.active) return '航行'
  /**
   * **亲自开炉 / 亲自开线也要等**（**2026-09-24 修 · 玩家报障**）。
   *
   * 判据用上面那条老尺：**这一项是否真的占着主控**——`refine` / `manufacturing` 的 `worker === 'pilot'`
   * 两档都占（`activityGate.mainActivityOf` 里就是它们），与采矿/打捞同性质 ⇒ 本表原本漏了它们。
   *
   * 漏掉的后果（船长转述的玩家报障）：重复清剿在跑时，它到点就 `startExpedition` ⇒ 活动闸门
   * 把主控手上的**造船线**当成"当前活动"掐掉（`haltActivityForSwitch`）⇒ 一条 4.8 小时的
   * 一次性舰船蓝图连进度带材料一起没了；**存档实证**：三张一次性舰船图全"已消耗"、舰船仓库一艘都没有。
   * 现在改为**等**（活动栏照既有口径显示"等待：亲自开炉 / 亲自开线"），手工作业跑完自然再出发。
   *
   * ⚠ 只管**主控亲自**那两档：AI 核心驱动的炉/线不占主控（`worker !== 'pilot'`）⇒ 不挡清剿。
   */
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开炉'
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) return '亲自开线'
  return null
}

/** 入侵「重复出击」的循环目标（= 被占星系 id；null = 没开） */
export function autoLoopInvasionGalaxy(state: GameState): string | null {
  const gid = state.weekendEvent?.autoLoopGalaxyId
  return typeof gid === 'string' && gid.length > 0 ? gid : null
}

/** 停环并记录原因（与 `stopAutoLoopReason` 同款：日志 ＋ 在线一次性提示） */
export function stopAutoLoopInvasion(state: GameState, reason: string, reasonId?: string, reasonParams?: Record<string, string | number>): void {
  if (state.weekendEvent) delete state.weekendEvent.autoLoopGalaxyId
  const fs = state.fleet[state.shipId]
  const armorPct = Math.round((fs?.armorPct ?? 1) * 100)
  const structPct = Math.round((fs?.durability ?? 1) * 100)
  const text = `重复出击已暂停：${reason}（当前 装甲 ${armorPct}% / 结构 ${structPct}%）`
  addLog(state, 'combat', text, 'core.invasionLoop.006', {
    p1: reason, p2: armorPct, p3: structPct,
    ...(reasonId ? { p1Id: reasonId } : {}),
    ...Object.fromEntries(Object.entries(reasonParams ?? {}).map(([key, value]) => [`p1${key}`, value])),
  })
  state.autoLoopStopNotice = text
}
