import { buildDroneDrive } from './buildDroneDrive'
import { resolveBattleHost } from './resolveBattleHost'
import { renderBattleReport } from './renderBattleReport'
import { renderBattleScene } from './renderBattleScene'
import { useVisualState } from './useVisualState'
import { useBattleLifecycle } from './useBattleLifecycle'
import { consumeBattleEvents } from './consumeBattleEvents'
import { buildProjectileLayers } from './buildProjectileLayers'
import { buildEnemyLayers } from './buildEnemyLayers'
/**
 * V12 全屏战斗场景（P4 击杀慢镜版）：
 * - 引擎在交火期间按 100ms 切片推进并即时通知本屏，画面直接以实时状态驱动；
 * - 分出胜负后引擎延迟 killcamMs 结算 → 本屏依次演出：最后一击弹道/命中 → 敌舰爆炸
 *   （或我方受创告警）→ 结算完成弹出战报覆盖层；
 * - 距离尺游标式（左远右近）、射程弧按弹种着色、滑条右 = 贴脸 / 左 = 拉开（同轴同比例）。
 * 组件只读展示，不参与确定性结算。
 * 结构（2026-09-05 维护性重构）：本文件只留「组件编排 / 状态机 / 渲染」；
 * 纯视图核心（颜色与演出计时、舰列几何、射程弧路径、三层血条、弹道几何、战报查找）
 * 已抽到 ./battleViewCore.tsx——动画/表现类改动请先落在那里的常量与纯函数。
 */
import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { BATTLE_ARRIVAL_FLY_MS, BATTLE_ARRIVAL_STAGGER_MS, battleFoeAnomaly, battleShowWindowMs, battleTacticDesire, fleetDefOf, foeChargeCount, foeMainTagOf, foeShipTierOf, foeUnitNameOf, repairKitAvailableOf, repairLedgersOf } from '@whale/core'
import type { ShipRole } from '@whale/core'

import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'

import { ammoKey } from './battleBlink'

import { foeFamilyOf } from '../../ui/shipArt'



import { BOLT_LOOK, DMG_COLOR, DMG_ORDER, LAY, sizeOfUnit, noseOf, foeBarGeom, FLY_MS, BOLT_LIFE, FLASH_LIFE, BOOM_LIFE, DRONE_DOWN_LIFE, POPUP_LIFE, approachOf, layout, fanPath, ringPath } from './battleViewCore'

import { ACID_FX_LIFE_MS } from './battleAcidFx'

import { tr as normalTr, futureTr, cmdText, logText } from '../../i18n/locale'
// 2026-09-26 战斗界面信息层级批：图例 chip 的射程数字收进"点按/悬停"卡片 ⇒ 走全站统一的富内容提示层

// 2026-10-02 批次 4u：无人机几何域（挂载件悬停明文/敌我机群姿态/击落爆炸点）已拆到 ./battleDrones，本文件借回使用
import { DRONE_DOWN_FREEZE_MS } from './battleDrones'

import { battleFxArrivals } from './battleFxCursor'

