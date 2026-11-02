/**
 * **战斗音效桥**（2026-11-02）—— 只读战斗演出流，给声音系统提供战斗事件。
 *
 * 接线方式：`BattleScreen` 在所有 hook 之后、早退之前调用一次 `useBattleSfx(...)`；
 * 本 hook 自己维护一份**独立的** `battleFxArrivals` 游标（与画面那份互不消耗），
 * 每帧重渲染后读新事件。判定口径与画面同源：
 * - 我方开火（`side='me'`，排除机群/捕获网/闪现/爆虫/近防打机群）；
 * - 命中 / 受击（`hit`）；
 * - 敌机被点防击落（`droneDown`）；
 * - 单位血量归零（击毁敌舰 / 我方舰船沉没）；终局 `battle.ended` 只报一次。
 *
 * 不新造战斗判定：死亡看 `battle.units[].hp` 三层之和，终局看 `battle.ended`（core 的既有字段）。
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
  // 捕获网连线 / 闪现 / 爆虫本体 / 近防打机群：都不是普通开火弹道，不出开火音
  if (fx.web === true || fx.blink === true || fx.acidBurst === true) return
  if (fx.droneDown === true) {
    // 敌机被点防击落：归到"击毁敌舰/敌机"那一路，避免和开火音叠
    playCue('combat-foe-down')
    return
  }
  if (fx.pd === true) return
  if (fx.side === 'me' && fx.src !== 'drone') playCue('combat-fire')
  if (fx.hit) playCue(fx.side === 'me' ? 'combat-hit' : 'combat-hurt')
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
    if (!enabled || !visible || battle === null) return
    let track = trackRef.current
    if (track === null || track.battle !== battle) {
      track = { battle, deadFoes: new Set(), deadMe: new Set(), ended: battle.ended }
      trackRef.current = track
      cursorRef.current = { seq: -1 }
    }
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
    if (battle.ended !== null && track.ended === null) {
      track.ended = battle.ended
      playCue(battle.ended === 'me' ? 'combat-win' : 'combat-lose')
    }
  })
}
