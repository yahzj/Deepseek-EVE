/**
 * **战斗音效排期**（2026-11-05 按船长令新建）——把一条战斗事件换算成「该响什么音、延迟多少毫秒」。
 *
 * 船长原话：
 * - 「战斗的音频触发跟战斗的动画强相关」；
 * - 「找找动画开始和结束的位置才能判断对错，比如**爆炸要用到击中动画的开始**，
 *   **被击中要用到攻击动画的结束**，这两个节点比较重要。」
 *
 * 所以这里的延迟一律跟**画面用的同一个节点**对齐：
 * - 开火音 = 炮口闪光那一帧（`consumeBattleEvents` 推 `flashRef`，`born: now`）⇒ 0ms；
 * - 命中 / 被击中 / 未命中 puff = 弹道飞完那一刻（`buildProjectileLayers` 的
 *   `animationDelay: look.fly`）⇒ 延迟 = `boltFlightMs(...)`；
 * - 敌舰爆炸 = 击中动画开始（`BattleScreen` 的 `corpseAt = now + killerFly`）⇒ 延迟 = 致死弹型飞时；
 * - 敌机被点防击落 = 同帧起播 ⇒ 0ms。
 *
 * 飞时常量集中在 `attackTiming.ts`（无 JSX 的纯模块），与 `buildProjectileLayers`、
 * `BattleScreen` 共用同一份来源，避免声音和画面各写一套数字。
 */
import type { BattleFx } from '@whale/core'

import type { SfxCueId } from '../../game/audio/cues'
import { boltFlightMs, explosionDelayMs } from './attackTiming'

/** 一条待播的提示音：`delayMs` 之后才响（0 表示就在这一帧） */
export interface PlannedCue {
  cue: SfxCueId
  delayMs: number
}

/** 弹型 → 炮口/弹道的开火音（三族分家，缺素材时 cues.ts 内回落旧 `combat-fire`） */
const FIRE_BY_TYPE: Record<BattleFx['type'], SfxCueId> = {
  kinetic: 'combat-fire-kinetic',
  explosive: 'combat-fire-explosive',
  plasma: 'combat-fire-plasma',
}

/** 这条事件是不是机群弹道（机群齐射不出开火音） */
function isDroneShot(fx: BattleFx): boolean {
  return fx.src === 'drone'
}

/**
 * 一条战斗事件 → 待播音（可能 0～2 条：开火 + 落点）。
 *
 * 边界（与画面同口径）：
 * - `web` / `blink` / `acidBurst` / `pd` 不是普通弹道演出，不出声；
 * - 机群（`src='drone'`）两侧都不出开火音——画面是逐架小曳光点，密集时会糊成噪音；
 * - `droneDown` 且 `side='foe'` = 敌机被点防打掉（画面同帧爆），出声；`side='me'` 是我方机群被击落，
 *   不是"击毁敌方"，不响；
 * - 命中/未命中只对**我方**出落点音：敌方落空（未命中我方）画面上没有 puff，也不该响。
 */
export function planBattleFx(fx: BattleFx): PlannedCue[] {
  if (fx.repair || fx.web === true || fx.blink === true || fx.acidBurst === true) return []
  if (fx.droneDown === true) {
    return fx.side === 'foe' ? [{ cue: 'combat-foe-down', delayMs: 0 }] : []
  }
  if (fx.pd === true) return []

  const out: PlannedCue[] = []
  const flightMs = boltFlightMs(fx.type, fx.src, fx.artId)

  // 开火：我方三族分家；敌方主武器一条统配；机群两侧都不出
  if (!isDroneShot(fx)) {
    if (fx.side === 'me') out.push({ cue: FIRE_BY_TYPE[fx.type] ?? 'combat-fire', delayMs: 0 })
    else out.push({ cue: 'combat-foe-fire', delayMs: 0 })
  }

  // 落点：命中 = 攻击动画结束（＝击中动画开始）；我方落空 = 弹道终点的未命中 puff
  if (fx.hit === true) {
    out.push({ cue: fx.side === 'me' ? 'combat-hit' : 'combat-hurt', delayMs: flightMs })
  } else if (fx.side === 'me' && !isDroneShot(fx)) {
    out.push({ cue: 'combat-miss', delayMs: flightMs })
  }
  return out
}

/** 敌舰爆炸延迟（ms）：致死弹型飞时；没有记录时回落基础飞时（与 `BattleScreen` 同口径） */
export function killExplosionDelayMs(killerType: BattleFx['type'] | undefined): number {
  return explosionDelayMs(killerType)
}