export function BattleScreen({
  engine,
  onToast,
  onClose,
  visible = true,
  onReport,
  onDone,
  rangeMode = false,
  simulationPaused = false,
}: {
  engine: Pick<GameEngine, 'state' | 'ctx' | 'wormholeSpeedActive' | 'wormholeSpeedOptions' | 'setWormholeSpeed' | 'battleSetDesireAt' | 'retreatNow'>
  onToast: ToastFn
  /**
   * **隐藏观战屏**（2026-09-22）：只把屏收起来，**不动宿主对本组件的挂载** ——
   * 战斗照常在后台推进，浮动入口「⚔ 战斗中」随时点回来（洞内也允许，船长 2026-09-20 改判）。
   */
  onClose: () => void
  /**
   * **上屏开关**（2026-09-22 · 回归修复）：全屏形态下"挂载 ≠ 上屏" ——
   * 宿主必须在"战斗已结算、战报还没播"的那段窗口期继续**挂载**本组件（否则战报永远弹不出来），
   * 但玩家点「← 最小化」（原「← 退出战场」，2026-09-26 改口径）时要能真的**关屏**。`visible=false` ⇒ 本组件什么都不渲染，
   * 状态机与 33ms 循环照常跑。
   */
  visible?: boolean
  /**
   * **战报到达时问宿主"要不要上屏"**（2026-09-22）：返回 `true` = 宿主已把屏叫回来（正常显示战报）；
   * 返回 `false` = 宿主不要这一屏（例如优化清剿那种玩家没看过的自动战斗）⇒ 本组件当自己没有战报可播、
   * 直接走收尾（`onDone`），免得留下一块**看不见却一直挂着**的屏。
   */
  onReport?: () => boolean
  /**
   * **收尾完成**（2026-09-22）：战报关掉了（玩家点关闭 / 20 秒自动关）或压根没有战报可播 ⇒
   * 通知宿主**可以卸载**本组件（宿主据此撤销挂载）。不传就回落到 `onClose`（老调用方行为不变）。
   */
  onDone?: () => void
  rangeMode?: boolean
  simulationPaused?: boolean
}) {
  const pausedRef = useRef(simulationPaused)
  pausedRef.current = simulationPaused
  const state = engine.state
  const tr = state.wormhole.run?.expeditionRules === 2 ? futureTr : normalTr
  const { combatView, inWormhole, arcs, battle, sceneName, speedOptions, speedActive } = resolveBattleHost({ state, engine, tr })
  /** 机群池键（**`舰tag:机型`**）→ 实际架数（弹道道次必须落在"实际渲染的机体数"内；见 fx 消费处 2026-09-10 修复）。
   *  2026-09-14「逐舰机群」：由 core 视图的**逐舰**机体清单（`myUnits[].drones`）建表——此前只有主控那张。 */
  const droneCountOf = new Map<string, number>()
  for (const u of arcs?.myUnits ?? [])
    for (const d of u.drones ?? []) droneCountOf.set(`${u.tag}:${d.artId}`, d.deployed ?? d.count);
  /** 敌方机群：敌单位 tag + 机型 → **该舰现存架数**（弹道道次取模要用它；敌我各用各的表，见弹道层） */
  const foeDroneAliveOf = (tag: string, artId: string): number =>
    arcs?.foeDrones?.find((d) => d.tag === tag && d.artId === artId)?.alive ??
    1
  /** **敌机是否处于受击增程态**（2026-09-11 船长）：机体阵位与弹道**必须同源**——
   *  否则机体已后撤到远距、弹道却仍从我舰旁发出 ⇒ 船长实测「射程增加后，敌无人机的落点位置出现错位」。 */
  const foeDroneBuffedOf = (tag: string): boolean =>
    arcs?.foeDrones?.some((d) => d.tag === tag && d.rangeBuff === true) === true

  const {
    stage, setStage, retreatAsk, setRetreatAsk, dragV, setDragV,
    dims, setDims, smoothM, setSmoothM, moveSnapRef, dimsRef,
    thrusterBoostRef, thrusterCycleRef, measureRef, widthCheckRef, starLayerRefs, starOffRef,
    starStateRef, meSpeedRef, starField, laneRef, screenRef, stageRef,
    fitRef, meColRef, foeColRef, meFxRootRef, facingRef, fxCursorRef,
    keyRef, boltsRef, flashRef, acidFxRef, acidDeathsRef, acidFxWakeAtRef,
    refreshAcidFx, popupsRef, popupAccRef, muzzleCountRef, droneSortieRef, foeSortieRef,
    droneSlotRef, droneBoxRef, droneElsRef, droneWritesRef, droneDownRef, blinkRef,
    blinkFxRef, blinkSeenRef, dronePrevShowRef, visDistRef, droneDriveRef, deadRef,
    corpseAtRef, prevHpRef, hpInitRef, lastHitTypeRef, outroRef, reportTextRef,
    droneReportRef, battleReportRef, flushTimerRef, dragValRef, dragRafRef, dragPendingRef,
    battleRef, battleStartRef, prevBattleIdRef, mapRef,
  } = useVisualState({ arcs })

  // ── 阶段推进：live →（分出胜负）→ outro →（引擎结算完成）→ report ──
  const { finish } = useBattleLifecycle({
    onDone, onClose, battle, stage, outroRef, setStage,
    combatView, state, droneReportRef, battleReportRef, reportTextRef, tr,
    onReport, prevBattleIdRef, deadRef, corpseAtRef, acidFxRef, acidDeathsRef,
    acidFxWakeAtRef, prevHpRef, hpInitRef, engine, meSpeedRef, battleRef,
    pausedRef, battleStartRef, moveSnapRef, visDistRef, blinkSeenRef, blinkFxRef,
    widthCheckRef, foeColRef, meColRef, dimsRef, measureRef, setSmoothM,
    refreshAcidFx, stageRef, meFxRootRef, starStateRef, thrusterCycleRef, thrusterBoostRef,
    starOffRef, starLayerRefs, droneDriveRef, droneBoxRef, droneWritesRef, droneElsRef,
    laneRef, setDims, flushTimerRef, dragValRef, mapRef,
  })

  /**
   * **上屏开关**（2026-09-22 · 回归修复）：玩家点「← 最小化」⇒ `visible=false` ⇒ **本组件什么都不渲染**
   * （战斗照常在后台推进、浮动入口点得回来）。
   *
   * ⚠ 放在这里（而不是战报分支之后）：**战报也要受同一把开关管**，否则玩家在战报里点「关闭」
   * 会关不掉（分支照样渲染）。战报"自动上屏"由另一条路保证 —— 进 report 阶段时回调 `onReport()`
   * 通知宿主把 `visible` 置真（见上面的阶段机），所以正常路径下战报一定看得见。
   *
   * ⚠ 位置必须在**所有 hook 之后**（本行之上只有 hook 与计算，没有早退分支）：hook 数量两次渲染不一致
   * 会让 React 卸载整棵树（2026-09-13 黑屏事故的老坑）。
   */
  if (visible === false) return null

  /* ═══════════ 战报弹层（stage = report：引擎已结算返航，战场数据已清空） ═══════════ */
  if (stage === 'report') return renderBattleReport({ stage, outroRef, droneReportRef, battleReportRef, tr, reportTextRef, finish })

  if (!combatView || !battle || !arcs) return null
  const fxRead = battleFxArrivals(fxCursorRef.current, battle)
  if (fxRead.reset) {
    boltsRef.current = []
    flashRef.current = []
    popupsRef.current = []
    popupAccRef.current.clear()
    acidFxRef.current = []
    acidDeathsRef.current.clear()
    acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
    droneSortieRef.current.clear()
    foeSortieRef.current.clear()
    droneSlotRef.current.clear()
    dronePrevShowRef.current.clear()
    droneWritesRef.current.clear()
    droneDownRef.current = []
    muzzleCountRef.current.clear()
    blinkRef.current.clear()
    blinkSeenRef.current.clear()
    for (const pillar of blinkFxRef.current) pillar.el?.remove()
    blinkFxRef.current = []
    deadRef.current = new Set(Object.values(battle.units)
      .filter(unit => unit.side === 'foe' && unit.hp.s + unit.hp.a + unit.hp.h <= 0).map(unit => unit.tag))
    corpseAtRef.current.clear()
    prevHpRef.current.clear()
    lastHitTypeRef.current.clear()
    hpInitRef.current = false
    moveSnapRef.current = { prev: null, cur: null }
    visDistRef.current = battle.distanceM
  }
  // 交给 33ms 平滑循环（每渲染同步一次句柄；`dimsRef` 同款模式）
  battleRef.current = battle
  const combat = combatView
  /**
   * `farM` = **战场远端（距离上限）**——⚠ 2026-09-19 起它**不再等于开战距离**：
   * 引擎按"当前双方有效射程（含我方技能/科技增程 + 敌方受击增程）"现算上限、只增不减
   * （`arcs.maxM` ← `combat.battleMaxDistanceM`，船长裁定「甲」：计算战场宽度要算上增程、不用常数乘）。
   * 本文件的泳道几何 / 距离尺 / 滑条 / 「拉开（远 …）」读数**全部按这个远端**画 ⇒ 与引擎同一把尺；
   * 没有任何增程时它逐字等于开战距离 ⇒ 常规战斗的画面**一字不变**。
   */
  const farM = arcs.maxM
  const nearM = arcs.nearM

  const meShip = fleetDefOf(state, engine.ctx, state.shipId)
  const meRole: ShipRole = meShip?.role ?? 'industrial'
  const foeTags = Object.keys(combat.foeHp)
  /** 存活敌舰（血条/命中对象用；与视觉行 foeRowTags 不同——视觉行含演出期尸骸占位） */
  const foeAliveTags = foeTags.filter((t) => !deadRef.current.has(t))
  // 2026-09-09 多波修复：主/僚判定不靠"队列首位"——多波多小队的主舰 tag 为 w{n}-foe-{k}
  // （旧判定把第 2 艘主舰当僚机：小尺寸 + 僚机字样）；判定与引擎同源（core foeMainTagOf）
  const isFoeMainTag = foeMainTagOf
  /**
   * **敌卡 = 本场战斗的那张卡**（2026-09-14 修船长报障「虫洞内的战斗，敌方舰船动画不对 /
   * **敌方的战斗动画图形和敌族对不上** / 战斗开始位置似乎不对」）：
   * 取卡单点在 core `battleFoeAnomaly`（洞内 = 按层派生卡，洞外 = 远征卡）。
   * 此前这里只认 `state.expedition.anomalyId` ⇒ **洞内恒取不到敌卡**，三个下游一起错：
   *   ① `foeKey = foeFamilyOf(undefined)` ⇒ 兜底族 **A 海盗**（洞里 C/D/E/G 族全画成海盗舰体/动画）
   *      ⇒ **图形与敌族对不上**；
   *   ② `foeShipTierOf` 拿不到舰种档 ⇒ `sizeOfUnit(null)` 回落 170/90（舰种体积阶梯在洞内失效）；
   *   ③ 而 `foeSizes` 又喂给 `layout()`（锚点跟实际舰宽、机位/排布/米制跨度 `usable` 全由它推）
   *      ⇒ **敌方舰船体积与机位整体偏**，看起来就是"开局位置不对"。
   */
  const foeAnomaly = battleFoeAnomaly(state, engine.ctx)
  /** 逐舰体积（px）：玩家舰 = `ShipDef.tier`；敌舰 = 编成条目所引舰级的 `hullClassTier`。
   *  舰级路径卡以外的旧卡无舰种档 → 回落改造前的 170/90（船长 2026-09-11：这批延后）。 */
  const meSize = sizeOfUnit(meShip?.tier, false)
  const foeSizeOf = (tag: string): number =>
    sizeOfUnit(foeAnomaly ? foeShipTierOf(foeAnomaly, tag) : null, !isFoeMainTag(tag))
  /** 视觉行逐舰体积；全灭瞬间仍保留 1 槽（与改造前 `Math.max(1, n)` 同语义：布局不退化） */
  const foeSizesFor = (tags: readonly string[]): number[] =>
    tags.length ? tags.map(foeSizeOf) : [LAY.MAIN]
  /** 敌舰族形键（2026-09-11 起 = 数据侧 `AnomalyDef.foeFamily`；未列卡/异常 → F 制式巡逻兜底） */
  const foeKey = foeFamilyOf(foeAnomaly)
  /** 敌舰显示名（2026-09-09 命名统一：引擎同源推导——舰种名 + 规格词缀，弱规格 = 轻装 X；
   *  异常记录缺失时回退档内单位名/tag——旧档存档字符串不直接参与显示） */
  const foeNameOf = (tag: string): string =>
    foeAnomaly ? foeUnitNameOf(foeAnomaly, tag) : (combat.foeHp[tag]?.name ?? tag)
  const ended = battle.ended !== null
  const defeat = battle.ended === 'foe'

  const realDist = battle.distanceM // 引擎实时距离（交火中每 ~100ms 更新）
  const visM = !fxRead.reset && smoothM !== null ? smoothM : realDist // 换场首帧不借上一场插值位置。
  const now = performance.now()
  const popupClock = battle.lastTickGameMs
  const pct = (m: number): number => approachOf(m, farM, nearM) * 100

  /* ── 敌方"视觉行"与演出期尸骸（2026-09-09 二轮，船长反馈"切换突兀/爆炸未播完/边爆边换位"）：
     尸骸不撤队、原位占槽演完整段（boomAt 前原样停留 → boomAt 起灰化 + 爆炸环 → 淡出）；
     撤出只允许"淡出完成且该尸骸右侧（种子序更靠后）无仍在演出的尸骸"——整批尸骸演完才
     一起收拢一次，存活舰补位不再压着爆炸动画走。几何/弹道按视觉行序（含占位尸骸）计算。 */
  const WRECK_FADE_MS = 520 // 尸骸灰舰淡出时长（爆炸环演出期结束后的收尾段）
  const scanDroppable = (): Set<string> => {
    const drop = new Set<string>()
    let laterVisible = false
    for (let i = foeTags.length - 1; i >= 0; i--) {
      const tag = foeTags[i]!
      if (!deadRef.current.has(tag)) continue
      const ba = corpseAtRef.current.get(tag)
      if (ba === undefined) {
        drop.add(tag) // 无演出登记（已撤/开屏前已死）：永不占位
        continue
      }
      const deathLife = acidDeathsRef.current.has(tag) ? ACID_FX_LIFE_MS : BOOM_LIFE + WRECK_FADE_MS
      if (now < ba + deathLife) laterVisible = true
      else if (!laterVisible) drop.add(tag)
    }
    return drop
  }
  const dropNow = scanDroppable()
  const rowFxTags = foeTags.filter((t) => !deadRef.current.has(t) || !dropNow.has(t))
  /* ── 我方逐舰几何（**必须先于弹道几何算**：2026-09-13 起弹道按发射舰取锚点，见下方 `meAnchorByTag`） ──
     · `multiMe`：单船路径 = false（观感与旧版逐像素一致）；多舰路径 = true（洞内 4 舰）。
     · `mySizes`：逐舰落画体积（阵位序 = core 给的顺序，**主控在前**）。 */
  const multiMe = arcs.myUnits.length > 1
  const mySizes = multiMe
    ? arcs.myUnits.map((u) => sizeOfUnit(fleetDefOf(state, engine.ctx, u.shipId)?.tier, false))
    : [meSize]
  // 弹道瞄准用的几何（按上一帧撤出结果的视觉行；本帧渲染队列在阵亡检测后定稿重算）
  // **多舰路径也要喂我方逐舰体积**（2026-09-13 修"弹道统一从第一艘出"）：否则 `layFx.my` 只有主控一条，
  // 我方每一发都从主控炮口飞出去（船长实测："多船战斗时弹道变成统一由第一艘船射出"）。
  const layFx = layout(dims, foeSizesFor(rowFxTags), visM, farM, nearM, meSize, multiMe ? mySizes : undefined)
  /**
   * **我方逐舰锚点/体积按 tag 索引**（多舰路径）——开火事件 `fx.tag` 就是发射舰（`player` / `ally-N`），
   * 弹道起点取"那一艘"的锚点与舰体尺寸；单船路径为空表 ⇒ 全部回落到 `layFx.me`（观感与旧版逐像素一致）。
   * 无人机（`src='drone'`）例外：机群池按**编队首舰**建（见 D 批边界），其弹道仍从主控一侧起飞。
   */
  const meAnchorByTag = new Map<string, typeof layFx.me>()
  const meSizeByTag = new Map<string, number>()
  if (multiMe) {
    arcs.myUnits.forEach((u, slot) => {
      const a = layFx.my[slot]
      if (a) meAnchorByTag.set(u.tag, a)
      const sz = mySizes[slot]
      if (sz !== undefined) meSizeByTag.set(u.tag, sz)
    })
  }
  /** 无人机攻击阵位外推量（2026-09-11 舰种体积配套）：阵位基线按改造前的敌舰（T3 = 170px 宽）定，
   *  目标舰更大时阵位同步外推，避免机群压在放大的舰体上；敌舰未变大时不内收（下限 0）。 */
  const droneOutward = Math.max(0, Math.round(((layFx.sizes[0] ?? LAY.MAIN) - LAY.MAIN) / 2))

  /* ── 舰首朝向 = 机动意图（各自"想接近还是想拉开"），而非实际位移：
       拔河中即使被拖退也保持"想接近"的冲顶姿态；到达期望距离（差 <2m）保持现状，对峙不抖动 ── */
  const myGap = combat.myDesireM - realDist
  const foeGap = arcs.foeDesireM - realDist
  if (myGap > 2) facingRef.current.meFlip = true // 我方想拉开 → 掉头背向
  else if (myGap < -2) facingRef.current.meFlip = false // 我方想接近 → 船头朝敌
  if (foeGap > 2) facingRef.current.foeFlip = false // 敌想拉开 → 掉头背向
  else if (foeGap < -2) facingRef.current.foeFlip = true // 敌想接近 → 船头朝我
  const { meFlip, foeFlip } = facingRef.current

  /* ── 消费新到达的开火事件（按序号取 seq > lastSeq 的新事件，同帧转弹道 + 闪光；
        环裁剪丢旧事件不影响：序号跳跃即自动跳过丢失部分） ── */
  const arrivals = fxRead.events
  consumeBattleEvents({
    arrivals, meAnchorByTag, layFx, battle, lastHitTypeRef, acidDeathsRef,
    deadRef, corpseAtRef, now, acidFxRef, keyRef, foeSizeOf,
    meSizeByTag, meSize, popupAccRef, arcs, blinkRef, dims,
    foeSizesFor, rowFxTags, visDistRef, farM, nearM, foeSortieRef,
    droneDownRef, dronePrevShowRef, droneSortieRef, foeAliveTags, droneSlotRef, foeDroneAliveOf,
    droneCountOf, droneOutward, foeDroneBuffedOf, meShip, foeKey, muzzleCountRef,
    boltsRef, flashRef,
  })
  // 惰性清理过期元素（渲染输出不再包含它们即从 DOM 移除；延迟弹道按 delay 延长存活）
  boltsRef.current = boltsRef.current.filter((b) => now - b.born < BOLT_LIFE + (b.delay ?? 0))
  flashRef.current = flashRef.current.filter((f) => now - f.at < FLASH_LIFE + (f.delay ?? 0))
  acidFxRef.current = acidFxRef.current.filter(effect => now - effect.born < ACID_FX_LIFE_MS + effect.delay).slice(-48)
  acidFxWakeAtRef.current = Math.min(...acidFxRef.current.map(effect => {
    const start = effect.born + effect.delay
    return now < start ? start : start + ACID_FX_LIFE_MS
  }))
  /**
   * **伤害飘字：每拍把累加结果落成一条飘字**（甲②：同一拍对同一目标只出一个数字）。
   * `popupAccRef` 在本拍的开火循环里累加（key = 目标 tag），这里一次性消费并清空 ⇒ 下一拍重新累计。
   * 生命期读引擎战斗时钟，倍速下跟着快、暂停即冻结；弹道仍沿用原墙钟。
   */
  popupsRef.current = popupsRef.current.filter((p) => popupClock - p.born < POPUP_LIFE)
  if (popupAccRef.current.size > 0) {
    for (const [target, acc] of popupAccRef.current) {
      // **零伤且非未命中 ⇒ 不落飘字**（无伤事件不出「-0」，见上面累加处的口径）
      if (acc.amount <= 0 && !acc.miss) continue
      const occupied = new Set(popupsRef.current.filter(p => p.target === target).map(p => p.slot))
      const slot = Array.from({ length: 9 }, (_, i) => i).find(i => !occupied.has(i)) ?? 0
      // 同一目标占满时替换最早一格，避免延长寿命后重叠或无限积累。
      popupsRef.current = popupsRef.current.filter(p => p.target !== target || p.slot !== slot)
      popupsRef.current.push({
        key: keyRef.current++,
        target,
        slot,
        x: acc.x,
        y: acc.y,
        born: popupClock,
        amount: Math.round(acc.amount),
        type: acc.type,
        miss: acc.amount <= 0,
      })
    }
    popupAccRef.current.clear()
  }
  popupsRef.current = popupsRef.current.filter((p) => popupClock - p.born < POPUP_LIFE).slice(-160)
  // 击落坠落演出：CSS 演完即清（不留常驻 DOM，也不做逐帧 JS 动画）
  if (droneDownRef.current.length > 0) {
    droneDownRef.current = droneDownRef.current.filter(
      (d) => now - d.born < DRONE_DOWN_FREEZE_MS + DRONE_DOWN_LIFE,
    )
  }
  // **闪现跃迁演出**：整段（消失 ＋ 等待 ＋ 出现）过完才清（清了才有下一次的重新触发）
  if (blinkRef.current.size > 0) {
    for (const [tag, b] of blinkRef.current) {
      if (now - b.appear >= b.segMs / 3) blinkRef.current.delete(tag)
    }
  }
  /**
   * 🔴 **该侧"此刻正在演的那一段"**（**2026-10-02 §35 · 全队一起演**）——船长裁定：
   * 「**「全队舰船」是指触发了闪现的舰船所在的队伍。表现全部一致**」。
   *
   * ⇒ 渲染不再按 `tag` 逐舰取（那是"只有触发那艘演"的旧口径），而是取**该侧**在播的那一段，
   * **该侧每一艘**挂同一套表现；"谁真的换了位"由引擎的距离标量决定，与表现无关。
   * ⚠ 时刻仍**全部来自引擎时刻表**（界面不自己另排时间轴 —— §32/§33 两次踩坑的教训）。
   * ⚠ **裁定「1甲」**：一次触发只排一段 ⇒ 这里最多命中一段，不会出现"几段同时演"。
   */
  const blinkSegOfSide = (
    side: 'foe' | 'me',
  ): { vanish: number; move: number; appear: number; segMs: number } | undefined => {
    for (const s of blinkRef.current.values()) {
      if (s.side !== side) continue
      if (now >= s.vanish && now < s.appear) return s
    }
    return undefined
  }
  /**
   * **我方某一艘此刻挂什么闪现表现**（**2026-10-02 §35**）——全队一起演 ⇒ 该侧每艘拿到**同一份**
   * （与敌方那三态**逐字同口径**）：
   * - 消失段（`vanish → move`）：`is-blink-out` ＋ 内联 `--blink-ms`（= 整段的 1/3）；
   * - 等待段（`move → appear`）：`is-blink-hidden`（全透明、无动画）；
   * - 出现段：**不挂类**（`is-blink` 走 `animation: none`，只为压掉挂载基线动画）——与敌方一致。
   */
  const meBlinkFx = (): { cls: string; style: CSSProperties } => {
    const seg = blinkSegOfSide('me')
    if (seg === undefined) return { cls: '', style: {} }
    if (now >= seg.vanish && now < seg.move) {
      return { cls: ' is-blink-out', style: { '--blink-ms': `${seg.segMs / 3}ms` } as CSSProperties }
    }
    if (now >= seg.move && now < seg.appear) return { cls: ' is-blink-hidden', style: {} }
    return { cls: '', style: {} }
  }
  /** 我方全队此刻的闪现表现——§35 队内一致 ⇒ **算一次就够**（单船/多舰两条路径共用） */
  const meFx = meBlinkFx()
  // ⚠ **闪现光柱的清理移到 RAF 里了**（`syncBlinkPillarDom`：它同时要摘 DOM，**不能只清表**）——
  //   这里若也 filter，会留下已经不该存在的表项（DOM 已摘、表还在 ⇒ 那根柱再也建不出来）。

  /* ── 敌方单位被击毁检测（hp 归零的瞬间登记尸骸 + 爆炸计划，演出与战斗是否结束无关）──
     ⚠ **2026-09-14 船长报障修复（甲案）**：「血条打空后，舰船形象和血条都不清理消除」——
     旧判据 `sum === 0 && prev > 0` 要求**看见过它活着**才登记阵亡；而**次波/增援的新单位可能在
     登场第一拍就被我方齐射打死**（真引擎实测：210 场里 81 场复现，幽灵**全部**来自 `w1-/w2-` 增援波），
     于是它永不入 `deadRef` ⇒ 视觉行不撤队 + 血条照画（`corpseOn` 为假才画条）⇒ 舰影与空血条**
     永久留场**。现改为：**只要观察到 0 血且未登记过，就登记阵亡**——
     有前值（正常阵亡）⇒ 照旧演爆炸；**没有前值**（首见即 0 血：漏帧 / 入场期被打死 / 重进战场）
     ⇒ **不登记尸骸 ⇒ `scanDroppable` 立即出队**，不重放爆炸（与 2026-09-10 预登记那条同口径）。 */
  if (!hpInitRef.current) {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      const sum = hp ? hp.s + hp.a + hp.h : 0
      prevHpRef.current.set(tag, sum)
      // 首帧就把"已经是尸体"的登记掉（无声撤出：不写尸骸 ⇒ 不演爆炸）——重进战场/洞内重开面板都走这条
      if (sum === 0) deadRef.current.add(tag)
    }
    hpInitRef.current = true
  } else {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      const sum = hp ? hp.s + hp.a + hp.h : 0
      const known = prevHpRef.current.has(tag)
      const prev = prevHpRef.current.get(tag) ?? 0
      prevHpRef.current.set(tag, sum)
      if (sum === 0 && !deadRef.current.has(tag)) {
        deadRef.current.add(tag) // 阵亡登记（含"首见即 0 血"这一档）
        if (known && prev > 0) {
          // 正常阵亡：爆炸延后到致死弹道着弹后再启动
          // 击杀爆炸延迟 = 致死形态的弹道时长（动能 420 / 导弹 760 / 激光 130），
          // 与命中 puff 同时出现——否则导弹击杀会在弹道半途提前变灰/上移
          const killerType = lastHitTypeRef.current.get(tag)
          const killerFly = (killerType ? BOLT_LOOK[killerType]?.fly : undefined) ?? FLY_MS
          corpseAtRef.current.set(tag, now + killerFly)
        }
      }
    }
  }
  // 队列定稿（2026-09-09 二轮）：阵亡检测后再扫一次撤出集——本帧新阵亡的尸骸（boomAt 未到、
  // 演出期长）计入"演出中"，阻止同帧撤出它左侧已完成淡出的旧尸骸（收拢不撞上新爆炸）；
  // 撤出即清演出登记：跨波之后该尸骸永不回队占位（波次尸骸不得挤占新波队列）。
  const dropFinal = scanDroppable()
  for (const tag of dropFinal) corpseAtRef.current.delete(tag)
  const foeRowTags = foeTags.filter((t) => !deadRef.current.has(t) || !dropFinal.has(t))
  const foeSizes = foeSizesFor(foeRowTags) // 逐舰体积（px；含"全灭保留 1 槽"兜底，与改造前 foeN 同语义）
  /* ═══ 我方舰列：单船 / 4 舰同屏（虫洞 F2b，2026-09-13 船长「我方4条舰船需要同时显示」＋
     「按照敌人阵型那样**镜像排列**」）═══
     · 单船路径（`myUnits.length === 1`）走原分支（`lay.me` / `lay.meLeft`），DOM 与原实现逐字一致；
     · 多舰路径喂 `layout()` 我方逐舰体积 ⇒ 它按**敌人斜向菱形的镜像**给我方逐舰锚点 `lay.my[i]`
       （列序向左展开、第二排左移半个列距 + 下移一行高；主控＝第 0 列最靠敌）。
     · 直径尺锚点仍按主控那条舰；**弹道已改为按发射舰出**（见上 `meAnchorByTag`，2026-09-13 修）。 */
  const mySlots = multiMe ? arcs.myUnits.map((u, slot) => ({ u, slot })) : []
  /** 渲染次序：非主控在前（远的先画）、主控最后（画在最上层） */
  const myDrawOrder = multiMe ? [...mySlots].sort((a, b) => Number(a.u.leader) - Number(b.u.leader)) : []
  /* 2026-09-10 说明：列宽重测**不能**在这里用 useEffect —— 本行位于 `if (!view.combat …) return null`
     守卫之后，战斗结束时提前 return 会跳过该 hook，hooks 数量不一致会让 React 卸载整棵树（黑屏无反应）。
     现改为在守卫之前的 33ms 循环里按 ~330ms 节流核对列宽（见该循环 "列宽核对" 段）。 */
  const lay = layout(dims, foeSizes, visM, farM, nearM, meSize, mySizes)
  /**
   * **跃迁入场**（船长 2026-09-13：「既然开始做战斗效果了，那么能否在开始时做一个入场效果？
   *  为了最小程度防止BUG，**入场效果仅为动画**。玩家和敌舰的位置依旧不改变。入场效果为我方或者敌方
   *  跃迁入场。（**虫洞内为敌方，虫洞外为我方**）」）。
   *
   * ⚠ **2026-09-14 船长改判**（原话「**动画没结束不开火**」，见
   * `docs/design/battle-arrival-window-20260914.md` §6）：「**仅为动画**」这句**不再成立**——
   * 入场现在**同时**带一段"不可被我方选中"的窗口（引擎侧给，窗口与动画**同一个数**）；
   * **仍然成立的是"位置不改"**（那才是原话"为了最小程度防止BUG"的用意）：本层不进 `layout()`、
   * 不碰任何布局/坐标/编队几何/血条锚点/距离尺。**"只演一次"也一并改判**为**逐舰各演一次**。
   *
   * 口径（四条，缺一不可）：
   * 1. **不碰布局**：只给舰船元素加 `is-arriving` + `--arrive-dx/--arrive-ms/--arrive-delay`
   *    （CSS 关键帧做 `translateX(起点) → 0` + 快速淡入，**只走 transform/opacity**），
   *    我方列与敌列的 `left`、编队几何、距离尺全部照旧；
   * 2. **按战斗时钟**：首波 = 开战前 `ARRIVAL_FX_MS`（中途退出再进战场不会重播）；
   *    **此后每一次波次转场/增援 = 引擎 `enteredAtMs` 逐舰驱动**（每一条新舰各演一次）；
   * 3. **谁入场**：虫洞内 = **敌方**跃迁入场（洞里是它们的地盘）；洞外（悬赏/遭遇/教学）= **我方**。
   * 4. **怎么入场**（2026-09-13 船长二次裁定）：「**舰船从屏幕外以减速的形式进场并落到舰船战斗位置。
   *    这里只影响动画。不影响舰船实际位置。**」——即**舰船本体**从**本侧屏幕外**飞入（我方自左缘外、
   *    敌方自右缘外），末段减速落位；**不用**原来的"泳道中线画一圈跃迁环"（那版已删除）。
   *    实现 = 给入场那侧的舰船元素加 `is-arriving` + `--arrive-dx/--arrive-ms/--arrive-delay` 三个变量，
   *    由 CSS 关键帧做 `translateX(起点) → 0` + 快速淡入；**只走 transform/opacity（合成层，不重排）**，
   *    终点恒为 `translateX(0)` ＝ 它的战斗位置 ⇒ 舰船坐标、编队几何、血条锚点、距离尺一字不改；
   *    动画撤掉（窗口结束）时无跳变。
   */
  const ARRIVAL_FX_MS = 1300
  /** 单舰飞入时长（ms）与逐舰错峰（ms）——**与引擎同源**（`core/combat.ts` 的两个常量：
   *  入场窗口就是拿它们算的 ⇒「动画没结束不开火」与"看得见的动画"永远同一个数，不许各写一份）。
   *  ⚠ **倍速批（2026-09-19）**：引擎侧窗口按倍速等比放大（`battleShowWindowMs`：倍速只压战斗进程、
   *  不压演出）⇒ 界面这几处比较也必须过同一个函数，否则"动画演完那一刻窗口正好结束"的同步就断了。
   *  下面读的是**战斗时钟差值**，乘回倍速后对应的**真实时长仍是原值**（动画本身照原速播，未动）。 */
  const ARRIVAL_FLY_MS = BATTLE_ARRIVAL_FLY_MS
  const ARRIVAL_STAGGER_MS = BATTLE_ARRIVAL_STAGGER_MS
  /** 起点余量（px）：让起点**完全落在屏幕外**（泳道 `overflow: hidden`，超出即不可见） */
  const ARRIVAL_EDGE_MARGIN = 40
  /** **开战那一刻谁在入场**（船长 2026-09-13：洞内 = 敌方跃迁入场、洞外 = 我方）——只用于**首波**；
   *  此后每一次波次转场/增援由引擎的 `enteredAtMs` 逐舰驱动（见下 `arrivingTagOf`，船长 2026-09-14「③补」）。 */
  const arrivalSide: 'me' | 'foe' | null =
    battle.lastTickGameMs - battle.startedAtGameMs <= battleShowWindowMs(battle, ARRIVAL_FX_MS) ? (inWormhole ? 'foe' : 'me') : null
  /**
   * **逐舰入场判定**（船长 2026-09-14「③补。并且参考①动画没结束不开火」）：
   * 引擎给**每一次入场**（洞内首波 / 每一次波次转场 / 单波内增援）的每条舰写了 `enteredAtMs`
   * （含逐舰错峰），界面据此**各播一次飞入**——旧实现只看"开战前 1300ms"，次波入场**没有动画**。
   * ⚠ 与引擎的不可选中窗口**同一个数**：动画演完那一刻，窗口也正好结束。
   */
  const arrivingTagOf = (tag: string): boolean => {
    const at = battle.units[tag]?.enteredAtMs
    if (at === undefined) return false
    const since = battle.lastTickGameMs - at
    return since >= 0 && since < battleShowWindowMs(battle, ARRIVAL_FLY_MS)
  }
  const foeArriving = (tag: string): boolean => arrivingTagOf(tag) || arrivalSide === 'foe'
  /** 我方飞入起点位移（负 = 自左缘外飞入；0 = 战斗位置） */
  const arriveDxMe = Math.round(-(lay.me.x + meSize / 2 + ARRIVAL_EDGE_MARGIN))
  /** 敌方逐舰飞入起点位移（正 = 自右缘外飞入；逐舰按各自机位算，斜向菱形两排一致） */
  const arriveDxFoe = (i: number): number => {
    const w = lay.sizes[i] ?? LAY.MAIN
    const x = lay.foe[i]?.x ?? dims.W
    return Math.round(dims.W - x + w / 2 + ARRIVAL_EDGE_MARGIN)
  }
  /* ═══ 我方舰列：单船 / 4 舰同屏（虫洞 F2b，2026-09-13 船长「我方4条舰船需要同时显示」）═══
     · 单船路径（`myUnits.length === 1`）走原分支，DOM 与原实现逐字一致 ⇒ 观感零变化；
     · 多舰路径逐舰一条舰影，锚点取 `lay.my[i]`（**敌人斜向菱形的镜像**，见上）；DOM 顺序把主控放最后
       ＝画在最上层；距离尺/弹道锚点仍按主控那条舰。 */
  /** 阵形（斜向菱形）：列宽/右移/下移/排高 + 逐舰机位（DOM 的两排排布与逐舰微调共用这一份） */
  const foeFormation = lay.formation
  /** 逐舰血条几何（宽/相对本舰偏移；贴各自舰下，拥挤时该排整组竖排到编队下方）——
   *  入参是**逐舰舰底 y**（第一排/第二排舰底差一个排高，堆叠基准必须用真实舰底） */
  const foeBarGeoms = foeBarGeom(
    lay.foe.map((a) => a.x),
    lay.foe.map((a, i) => a.y + ((lay.sizes[i] ?? LAY.MAIN) * 0.46) / 2),
    lay.foeBottom,
  )
  /** 波次演出窗口提示（引擎 waveEnterGapMs 内：上一波全灭、下一波尚未抵达） */
  const wavePending = battle.waveClearAt !== undefined && !ended
  const waveNext = wavePending && foeAnomaly?.waves && foeAnomaly.waves.length > 1 ? (battle.waveIdx ?? 0) + 2 : 0
  /**
   * **战斗窗口正上方的提示位**（2026-09-11 船长：「**日志内不用显示提示，将该提示放入战斗画面内显示**
   * （和**敌方增援**统一下系统，**显示位置改为战斗窗口正上方**）」）——同一处提示位渲染两路来源：
   * ① 波次增援（由 `waveClearAt` 推导，整段增援窗口常显）；② 引擎推来的战斗提示（`battle.notices`，
   * 如「受击增程」），按战斗时钟**限时显示后自动消失**（提示位是"正在发生"，留档归战报）。
   */
  /**
   * 引擎推来的战斗提示**显示时长**（毫秒）——2026-09-12 船长：「顶部的『静滞阵列解除限幅：静滞卫舰
   * 炮台射程 +50%』这类文字显示持续时间**变为 300%**」⇒ 4,000 → **12,000ms**（原值 ×3）。
   * ⚠ 只作用于 ② 引擎提示（`battle.notices`：受击增程 · 敌方增援提示等）；①「敌方增援正在接近…」
   * 是按**增援窗口**（`waveClearAt`）常显的，与固定时长不同源、本次未动。
   */
  const NOTICE_LIFE_MS = 12_000
  const noticeItems: Array<{ key: string; text: string }> = []
  // ⟪文案调整 2026-10-09⟫ 腐蚀累计提示只指装甲，既有英文不追改。
  if (battle.alienCorrosion) noticeItems.push({ key: 'corrosion', text: tr('ui.alienArmor.002', { p1: Math.round(battle.alienCorrosion * 100) }) })
  if (wavePending)
    noticeItems.push({
      key: 'wave',
      text: waveNext > 0 ? tr("ui.BattleScreen.082", { waveNext: waveNext, p2: foeAnomaly?.waves?.length ?? 0 }) : tr("ui.BattleScreen.030"),
    })
  for (const [i, n] of (battle.notices ?? []).entries()) {
    if (battle.lastTickGameMs - n.atMs > battleShowWindowMs(battle, NOTICE_LIFE_MS)) continue
    noticeItems.push({ key: `notice-${i}-${n.atMs}`, text: logText(n) })
  }

  /* 射程弧：锚定双方舰艏枪口（与弹道同源、随舰身移动）。
     显示尺与舰列间距共用同一米制比例：sPxPerM = usable/(farM−nearM) px/m。
     贴脸基准枪口距 gunBasePx 不用猜测常量，而是由"当前帧实测枪口间距 − 当前距离的像素长"反推：
       gunBasePx = (foeGunX − meGunX) − (visM − nearM)×sPxPerM   （几何常数，随窗口/列宽自动成立）
     于是 弧半径(射程) = gunBasePx + (射程 − nearM)×sPxPerM，当 射程 == 当前距离 时弧端恰好触到敌方枪口；
     弧端到敌枪口的像素缺口正比于"射程 − 当前距离"。 */
  const meGunX = lay.me.x + noseOf(meSize)
  const foeGunX = (lay.foe[0]?.x ?? lay.me.x) - noseOf(lay.sizes[0] ?? LAY.MAIN)
  const sPxPerM = lay.usable / Math.max(1, farM - nearM) // 与舰列位移同尺（px/m）
  const gunBasePx = Math.max(40, foeGunX - meGunX - (visM - nearM) * sPxPerM)
  const arcCap = lay.usable + gunBasePx + 80 // 兜底上限：不超"开局枪口位 + 余量"
  const arcR = (rangeM: number, minPx: number): number =>
    Math.max(minPx, Math.min(arcCap, gunBasePx + Math.max(0, rangeM - nearM) * sPxPerM))
  // 主武器弧 = 战术距离口径认定的那件（core `mainWeaponOf` 下发 `isMain`；2026-09-12 船长裁定「甲」，
  // 界面不再自己 find(kind==='gun')——旧写法会把激光船/装近防炮的船的米数刻度画成 2,500m）
  const mainMeArc = arcs.me.find((w) => w.isMain) ?? arcs.me[0]
  const meArcEls = arcs.me.map((w, wi) => {
    const color = w.type ? DMG_COLOR[w.type] : 'rgb(var(--wui-dim))'
    const hollow = w.kind === 'gun' && !w.type
    const inBand = realDist >= w.minM && realDist <= w.maxM // 已进入该武器射程带（按引擎真实距离，避免插值边界抖动）
    const dim = inBand ? 0.25 : 1
    const r1 = arcR(w.maxM, 26)
    // 最小射程内沿：< 近距(200m) 的武器（0m 起）视为"贴脸即可打"，带起点贴回枪口小半径；
    // ≥ 近距的按米差精确落在贴脸基线外侧
    const r0 = w.minM >= nearM ? Math.min(arcR(w.minM, 12), r1 - 4) : Math.min(12, r1 - 4)
    return (
      <g key={`me${wi}`} opacity={(hollow ? 0.55 : 1) * dim}>
        {/* ⚠ fill/stroke 走 style：色值是 `var(--wui-tone-*)`，SVG 呈现属性不认 var() */}
        <path d={fanPath(r0, r1)} style={{ fill: color }} fillOpacity={hollow ? 0 : 0.12} />
        <path d={ringPath(r1)} fill="none" style={{ stroke: color }} strokeWidth={hollow ? 1.2 : 2} strokeDasharray={hollow ? '4 4' : undefined} strokeOpacity={0.85} />
        {w.minM > 0 ? <path d={ringPath(r0)} fill="none" style={{ stroke: color }} strokeWidth={1} strokeDasharray="3 5" strokeOpacity={0.5} /> : null}
      </g>
    )
  })
  const foeColor = DMG_COLOR[arcs.foe.type]
  const foeR1 = arcR(arcs.foe.maxM, 26)
  const foeR0 = arcs.foe.minM >= nearM ? Math.min(arcR(arcs.foe.minM, 12), foeR1 - 4) : Math.min(12, foeR1 - 4)
  const foeInBand = realDist >= arcs.foe.minM && realDist <= arcs.foe.maxM // 我方已进入敌方有效射程带（引擎真实距离）
  const meMainR1 = mainMeArc ? arcR(mainMeArc.maxM, 26) : 0

  /* 弹药（显示层） */
  const ammoChips = DMG_ORDER.filter((t) => arcs.ammo[ammoKey(t)] > 0)

  /* 敌方冲锋（2026-09-14 逐单位）：可能同时多条在冲 ⇒ 标记带条数；口径与引擎同源（core 的 `foeChargeCount`） */
  const foeCharging = battle ? foeChargeCount(battle) : 0

  /* 船体维修装置状态（2026-09-09；**2026-09-16 逐舰**）：运转中（绿点呼吸）/ 组件耗尽停机（暗红）；徽标在弹药旁。
     逐舰化后徽标是**全队合计**（任何一艘在跑 ⇒ 亮"运转中"），悬停列出逐舰明细（谁在跑、各剩多少组件）。 */
  const repairLedgers = repairLedgersOf(battle)
  /**
   * ⚠ **2026-09-24 玩家报障**（船长转述：「进入战斗后维修组件显示为 0，仓库已经确认还有 400 多个
   * 军用维修组件」）：改"按需取用"之后账本 `kits` **不再预载** ⇒ 原先累加 `ledger.kits` 恒得 0。
   * 现改读**可用池**（`repairKitAvailableOf`，与那一跳实际会扣的池同源：**开 = 母港仓库 · 关 = 本舰货仓**）。
   * ⚠ 一舰多台装置**共享同一池** ⇒ 每舰按 `kitId` **去重**后再求和；开（仓库）模式下全队共用一份，
   * 故全队合计只按"全队用到的 kitId"各记一次（不按舰重复计）。
   */
  type KitLedger = { units: { kitId: string; free?: boolean }[] }
  const kitIdsOf = (ledger: KitLedger): string[] => [
    ...new Set(ledger.units.filter((u) => u.free !== true).map((u) => u.kitId)),
  ]
  const kitsLeftOf = (tag: string, ledger: KitLedger): number => {
    const shipId = battle.myFleet?.find((m) => m.tag === tag)?.shipId ?? engine.state.shipId
    return kitIdsOf(ledger).reduce((n, kitId) => n + repairKitAvailableOf(engine.state, shipId, kitId), 0)
  }
  const repairTotal =
    engine.state.resupplyFromWarehouse !== false
      ? // 开：全队共用母港仓库 ⇒ 按"全队用到的 kitId"各记一次
        [...new Set(repairLedgers.flatMap((e) => kitIdsOf(e.ledger)))].reduce(
          (n, kitId) => n + repairKitAvailableOf(engine.state, engine.state.shipId, kitId),
          0,
        )
      : // 关：各舰各吃自己货仓 ⇒ 逐舰相加（不重叠）
        repairLedgers.reduce((n, e) => n + kitsLeftOf(e.tag, e.ledger), 0)
  const repairRunning = repairLedgers.some((e) => e.ledger.units.some((u) => !u.stopped))
  const repairDetail = repairLedgers
    .map((e) => {
      const kits = kitsLeftOf(e.tag, e.ledger)
      const running = e.ledger.units.some((u) => !u.stopped)
      const who = e.tag === 'player' ? tr("ui.BattleScreen.031") : tr("ui.BattleScreen.083", { p1: e.tag.replace('ally-', '') })
      return tr("ui.BattleScreen.084", { who: who, p2: running ? tr("ui.BattleScreen.032") : tr("ui.BattleScreen.033"), p3: kits.toLocaleString('zh-CN') })
    })
    .join('\n')

  /* 距离滑条：值 = 接近度×1000（0 最远拉开 → 1000 贴脸），右拖 = 接近 */
  const desireM = Math.min(farM, Math.max(nearM, combat.myDesireM))
  const sliderV = dragV ?? approachOf(desireM, farM, nearM) * 1000
  const sliderToDesire = (v: number): number => Math.round(farM - (v / 1000) * (farM - nearM))
  /**
   * 提交一次期望距离：`persist = true` 的调用点 = **松手那一次**与**战术按钮那一次**
   * （2026-10-02 修：拖动中的节流提交不写盘，收尾必须写——否则拖完立刻关游戏会把这次选择丢掉）。
   */
  const commitDesire = (v: number, persist = false): void => {
    const r = engine.battleSetDesireAt(Math.min(sliderToDesire(v), arcs.desireMaxM), persist)
    if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.172'), true)
  }
  /**
   * 拖动中：**节流提交**（把期望距离写进引擎，远征按星系记忆 / 洞内记在本趟），
   * 但 **`dragV` 一直留到松手**（2026-09-13 船长反馈"一格一格地移动"）——
   * 首版这个定时器顺手 `setDragV(null)`：手指还按着时，滑条会每 160ms 被"回弹到上一次提交值"，
   * 拖起来就是一跳一跳的。提交归提交，**画面跟随归画面跟随**，松手才收。
   */
  /**
   * **拖动中的"跟手"重绘**：合并到 `requestAnimationFrame`，**每帧最多一次 setState**——
   * 高回报率鼠标（125~1000Hz）一次拖动能产生几百个 `input` 事件，逐个 setState 会把整棵战场
   * （我方 4 舰 + SVG 射程弧 + 事件环）重渲染几百次 ⇒ 顿挫（船长 2026-09-13：「依旧还是有顿挫感」）。
   */
  const pushDragV = (v: number): void => {
    dragPendingRef.current = v
    if (dragRafRef.current !== null) return
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null
      const pending = dragPendingRef.current
      if (pending !== null) setDragV(pending)
    })
  }
  const scheduleCommit = (v: number): void => {
    dragValRef.current = v
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      commitDesire(v)
    }, 160)
  }
  /** 松手/失焦：补最后一次提交，并交还"跟随态" */
  const flushDrag = (): void => {
    const v = dragValRef.current
    dragValRef.current = null
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (v !== null) commitDesire(v, true)
    setDragV(null)
  }
  const applyTactic = (t: 'assault' | 'mid' | 'kite'): void => {
    const m = battleTacticDesire(state, engine.ctx, t)
    commitDesire(approachOf(m, farM, nearM) * 1000, true)
  }

  const meStats = battle.stats
  const secs = Math.max(1, Math.round((state.gameMs - battle.startedAtGameMs) / 1000))

  /* 弹道（旋转容器内沿 +x 飞行）+ 撞点特效（CSS 延迟到着弹时刻）——
     2026-09-05 三族观感分家：动能=快曳光 / 导弹=慢速虚线尾焰 / 激光=近瞬光束线 */
  const { webEls, popupEls, boltEls, muzzleEls } = buildProjectileLayers({ rowFxTags, layFx, multiMe, meAnchorByTag, arcs, tr, popupsRef, dims, popupClock, boltsRef, flashRef })

  /* 无人机机群层（2026-09-10 船长批；每型上限 6 架 + ×N 徽标）——
     数据源 = 射程弧里已合并的「机型 ×N」无人机条目（src='drone'）；渲染按单位锚点定位，
     未来副本机制的多船舰队只要把友军单位的机群也喂进这一层即可（接口已按单位设计）。
     单轮时序（与弹道同源）：放出 →（去程 0.56s）→ 到阵位即开火 → 立刻掉头返航（0.62s）→ 收舱待命。 */
  const { droneWings, foeWings } = buildDroneDrive({ arcs, droneSortieRef, now, dronePrevShowRef, visDistRef, visM, droneDriveRef, meAnchorByTag, foeSortieRef, foeSizes, meSize, farM, nearM })

  const { foeRowBoxes } = buildEnemyLayers({
    arcs, foeRowTags, isFoeMainTag, battle, tr, lay,
    foeFormation, foeBarGeoms, foeAnomaly, corpseAtRef, now, acidDeathsRef,
    combat, blinkSegOfSide, WRECK_FADE_MS, foeArriving, arriveDxFoe, ARRIVAL_FLY_MS,
    arrivalSide, ARRIVAL_STAGGER_MS, foeKey, foeFlip, foeNameOf,
  })

  return renderBattleScene({
    rangeMode, screenRef, stage, onClose, tr, inWormhole,
    retreatAsk, setRetreatAsk, onToast, engine, ended, defeat,
    sceneName, secs, meStats, speedOptions, speedActive, arcs,
    foeCharging, ammoChips, repairLedgers, repairRunning, repairDetail, repairTotal,
    stageRef, fitRef, laneRef, starField, starLayerRefs, dims,
    meGunX, lay, meArcEls, foeGunX, foeInBand, foeR0,
    foeR1, foeColor, mainMeArc, meMainR1, multiMe, myDrawOrder,
    state, meFx, arrivalSide, arriveDxMe, ARRIVAL_FLY_MS, ARRIVAL_STAGGER_MS,
    meFlip, meColRef, meShip, meRole, meSize, combat,
    droneWings, foeWings, droneDownRef, droneBoxRef, droneElsRef, foeSortieRef,
    now, meFxRootRef, foeColRef, foeAnomaly, foeFormation, foeRowBoxes,
    noticeItems, webEls, muzzleEls, boltEls, acidFxRef, meAnchorByTag,
    layFx, popupEls, farM, nearM, visM, pct,
    sliderV, pushDragV, scheduleCommit, flushDrag, dragV, sliderToDesire,
    applyTactic,
  })
}
