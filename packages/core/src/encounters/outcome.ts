/** 功能域职责拆分，保持原计算与顺序。 */
import { repairUsageText, persistFleetHullDamage, sunkShipIdsOfBattle, settleDroneLosses, refundAmmo, refundRepairKitsAll, captureBattleReport } from '../combat'
import type { SimContext } from '../types'
import { type GameState, addLog } from '../state'
import { shipDisplayName } from '../instances'
import { loseShip } from '../shipyard'
import { markAmbushRetreat, clearEncounter, settleEncounterTail, weekendKindOfEncounter } from './return'
import { lootOf, dropWrecks, ambushHitHp } from './loot'
import { weekendInvolvedAt } from './presence'
import { weekendWreckDensityOf, wreckDensityOf } from '../salvage'
import { applyArmorFirstDamage, pctOf as pct } from '../hullDamage'
import { nextRandom } from '../rng'
import { ceilFinalQuantity } from '../quantity'
import { weekendApplyBattleOutcome } from '../weekendBattle'

/**
 * 战报尾巴：船体维修装置本场消耗（2026-09-11 船长「不单独显示日志，只把消耗组件数量
 * 显示到战后总结」）。未消耗 = 不添尾巴；文案与远征/AI 副船共用 `repairUsageText`。
 */
export function repairTail(battle: Parameters<typeof repairUsageText>[0], ctx: SimContext): string {
  const t = repairUsageText(battle, ctx)
  return t.length > 0 ? `，船体维修装置${t}` : ''
}

/**
 * **收场时的承伤写回**（2026-09-25 加 · 起因＝旗舰战上战场）：**逐舰**写。
 * 多舰场次（旗舰战 = 编队战，`battle.myFleet` 非空）每艘在编船各写自己那一份 —— 与洞内收口
 * （`wormholeBattle.settleWormholeBattle` 的 `for (const uid of run.fleet)`）同一口径；
 * 单船场次（低安遭遇的绝大多数）仍只写锚舰那一条 ⇒ **逐字不变**。
 */
export function persistBattleDamage(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: GameState['encounter']['battle'],
): void {
  const fleet = battle?.myFleet
  if (fleet && fleet.length > 0) {
    for (const e of fleet) persistFleetHullDamage(state, ctx, e.shipId, battle)
    return
  }
  persistFleetHullDamage(state, ctx, shipId, battle)
}

/**
 * **本场被打沉的我方舰 ⇒ 真丢**（**2026-09-28 玩家报障**：「**玩家在入侵的旗舰战中沉船后撤退，
 * 沉船会被复活带出并且能够修理，这是BUG**」）。
 *
 * 病根：旗舰战是**编队战**（承载在遭遇槽），而遭遇战的收场路径**只落盘承伤、从不判沉船**——
 * `persistFleetHullDamage` 如实写出 `durability = 0`，可那一格在别处**没有任何"已沉"语义**
 * （全仓只有 `< 0.5` 的自动修理/返港判据）⇒ 0% 的船以"活着但残血"被带回港、花钱就能修好。
 * 虫洞那条同口径的路是**判沉船并 `loseShip`**（`wormholeBattle.settleWormholeBattle`）。
 *
 * 判据 = 单点 `combat.sunkShipIdsOfBattle`（三层血合计 ≤ 0）；落点 = `loseShip`：
 * - **传 `enc.galaxyId`** ⇒ 按 **2026-09-26 船长令**「非虫洞的正常星系被摧毁 ⇒ 在该星系生成残骸」
 *   留下可打捞的残骸（装配/机群/加固回收率一并进残骸快照，见 `loseShip`）；
 * - `cause: 'encounter-lost'`（沉船记录那一栏的新枚举，界面文案 `ui.WreckLog.021`）；
 * - 主控船被打沉时 `loseShip` 自会补驾驶船（既有机制）。
 *
 * ⚠ 调用点**必须在战报之后**（战报要读那艘船被打成什么样），且在 `clearEncounter` **之前**
 * （残骸落点与文案要用 `enc.galaxyId` / `enc.name`）。
 */
