/**
 * 战斗音效排期确定性用例（2026-11-05 战斗音频跟动画对拍批）。
 *
 * 跑法：node --import tsx --test tools/battle-sfx-timing.test.ts
 *
 * 钉住船长定下的两个节点：
 * 1. **被击中 = 攻击动画结束**（＝画面命中 puff 的 `animationDelay = 弹道飞时`）；
 * 2. **爆炸 = 击中动画开始**（＝`BattleScreen` 的 `corpseAt = now + killerFly`）。
 *
 * 同时钉住几处容易回归的发声口径：机群齐射不出开火音、敌方落空不出声、
 * 我方机群被击落不算「击毁敌方」、捕获网/闪现/近防/爆虫本体不出普通弹道音。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BattleFx } from '@whale/core'
import {
  BOLT_LOOK,
  DRONE_FLY_MUL,
  DRONE_SENTRY_FLY_MUL,
  FLY_MS,
  boltFlightMs,
} from '../apps/desktop/src/renderer/src/features/combat/attackTiming'
import { killExplosionDelayMs, planBattleFx } from '../apps/desktop/src/renderer/src/features/combat/battleSfxPlan'

/** 造一条最小可用的战斗事件（只写排期会用到的字段） */
function fx(over: Partial<BattleFx> & Pick<BattleFx, 'side' | 'type'>): BattleFx {
  return { seq: 1, atMs: 0, tag: over.side === 'me' ? 'm1' : 'e1', hit: false, ...over } as BattleFx
}

test('被我方命中：开火即时，命中音落在攻击动画结束（＝击中动画开始）', () => {
  const cues = planBattleFx(fx({ side: 'me', type: 'kinetic', src: 'turret', hit: true, to: 'e1' }))
  assert.deepEqual(cues, [
    { cue: 'combat-fire-kinetic', delayMs: 0 },
    { cue: 'combat-hit', delayMs: 420 },
  ])
  // 与画面 puff 同式：延迟就是弹型飞时
  assert.equal(cues[1].delayMs, BOLT_LOOK.kinetic.fly)
})

test('导弹与激光各按自己的飞时延迟落点音', () => {
  const missile = planBattleFx(fx({ side: 'me', type: 'explosive', src: 'missile', hit: true, to: 'e1' }))
  assert.equal(missile[1].delayMs, 760)
  const laser = planBattleFx(fx({ side: 'me', type: 'plasma', src: 'laser', hit: true, to: 'e1' }))
  assert.equal(laser[1].delayMs, 130)
})

test('我方落空：未命中 puff 也在弹道终点，按飞时延迟', () => {
  assert.deepEqual(planBattleFx(fx({ side: 'me', type: 'explosive', src: 'missile', hit: false })), [
    { cue: 'combat-fire-explosive', delayMs: 0 },
    { cue: 'combat-miss', delayMs: 760 },
  ])
})

test('敌方主武器开火即时，命中我方的受击音按攻击动画结束延迟', () => {
  assert.deepEqual(planBattleFx(fx({ side: 'foe', type: 'kinetic', src: 'turret', hit: true, to: 'm1' })), [
    { cue: 'combat-foe-fire', delayMs: 0 },
    { cue: 'combat-hurt', delayMs: 420 },
  ])
})

test('敌方落空不出声（画面上没有对应 puff）', () => {
  assert.deepEqual(planBattleFx(fx({ side: 'foe', type: 'kinetic', src: 'turret', hit: false })), [
    { cue: 'combat-foe-fire', delayMs: 0 },
  ])
})

test('机群齐射两侧都不出开火音，只按机型飞时出落点音', () => {
  const sentry = planBattleFx(fx({ side: 'foe', type: 'kinetic', src: 'drone', artId: 'drone-sentry', hit: true }))
  assert.deepEqual(sentry, [
    { cue: 'combat-hurt', delayMs: Math.round(BOLT_LOOK.kinetic.fly * DRONE_SENTRY_FLY_MUL) },
  ])
  const plain = planBattleFx(fx({ side: 'me', type: 'kinetic', src: 'drone', artId: 'drone-swarm', hit: true }))
  assert.deepEqual(plain, [{ cue: 'combat-hit', delayMs: Math.round(BOLT_LOOK.kinetic.fly * DRONE_FLY_MUL) }])
})

test('敌机被点防击落同帧出声；我方机群被击落不是「击毁敌方」', () => {
  assert.deepEqual(planBattleFx(fx({ side: 'foe', type: 'kinetic', src: 'drone', droneDown: true })), [
    { cue: 'combat-foe-down', delayMs: 0 },
  ])
  assert.deepEqual(planBattleFx(fx({ side: 'me', type: 'kinetic', src: 'drone', droneDown: true })), [])
})

test('捕获网 / 闪现 / 爆虫本体 / 近防不是普通弹道，不出声', () => {
  for (const over of [{ web: true }, { blink: true }, { acidBurst: true }, { pd: true }] as Partial<BattleFx>[]) {
    assert.deepEqual(planBattleFx(fx({ side: 'foe', type: 'kinetic', hit: true, ...over })), [], JSON.stringify(over))
  }
})

test('击毁爆炸延迟 = 致死弹型飞时（与 corpseAt 同口径）', () => {
  assert.equal(killExplosionDelayMs('explosive'), 760)
  assert.equal(killExplosionDelayMs('plasma'), 130)
  assert.equal(killExplosionDelayMs(undefined), FLY_MS)
})

test('机群飞时下限 60ms（贴近瞬发时不至于延迟为 0）', () => {
  assert.equal(boltFlightMs('plasma', 'drone', 'drone-sentry'), 208) // 130 × 1.6
  assert.equal(boltFlightMs('plasma', 'drone', 'drone-swarm'), 72) // 130 × 0.55 = 71.5 → 72
})
