/**
 * **攻击演出的时基常量**（2026-11-05 抽出，为的是「声音与画面用同一份飞时」）。
 *
 * 为什么单独一个 `.ts`：音效排期 `battleSfxPlan.ts` 需要和画面完全一致的弹道飞时，
 * 而 `battleViewCore.tsx` / `droneArt.tsx` 是 JSX 模块（无人机机体表在模块顶层就是 JSX），
 * 纯 node 脚本与确定性用例加载不了。把**时基数据**落到无 JSX 的纯模块，
 * 画面（`buildProjectileLayers` / `BattleScreen`）与声音（`battleSfxPlan`）就共用同一份来源。
 *
 * 口径（原样搬自 `battleViewCore.tsx`，2026-09-05 船长：三族弹道观感分家）：
 * - kinetic 动能炮：快速曳光（默认 420ms）；
 * - explosive 导弹：慢速、虚线尾焰（760ms）——视觉上“追着飞”；
 * - plasma 激光/能量：近瞬光束（130ms）+ 细长光束线。
 */
import type { BattleFx, DamageType } from '@whale/core'

/** 弹道飞行时长 ms（撞点特效靠 CSS 动画延迟到此刻出现） */
export const FLY_MS = 420

/** 攻击形态演出参数（飞时长 + 虚线尾焰间隔） */
export const BOLT_LOOK: Record<DamageType, { fly: number; dash: number | null }> = {
  kinetic: { fly: 420, dash: null },
  explosive: { fly: 760, dash: 14 },
  plasma: { fly: 130, dash: null },
}

/** 无人机弹道提速系数（2026-09-10 船长九次定"弹道速度加快"；乘在弹型基础飞行时长上） */
export const DRONE_FLY_MUL = 0.55
/** 哨戒档机群的弹道系数（2026-09-10 船长十一次定"哨戒弹道持续时间长一些"） */
export const DRONE_SENTRY_FLY_MUL = 1.6

/** 机群弹道系数：哨戒档更长，其余按 `DRONE_FLY_MUL` 提速（与 `droneArt` 的机型表同口径） */
export function droneFlyMul(artId: string | undefined): number {
  if (artId === undefined) return DRONE_FLY_MUL
  return artId.endsWith('-sentry') ? DRONE_SENTRY_FLY_MUL : DRONE_FLY_MUL
}

/** 一发弹道的飞行时长（ms）；机群按机型系数，其余按弹型基础飞时（与画面 `flyMs` 同式） */
export function boltFlightMs(
  type: DamageType,
  src?: BattleFx['src'],
  artId?: string,
): number {
  const look = BOLT_LOOK[type] ?? BOLT_LOOK.kinetic
  if (src === 'drone') return Math.max(60, Math.round(look.fly * droneFlyMul(artId)))
  return look.fly
}

/** 击毁爆炸的延迟（ms）：等于致死弹型飞时（画面 `corpseAt = now + killerFly` 同口径） */
export function explosionDelayMs(killerType: DamageType | undefined): number {
  return killerType === undefined ? FLY_MS : (BOLT_LOOK[killerType]?.fly ?? FLY_MS)
}