export function loseSunkShipsOfBattle(state: GameState, ctx: SimContext, shipId: string): number {
  const enc = state.encounter
  const battle = enc.battle
  const sunk = sunkShipIdsOfBattle(battle, shipId)
  if (sunk.length === 0) return 0
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? enc.galaxyId ?? ''
  for (const uid of sunk) {
    const name = shipDisplayName(state, ctx, uid)
    addLog(
      state,
      'warn',
      `☠ ${name} 在「${galaxyName}·${enc.name}」被打沉（交火中结构归零）——船体与货仓全损；` +
        `残骸留在该星系，可前往打捞。`,
    )
    loseShip(state, uid, ctx, `遭遇战中被击沉（${name}）`, enc.galaxyId ?? undefined, {
      cause: 'encounter-lost',
    })
  }
  return sunk.length
}

/** **收场时的机群战损**（同上一处口径）：多舰场次逐舰各扣各的机舱（`e.tag` 归属），单船场次一条。 */
export function settleBattleDroneLosses(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: GameState['encounter']['battle'],
): void {
  const fleet = battle?.myFleet
  if (fleet && fleet.length > 0) {
    for (const e of fleet) settleDroneLosses(state, ctx, e.shipId, battle, 0, e.tag)
    return
  }
  settleDroneLosses(state, ctx, shipId, battle)
}

/**
 * 遭遇战自动脱离结算（船长 2026-09-11 定：低安遭遇也挂"结构损失过半自动脱离"保险）：
 * 轻损脱离——退还弹药/修理组件、落盘承伤、**无缴获、无额外扣损**（战斗内实际承伤照留），
 * 随后同样走撤退判定（此时结构已 <50%，必然触发返港待命）。
 *
 * `mode`（2026-09-25 加）：`'hull'`（缺省）= 结构过半自动脱离（旧口径，**逐字不变**）；
 * `'manual'` = **玩家主动脱离**（旗舰战战斗画面里的「撤退」按钮 → `retreatEncounterBattle`）——
 * 只换措辞与"因袭击自动撤离"那笔标记，结算内容一模一样。
 */
export function settleEscape(state: GameState, ctx: SimContext, mode: 'hull' | 'manual' = 'hull'): void {
  const enc = state.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const battle = enc.battle
  if (battle) {
    settleBattleDroneLosses(state, ctx, shipId, battle)
    refundAmmo(state, battle.ammo, battle.ammoIds)
    refundRepairKitsAll(state, battle)
    persistBattleDamage(state, ctx, shipId, battle)
  }
  const ship = state.fleet[shipId]
  const armourPct = Math.round((ship?.armorPct ?? 1) * 100)
  const hullPct = Math.round((ship?.durability ?? 1) * 100)
  const tail = repairTail(battle, ctx)
  if (mode === 'manual') {
    addLog(
      state,
      'combat',
      `⚔ 主动脱离（${galaxyName}·${enc.name}）：${shipName} 收手退出交火（现 装甲 ${armourPct}% / 结构 ${hullPct}%）${tail}。`,
      'core.encounters.011',
      { p1: galaxyName, p2: enc.name, p3: shipName, p4: armourPct, p5: hullPct, p6: tail },
    )
  } else {
    addLog(
      state,
      'combat',
      `⚔ 遭遇战自动脱离（${galaxyName}·${enc.name}）：${shipName} 结构损失过半，及时退出交火（现 装甲 ${armourPct}% / 结构 ${hullPct}%）${tail}。`,
    )
  }
  // 因袭击自动撤离（两处置位之一，见 `markAmbushRetreat`）：即便随后被修理组件修好、留下继续干活，
  // 这一次"被打到自动脱身"也算发生过（船长 2026-09-14 裁定「也算自动脱离交火」）
  // ⚠ 主动脱离**不算**"被打到自动脱身" ⇒ 不记这笔（那是伏击口径的账）。
  if (mode === 'hull') markAmbushRetreat(state)
  /** ⚠ **沉船在这里判**（2026-09-28 玩家报障修）：撤退/自动脱离都不是"复活"——打沉了就真丢 */
  loseSunkShipsOfBattle(state, ctx, shipId)
  clearEncounter(state)
  // 收场尾巴（2026-09-12 船长定：先修后判；自动脱离时结构已 <50%，修不动才返港）
  settleEncounterTail(state, ctx, shipId)
}

