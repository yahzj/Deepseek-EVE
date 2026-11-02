/**
 * **战斗音效桥**（2026-11-02）—— 只读战斗演出流，给声音系统提供战斗事件。
 *
 * 接线方式：`BattleScreen` 在所有 hook 之后、早退之前调用一次 `useBattleSfx(...)`；
 * 本 hook 自己维护一份**独立的** `battleFxArrivals` 游标（与画面那份互不消耗），
 * 每帧重渲染后读新事件。判定口径与画面同源：
 * - 我方开火（`side='me'`，排除机群/捕获网/闪现/爆虫/近防打机群；无人机齐射不响）；
 * - 命中 / 受击（`hit`）；**敌机被点防击落**（`side='foe'` 且 `droneDown`；我方机群被击落是
 *   `side='me'` 的同名事件，不是"击毁敌方"，不响——见 core `combatDrones.ts` / `playerFire.ts`）；
 * - 单位血量归零（击毁敌舰 / 我方舰船沉没）；
 * - 终局 `battle.ended` 只报一次（`'me'`=胜、`'foe'`=负）。
 *
 * 两条容易踩的边界：
 * 1. **中途打开战场**（自动战斗/最小化后点回来）不为"已经阵亡的单位"补播——建桥时先灌基线；
 * 2. **撤退/超时/够不着自动撤离不会写 `battle.ended`**（core 直接把 `exp.battle` 清空）
 *    ⇒ 战斗对象消失或战场卸载时，若本场 `ended` 仍为 null，补一次 `combat-lose`。
 *    胜利/负场已写 `ended`，不会被这条兜底重复播。
 *
 * 只在战场**上屏**（`visible`）时出声；自动战斗/最小化后台推进不出声。装配页射程模拟
 * （`rangeMode`）用 `enabled:false` 整个关掉，避免模拟打出真实战斗音。
 */
import { useEffect, useRef } from 'react'
import type { BattleFx, BattleState } from '@whale/core'
import { battleFxArrivals } from './battleFxCursor'
import type { BattleFxCursor } from './battleFxCursor'
import { playCue } from '../../game/audio/player'

interface Track {
  battle: BattleState
  deadFoes: Set<string>
  deadMe: Set<string>
  ended: 'me' | 'foe' | null
}

function handleFx(fx: BattleFx): void {
  // 捕获网连线 / 闪现 / 爆虫本体：都不是普通开火弹道，不出开火音
  if (fx.web === true || fx.blink === true || fx.acidBurst === true) return
  if (fx.droneDown === true) {
    // 我方机群被敌近防击落（side='me'）不是"击毁敌方"，不响；只认击落敌机
    if (fx.side === 'foe') playCue('combat-foe-down')
    return
  }
  if (fx.pd === true) return
  if (fx.side === 'me' && fx.src !== 'drone') playCue('combat-fire')
  if (fx.hit) playCue(fx.side === 'me' ? 'combat-hit' : 'combat-hurt')
}

/** 建一场战斗的基线：已阵亡单位先记进去（中途打开战场不补播旧阵亡） */
function createTrack(battle: BattleState): Track {
  const track: Track = { battle, deadFoes: new Set(), deadMe: new Set(), ended: battle.ended }
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

  useEffect(() => {
    if (!enabled) return
    // 战斗对象消失（撤退/超时/够不着自动撤离不会写 ended）⇒ 补一次失败音
    if (battle === null) {
      const track = trackRef.current
      trackRef.current = null
      if (track !== null && track.ended === null) playCue('combat-lose')
      return
    }
    let track = trackRef.current
    if (track === null || track.battle !== battle) {
      track = createTrack(battle)
      trackRef.current = track
      cursorRef.current = { seq: -1 }
    }
    // 终局先记账（即使屏已收起，也免得卸载时把已分胜负的场次误判成撤退）
    if (battle.ended !== null && track.ended === null) {
      track.ended = battle.ended
      if (visible) playCue(battle.ended === 'me' ? 'combat-win' : 'combat-lose')
    }
    if (!visible) return
    const { events } = battleFxArrivals(cursorRef.current, battle)
    for (const fx of events) handleFx(fx)
    for (const unit of Object.values(battle.units)) {
      const dead = unit.hp.s + unit.hp.a + unit.hp.h <= 0
      if (!dead) continue
      if (unit.side === 'foe') {
        if (!track.deadFoes.has(unit.tag)) {
          track.deadFoes.add(unit.tag)
          playCue('combat-foe-down')
        }
      } else if (!track.deadMe.has(unit.tag)) {
        track.deadMe.add(unit.tag)
        playCue('combat-me-down')
      }
    }
  })

  // 战场卸载兜底：这一场还没记过胜负就卸载（撤退路径）⇒ 补一次失败音
  useEffect(
    () => () => {
      const track = trackRef.current
      trackRef.current = null
      if (track !== null && track.ended === null) playCue('combat-lose')
    },
    [],
  )
}
