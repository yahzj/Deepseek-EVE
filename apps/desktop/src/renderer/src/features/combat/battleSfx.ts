/**
 * **战斗音效桥**（2026-11-02 起；2026-11-05 按船长令改为「跟着动画节点响」）—— 只读战斗演出流，
 * 给声音系统提供战斗事件。
 *
 * 接线方式：`BattleScreen` 在所有 hook 之后、早退之前调用一次 `useBattleSfx(...)`；
 * 本 hook 自己维护一份**独立的** `battleFxArrivals` 游标（与画面那份互不消耗），
 * 每帧重渲染后读新事件。
 *
 * ## 响的时刻（2026-11-05 船长：「战斗的音频触发跟战斗的动画强相关」
 *  ＋「爆炸要用到击中动画的开始，被击中要用到攻击动画的结束」）
 * - **开火音 = 炮口闪光那一帧**（延迟 0，画面 `born: now`）。
 * - **命中 / 被击中音 = 攻击动画放完**（＝击中动画开始）：延迟 = 该发弹型的飞时
 *   （动能 420ms / 导弹 760ms / 激光 130ms；机群按机型系数）。换算集中在
 *   `battleSfxPlan.ts`，与 `buildProjectileLayers` 用同一份 `BOLT_LOOK`。
 * - **未命中 puff** 同样落在弹道终点 ⇒ `combat-miss` 也按飞时延迟。
 * - **敌舰爆炸 = 击中动画开始**：延迟 = 致死弹型飞时（与 `BattleScreen` 的 `corpseAt` 同口径）。
 * - **敌机被点防击落**（`side='foe'` 且 `droneDown`）画面同帧起播 ⇒ 延迟 0；
 *   我方机群被击落是 `side='me'` 的同名事件，不是「击毁敌方」，不响。
 *
 * ## 口径与边界
 * - **机群齐射两侧都不出开火音**（画面是逐架小曳光点；命中/受击照常按弹道落地出声）。
 * - 捕获网 / 闪现 / 爆虫本体 / 近防打机群不是普通弹道，不出开火与命中音。
 * - 未被敌方命中的落空不算「被击中」，不出声（只有我方未命中出 `combat-miss`）。
 * - 只在战场**上屏**（`visible`）时出声：收起战场期间**推进游标但不播**（回来后不补播旧音），
 *   阵亡扫描照常记账，回来也不会把期间沉的舰一次性补一串爆炸音。
 * - 换战斗 / 卸载时清掉还没到点的延迟音：新一场战斗不承接上一场的余音
 *   （终局不清：最后一轮爆炸音照常响完）。
 * - 装配页射程模拟（`rangeMode`）用 `enabled:false` 整个关掉。
 *
 * ## 两条容易踩的边界
 * 1. **中途打开战场**（自动战斗/最小化后点回来）不为"已经阵亡的单位"补播——建桥时先灌基线；
 * 2. **撤退/超时/够不着自动撤离不会写 `battle.ended`**（core 直接把 `exp.battle` 清空）
 *    ⇒ 战斗对象消失或战场卸载时，若本场 `ended` 仍为 null，补一次 `combat-lose`。
 *    胜利/负场已写 `ended`，不会被这条兜底重复播。
 */
import { useEffect, useRef } from 'react'
import type { BattleFx, BattleState } from '@whale/core'

import type { SfxCueId } from '../../game/audio/cues'
import { rerollBgmVariant } from '../../game/audio/music'
import { playCue } from '../../game/audio/player'
import { battleFxArrivals } from './battleFxCursor'
import type { BattleFxCursor } from './battleFxCursor'
import { killExplosionDelayMs, planBattleFx } from './battleSfxPlan'

interface Track {
  battle: BattleState
  deadFoes: Set<string>
  deadMe: Set<string>
  ended: 'me' | 'foe' | null
  /** 各目标最近一次**我方命中**的弹型（击毁爆炸延迟用；与画面 `lastHitTypeRef` 同口径） */
  lastHitType: Map<string, BattleFx['type']>
}

/** 建一场战斗的基线：已阵亡单位先记进去（中途打开战场不补播旧阵亡） */
function createTrack(battle: BattleState): Track {
  const track: Track = {
    battle,
    deadFoes: new Set(),
    deadMe: new Set(),
    ended: battle.ended,
    lastHitType: new Map(),
  }
  for (const unit of Object.values(battle.units)) {
    if (unit.hp.s + unit.hp.a + unit.hp.h > 0) continue
    if (unit.side === 'foe') track.deadFoes.add(unit.tag)
    else track.deadMe.add(unit.tag)
  }
  return track
}