/** 遭遇战（玩家应战后）推进与结算：胜 → 缴获；败 → 受损 + 大概率被抢 */
export function settleFight(state: GameState, ctx: SimContext): void {
  const enc = state.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const battle = enc.battle
  const bal = ctx.balance.encounter
  const fleetShip = state.fleet[shipId]
  if (battle) {
    // 机群战损（2026-09-10 船长「无人机可被击落」+ 永久损失制）：遭遇战同样照扣
    // （2026-09-25：多舰场次逐舰结算，见 `settleBattleDroneLosses`）
    settleBattleDroneLosses(state, ctx, shipId, battle)
    // 退还剩余弹药（与远征/撤退同一口径；弹药 MK2 按实装弹 id 退回）
    refundAmmo(state, battle.ammo, battle.ammoIds)
    refundRepairKitsAll(state, battle) // 船体维修装置（2026-09-09）：未用修理组件退回仓库
    // P0 承伤持久化：遭遇战同样保留装甲/结构残余（结构=耐久）；失利附加扣损在后
    persistBattleDamage(state, ctx, shipId, battle)
  }
  if (battle && battle.ended === 'me') {
    // 2026-09-09：全歼缴获 = 伏击敌群赏金 ×50%（与文字击退同额；缴获评估学照旧）；全歼留下敌舰残骸
    const seizeF = 1 + 0.1 * Math.min(5, state.skills.trained['seizure-appraisal'] ?? 0)
    const loot = lootOf(state, ctx, seizeF)
    state.wallet.isk += loot
    dropWrecks(state, ctx)
    /**
     * **入侵遭遇另写一句**（2026-09-25）：缴获恒 0（船长「入侵舰队不应该有赏金」），
     * 残骸读数改看**独立池**（`weekendWrecks`），并把钱的去向说清楚。
     */
    const invasion = weekendInvolvedAt(state, ctx)
    const d = state.encounter.galaxyId
      ? invasion
        ? weekendWreckDensityOf(state, state.encounter.galaxyId)
        : wreckDensityOf(state, state.encounter.galaxyId, ctx)
      : null
    const encWinText = invasion
      ? `★ 击退入侵舰队（${galaxyName}·${enc.name}）：${shipName} 全歼来敌——本场无赏金（进度收入在活动结束时按进度统一结算）${
          d !== null ? `，入侵残骸沉积 ${d.toFixed(1)}` : ''
        }${repairTail(battle, ctx)}。`
      : `★ 遭遇战大捷（${galaxyName}·${enc.name}）：${shipName} 全歼来敌——缴获 ${loot.toLocaleString('zh-CN')} 信用点${
          d !== null ? `，敌舰残骸沉积（密度 ${d.toFixed(1)}）` : ''
        }${repairTail(battle, ctx)}。`
    addLog(state, 'combat', encWinText)
    // **结构化战报**（2026-09-14 船长定）：这条日志原先不含「战报」二字 ⇒ 弹层取不到正文（现已修）
    captureBattleReport(state, battle, { source: 'encounter', outcome: 'win', summary: encWinText })
  } else {
    // 失利附加扣损：与文字结算同一口径（一口 = 敌群火力 × hitFirepowerSec，装甲先吃；2026-09-14 起 5 秒）
    const hit = applyArmorFirstDamage(state, ctx, shipId, ambushHitHp(ctx, enc.threat))
    if (hit && hit.floored) addLog(state, 'warn', '⚠ 遭遇战后船体结构濒临崩溃（耐久仅剩 5%）——请尽快返港维修。')
    let takenUnits = 0
    if (fleetShip && nextRandom(state.rng) < 0.5) {
      const total = Object.values(fleetShip.cargo).reduce((a, b) => a + b, 0)
      const take = ceilFinalQuantity(
        total * bal.lootTakenMaxPct * (0.5 + nextRandom(state.rng) * 0.5) * (1 - 0.12 * Math.min(5, state.skills.trained['lowsec-survival'] ?? 0)),
      )
      let rest = take
      for (const key of Object.keys(fleetShip.cargo)) {
        if (rest <= 0) break
        const unit = fleetShip.cargo[key]!
        const grab = Math.min(unit, rest)
        fleetShip.cargo[key] = unit - grab
        rest -= grab
        if (fleetShip.cargo[key] <= 0) delete fleetShip.cargo[key]
      }
      takenUnits = take - rest
    }
    const encLoseText = `⚔ 遭遇战失利（${galaxyName}·${enc.name}）：${shipName} 不敌来敌——${
      hit
        ? `装甲 -${pct(hit.armorLost)}%${hit.hullLost > 0 ? `、结构 -${pct(hit.hullLost)}%` : ''}（现 装甲 ${pct(hit.armorTo)}% / 结构 ${pct(hit.hullTo)}%）`
        : '船体带着损伤'
    }${takenUnits > 0 ? `，货仓被劫走 ${takenUnits.toLocaleString('zh-CN')} 单位` : ''}，狼狈脱离${repairTail(battle, ctx)}。`
    addLog(state, 'combat', encLoseText)
    /**
     * **结构化战报**（2026-09-14 船长定）：这一支是"打输、船没沉"（低安遭遇不弃船，只受损+被抢）
     * ⇒ `lose`。⚠ 注意与远征不同：遭遇战**没有**"未分胜负就中止"那一档（要么全歼、要么被打退），
     * 所以这里不会出 `break`。
     */
    if (battle) captureBattleReport(state, battle, { source: 'encounter', outcome: 'lose', summary: encLoseText })
  }
  /** ⚠ **沉船在这里判**（2026-09-28 玩家报障修）：分胜负也一样——打沉了的船不许"活着回家" */
  loseSunkShipsOfBattle(state, ctx, shipId)
  clearEncounter(state)
  // 收场尾巴（2026-09-12 船长定：先修后判）——应战胜、败两路共用
  settleEncounterTail(state, ctx, shipId)
}

