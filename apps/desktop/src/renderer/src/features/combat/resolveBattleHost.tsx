/** 战斗界面职责：resolveBattleHost，保持原调用顺序。 */

import { battleArcsFor, expeditionStatus, weekendFlagshipBattleViewOf, wormholeBattleViewOf } from '@whale/core'

import type { GameEngine } from '../../game/engine'

export function resolveBattleHost({ state, engine, tr }: {
state: import('@whale/core').GameState
engine: Pick<GameEngine, "state" | "ctx" | "wormholeSpeedActive" | "wormholeSpeedOptions" | "setWormholeSpeed" | "battleSetDesireAt" | "retreatNow">
tr: (id: string, params?: Record<string, string | number>) => string
}) {
/** 洞内战斗视图（F2 · 2026-09-13）：有它就用它，否则照旧走远征口径 */
  const whView = wormholeBattleViewOf(state, engine.ctx)
  /**
   * **旗舰战视图**（2026-09-25 加 · 船长报障「旗舰战无法进入战斗画面」）：
   * 编队战承载在遭遇槽 ⇒ 与洞内同款的"第三个宿主"，形状对齐后一并走下面这套渲染。
   * 三口径优先级：洞内（专有规则：不给撤退 / 有倍速）→ 旗舰战 → 远征。
   */
  const wkView = weekendFlagshipBattleViewOf(state, engine.ctx)
  const host = whView ?? wkView
  const view = expeditionStatus(state, engine.ctx)
  const combatView = view.combat ?? host?.combat ?? null
  const whBattle = state.wormhole.run?.battle
  const sceneName = whBattle?.wormhole ? tr(state.wormhole.run?.expeditionRules === 2 ? 'ui.explorationName.015' : 'ui.explorationName.014', { p1: tr(whBattle.wormhole.kind === 'boss' ? 'ui.explorationName.016' : whBattle.wormhole.kind === 'ruins' ? 'ui.explorationName.017' : 'ui.explorationName.005', { p1: whBattle.wormhole.depth }) }) : view.combat ? view.anomalyName : (host?.name ?? '')
  /** 本场是不是洞内战斗（洞内**不能中途撤退**——船长第 8 条）；旗舰战**可以**撤退（照记母舰伤害） */
  const inWormhole = !!whView && !!combatView
  /**
   * **洞内倍速控件**（2026-09-19 谜质科技「时间压缩矩阵」·解挂 `battle-speed-20260919.md`）：
   * 位置 = 战斗窗口**顶部中间、距离条上方**（船长口径）；**只显示已解锁档**，未解锁（只有 1×）⇒ 整个控件不出现。
   * 档位选择存在渲染层会话内存里（`engine.setWormholeSpeed`），引擎每拍再夹一次 ⇒ 界面传错也拿不到未解锁速度。
   */
  const speedOptions = inWormhole ? engine.wormholeSpeedOptions() : []
  /** 高亮档 = 实际生效档（与引擎同一把尺：选过且仍解锁 ⇒ 选的；否则 = 已解锁最高档） */
  const speedActive = engine.wormholeSpeedActive()
  const arcs = battleArcsFor(
    state,
    engine.ctx,
    // 三口径：洞内 / 旗舰战各带自己的宿主上下文；都没有 ⇒ 远征（`null` = 旧口径，逐字不变）
    host ? { battle: host.battle, anomaly: host.anomaly, leaderShipId: host.leaderShipId } : null,
  )
  /**
   * ⚠ `expedition.battle` 只此一处（content-check「战斗宿主双口径契约」会扫）：三口径解析写在同一行，
   * 且**必须带 `whView`**（洞内优先）——旗舰战（`wkView`）与远征各自兜后。
   */
  const battle = whView ? whView.battle : wkView ? wkView.battle : state.expedition.battle
return { combatView, inWormhole, arcs, battle, sceneName, speedOptions, speedActive }
}