/** 战斗音效（无返回值；不参与渲染与判定） */
export function useBattleSfx({
  battle,
  visible,
  enabled = true,
}: {
  battle: BattleState | null
  visible: boolean
  enabled?: boolean
}): void {
  const cursorRef = useRef<BattleFxCursor>({ seq: -1 })
  const trackRef = useRef<Track | null>(null)
  /** 已排定、还没到点的延迟音（换场/终局/卸载时统一清掉） */
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set())
  /** 定时器回调与 effect 共用同一份可见性判断（回调里不能闭包旧值） */
  const audibleRef = useRef(false)

  const clearPending = (): void => {
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current.clear()
  }

  /** 排一条音：0 延迟立刻响；否则到点再响（期间收起战场/关掉音效就丢弃） */
  const schedule = (cue: SfxCueId, delayMs: number): void => {
    if (delayMs <= 0) {
      if (audibleRef.current) playCue(cue)
      return
    }
    const id = setTimeout(() => {
      timersRef.current.delete(id)
      if (audibleRef.current) playCue(cue)
    }, delayMs)
    timersRef.current.add(id)
  }

  useEffect(() => {
    if (!enabled) {
      audibleRef.current = false
      clearPending()
      return
    }
    audibleRef.current = visible
    // 战斗对象消失（撤退/超时/够不着自动撤离不会写 ended）⇒ 清掉余音并补一次失败音
    if (battle === null) {
      clearPending()
      const track = trackRef.current
      trackRef.current = null
      if (track !== null && track.ended === null) playCue('combat-lose')
      return
    }
    let track = trackRef.current
    if (track === null || track.battle !== battle) {
      // 新一场战斗（清剿连打=新 battle 对象）：先清上一场还没到点的音，再换 BGM 变体
      clearPending()
      if (track !== null && track.battle !== battle && visible) rerollBgmVariant('bgm-battle')
      track = createTrack(battle)
      trackRef.current = track
      cursorRef.current = { seq: -1 }
    }
    // 终局先记账（即使屏已收起，也免得卸载时把已分胜负的场次误判成撤退）
    if (battle.ended !== null && track.ended === null) {
      track.ended = battle.ended
      // 结算音**不清理**还在飞的弹着/爆炸音：终局那一拍往往正是炸得最密的时候，
      // 压掉会让最后一轮爆炸变成静音；新一场战斗开始时才清。
      if (visible) playCue(battle.ended === 'me' ? 'combat-win' : 'combat-lose')
    }
    // **游标始终推进**：收起战场期间到达的事件不入声，回来时也不会补播
    const { events } = battleFxArrivals(cursorRef.current, battle)
    if (visible) {
      for (const fx of events) {
        // 与画面 `lastHitTypeRef` 同口径：只记我方命中的弹型（攻击方弹型决定爆炸延迟）
        if (fx.side === 'me' && fx.hit && fx.to !== undefined) track.lastHitType.set(fx.to, fx.type)
        for (const planned of planBattleFx(fx)) schedule(planned.cue, planned.delayMs)
      }
    }
    // 阵亡扫描：不可见时只记账不出声（收起战场期间沉的舰不能在上屏时补一串爆炸音）
    for (const unit of Object.values(battle.units)) {
      const dead = unit.hp.s + unit.hp.a + unit.hp.h <= 0
      if (!dead) continue
      if (unit.side === 'foe') {
        if (track.deadFoes.has(unit.tag)) continue
        track.deadFoes.add(unit.tag)
        // 敌舰爆炸：与画面 `corpseAt = now + killerFly` 同一刻
        if (visible) schedule('combat-foe-down', killExplosionDelayMs(track.lastHitType.get(unit.tag)))
      } else if (!track.deadMe.has(unit.tag)) {
        track.deadMe.add(unit.tag)
        // 我方舰船被击毁没有「致死弹道落点」演出，画面即时 ⇒ 立即响
        if (visible) schedule('combat-me-down', 0)
      }
    }
  })

  // 战场卸载 / 音频关闭兜底：清掉待播音，这一场还没记过胜负就补一次失败音
  useEffect(
    () => () => {
      clearPending()
      audibleRef.current = false
      const track = trackRef.current
      trackRef.current = null
      if (track !== null && track.ended === null) playCue('combat-lose')
    },
    [],
  )
}