/**
 * **一场遭遇战"已分出胜负"的收口（唯一入口）**：先 `settleFight`（战报 / 战损 / 缴获 / 清槽），
 * 再按同一份**归属提示**走一遍入侵结算（`weekendApplyBattleOutcome`）。
 *
 * ⚠ **2026-09-26 修（船长报障「用无人机成功近乎满血击杀了入侵母舰，但报告显示未击杀」）**：
 * 本文件原先有**两条**"战斗已结束"的支路 —— 上面"进函数时就已经结束"那一支**只调 `settleFight` 就 return**，
 * 漏了下面那支才有的入侵结算 ⇒ 只要战斗在引擎看到之前就已结束（`enc.battle.ended` 已置位），
 * **击沉母舰的伤害 / 进度 / 黑匣全部丢失**，而结算面板永远显示「未击沉」。
 * 探针实测（真实引擎路径，敌全灭后再推一拍）：
 * - 走下面那支：台账 150,000 · `flagshipHpDone` 150,000 · `flagshipDown = player` · 黑匣 ×1 ✓
 * - 走上面那支（改前）：台账 150,000 却 `flagshipHpDone = 0` · `flagshipDown` undefined · **黑匣 0** ✗
 *
 * 为什么"先 `settleFight` 再读 `enc.battle`"是安全的：`settleFight` 只把 `state.encounter`
 * **整体换成新对象**（`clearEncounter`），调用方手里这个 `enc` 引用与它里面的 `battle.units` 都还在
 * （探针里 `settleFight` 跑完后台账照旧量得到 150,000）；而 `weekendKindOfEncounter` 读的正是传入的 `enc`
 * （不是 `state.encounter`）⇒ 归属判据不会被清槽影响。
 */
export function settleEncounterBattle(state: GameState, ctx: SimContext, enc: GameState['encounter']): void {
  settleFight(state, ctx)
  weekendApplyBattleOutcome(state, ctx, enc.anomalyId ?? null, enc.battle?.ended === 'me', Date.now(), enc.battle, {
    kind: weekendKindOfEncounter(state, enc),
    galaxyId: enc.galaxyId ?? '',
    source: 'battle',
  })
}
