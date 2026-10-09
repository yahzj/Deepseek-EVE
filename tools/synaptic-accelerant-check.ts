/**
 * 突触加速剂报障诊断：npx tsx tools/synaptic-accelerant-check.ts；合成状态，不触及个人档。
 * 版本自检：
 * - 游戏版本：v31
 * - 本工具最后核对：2026-10-09（手动续时、训练切换、离线8/32/64小时续用与料尽）
 * - 本工具最后跑过：2026-10-09
 * 退出码：0 = 全部诊断符合预期；1 = 业务诊断不符或断言失败，不代表修复已完成。
 */
import assert from 'node:assert/strict'
import { isDeepStrictEqual } from 'node:util'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { advanceGame } from '../packages/core/src/engine'
import { skillQueueStatus } from '../packages/core/src/activity'
import {
  consumableStockOf,
  SYNAPTIC_ACCELERANT_ITEM_ID,
  syncBoostRenew,
  useSynapticAccelerant,
} from '../packages/core/src/consumables'
import { skillLevelTimeMs, SYNAPTIC_ACCELERANT_MS } from '../packages/core/src/training'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { offlineCapMsOf, simulateOffline } from '../packages/core/src/simulation'
import { setOfflineBoostTally } from '../packages/core/src/consumables'

const ctx = buildSimContext()
const failures: string[] = []
const fresh = () => createInitialState({ nowWallMs: 0, seed: 1009 })
const stockOf = (s: ReturnType<typeof fresh>) => consumableStockOf(s, SYNAPTIC_ACCELERANT_ITEM_ID)
const viewOf = (s: ReturnType<typeof fresh>) => skillQueueStatus(s, ctx.skills).head!

function report(name: string, data: unknown): void {
  console.log(`${name}: ${JSON.stringify(data)}`)
}

function check(name: string, actual: unknown, expected: unknown): void {
  const ok = isDeepStrictEqual(actual, expected)
  report(name, { ok, actual, expected })
  if (!ok) failures.push(name)
}

// 船长 2026-10-09 裁定：手动连用与读档后连用均逐枚增加有效时间，不叠加倍率。
const manual = fresh()
manual.warehouse.items[SYNAPTIC_ACCELERANT_ITEM_ID] = 10
assert.equal(useSynapticAccelerant(manual).ok, true)
for (let i = 0; i < 8; i++) {
  const r = useSynapticAccelerant(manual)
  assert.equal(r.ok, true)
  assert.equal(manual.skillBoostUntilMs, (i + 2) * SYNAPTIC_ACCELERANT_MS)
}
assert.equal(stockOf(manual), 1)
const back = loadSaveFile(serializeSaveFile(manual, 0)).state
assert.equal(useSynapticAccelerant(back).ok, true)
assert.equal(stockOf(back), 0)
assert.equal(back.skillBoostUntilMs, 10 * SYNAPTIC_ACCELERANT_MS)
report('手动连用和读档后续时', { clicks: 10, consumed: 10 - stockOf(back), until: back.skillBoostUntilMs })

// 从零开始且药效始终有效时，半时长完成这一基本场景成立。
const baseMs = skillLevelTimeMs(ctx.skills.get('mining')!, 1)
const fromZero = fresh()
fromZero.warehouse.items[SYNAPTIC_ACCELERANT_ITEM_ID] = 1
fromZero.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 0 }]
assert.equal(useSynapticAccelerant(fromZero).ok, true)
advanceGame(fromZero, baseMs / 2 - 1, ctx)
assert.equal(fromZero.skills.trained.mining ?? 0, 0)
advanceGame(fromZero, 1, ctx)
assert.equal(fromZero.skills.trained.mining, 1)
report('从零开始双倍速', { baseMs, actualCompletionMs: fromZero.gameMs })

// 中途开药：已完成比例应不变，剩余工作按双倍速度完成。
const midway = fresh()
midway.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 120_000 }]
midway.warehouse.items[SYNAPTIC_ACCELERANT_ITEM_ID] = 1
const before = viewOf(midway)
assert.equal(useSynapticAccelerant(midway).ok, true)
const after = viewOf(midway)
check('中途开药剩余时间', after.remainingMs, before.remainingMs / 2)
check('中途开药进度比例', after.percent, before.percent)
report('中途开药明细', { before, after })

const overHalf = fresh()
overHalf.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 300_000 }]
overHalf.warehouse.items[SYNAPTIC_ACCELERANT_ITEM_ID] = 1
assert.equal(useSynapticAccelerant(overHalf).ok, true)
advanceGame(overHalf, 1, ctx)
check('超过半程开药后一毫秒不得瞬间完成', overHalf.skills.trained.mining ?? 0, 0)

// 到期不应凭空撤销已练比例。
const expiry = fresh()
expiry.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 10_000 }]
expiry.skillBoostUntilMs = 1
const preExpiry = viewOf(expiry)
advanceGame(expiry, 1, ctx)
const postExpiry = viewOf(expiry)
check('到期保留已练比例', postExpiry.percent >= preExpiry.percent, true)
report('到期明细', { before: preExpiry, after: postExpiry })

// 同一时间轴，大步与小步不应得出不同训练结果。
const big = fresh()
big.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: baseMs / 2 - 1000 }]
big.skillBoostUntilMs = 5000
const small = structuredClone(big)
advanceGame(big, 10_000, ctx)
for (let i = 0; i < 10; i++) advanceGame(small, 1000, ctx)
const snapshot = (s: typeof big) => ({ level: s.skills.trained.mining ?? 0, queue: s.skills.queue })
check('跨到期大步小步一致', snapshot(big), snapshot(small))

// 已确认续用政策：长技能允许提前接续，但同一时刻满足覆盖后不得再次扣剂。
const renew = fresh()
renew.skills.trained['cruiser-ops'] = 4
renew.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 0 }]
renew.warehouse.items[SYNAPTIC_ACCELERANT_ITEM_ID] = 10
renew.boostAutoRenew = true
renew.skillBoostUntilMs = SYNAPTIC_ACCELERANT_MS
advanceGame(renew, 1000, ctx)
const firstStock = stockOf(renew)
syncBoostRenew(renew, ctx)
syncBoostRenew(renew, ctx)
assert.equal(stockOf(renew), firstStock)
report('长技能提前续用与同拍防重复', {
  consumed: 10 - stockOf(renew), remainingMs: renew.skillBoostUntilMs! - renew.gameMs,
})

// 离线结算时点检查：同样的初始存档与离线时长，比较整段和分片的扣剂与剩余有效时间。
const HOUR = 3_600_000
const wallStart = 1_000_000
function offlineState(cap: '8h' | '32h' | '64h', units = 10) {
  const s = fresh()
  s.boostAutoRenew = true
  s.skillBoostUntilMs = 5 * 60_000
  s.warehouse.items[SYNAPTIC_ACCELERANT_ITEM_ID] = units
  if (cap !== '8h') {
    s.skills.trained['offline-ops'] = 5
    s.skills.trained['unattended-dispatch'] = 5
  }
  if (cap === '64h') s.ironman = { on: true, seq: 1, sinceWallMs: wallStart }
  return s
}

function offlineSnapshot(s: ReturnType<typeof fresh>) {
  return {
    gameMs: s.gameMs,
    stock: stockOf(s),
    autoRenew: s.boostAutoRenew === true,
    remainMs: Math.max(0, (s.skillBoostUntilMs ?? 0) - s.gameMs),
    queue: s.skills.queue,
    level: s.skills.trained['cruiser-ops'] ?? 0,
  }
}

function compareOffline(name: string, initial: ReturnType<typeof fresh>, gapMs: number): void {
  const whole = structuredClone(initial)
  const sliced = structuredClone(initial)
  simulateOffline(whole, wallStart, wallStart + gapMs, ctx)
  const settledMs = Math.min(gapMs, offlineCapMsOf(initial))
  for (let elapsed = 0; elapsed < settledMs;) {
    const step = Math.min(30_000, settledMs - elapsed)
    simulateOffline(sliced, wallStart + elapsed, wallStart + elapsed + step, ctx)
    elapsed += step
  }
  const summary = [...whole.logs].reverse().find((l) => l.textId === 'core.simulation.002')
  const consumed = stockOf(initial) - stockOf(whole)
  assert.equal(Number(summary?.textParams?.p5p1 ?? 0), consumed)
  assert.equal(whole.logs.filter((l) => l.textId === 'core.consumable.013').length, 0)
  report(`${name}汇总`, { consumed, summary: summary?.text, capMs: offlineCapMsOf(initial) })
  const actual = offlineSnapshot(whole)
  const expected = offlineSnapshot(sliced)
  const { queue: actualQueue, ...actualRest } = actual
  const { queue: expectedQueue, ...expectedRest } = expected
  // 工作量受非整数速率累加影响，仅该字段允许万分之一毫秒误差；时钟、扣料、等级仍精确比较。
  const sameWork = actualQueue.length === expectedQueue.length && actualQueue.every((q, i) => {
    const other = expectedQueue[i]!
    return q.skillId === other.skillId && q.targetLevel === other.targetLevel && Math.abs(q.progressMs - other.progressMs) < 0.0001
  })
  report(name, { ok: sameWork && isDeepStrictEqual(actualRest, expectedRest), actual, expected })
  if (!sameWork || !isDeepStrictEqual(actualRest, expectedRest)) failures.push(name)
}

compareOffline('离线8小时空队列续用', offlineState('8h'), 8 * HOUR)
compareOffline('离线32小时空队列跨多剂', offlineState('32h'), 32 * HOUR)
compareOffline('铁人离线64小时空队列跨多剂', offlineState('64h'), 64 * HOUR)
compareOffline('离线32小时仅一剂耗尽', offlineState('32h', 1), 32 * HOUR)
const longOffline = offlineState('32h')
longOffline.skills.trained['cruiser-ops'] = 4
longOffline.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 0 }]
compareOffline('离线32小时长技能自动续用', longOffline, 32 * HOUR)
const exhaustedTraining = offlineState('64h', 1)
exhaustedTraining.skills.trained['cruiser-ops'] = 4
exhaustedTraining.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 0 }]
compareOffline('铁人离线32小时长技能仅一剂', exhaustedTraining, 32 * HOUR)
const reloaded = loadSaveFile(serializeSaveFile(offlineState('8h'), wallStart)).state
assert.equal(reloaded.boostAutoRenew, true)
compareOffline('读档后离线8小时续用', reloaded, 8 * HOUR)

const off = offlineState('8h')
off.boostAutoRenew = false
simulateOffline(off, wallStart, wallStart + 8 * HOUR, ctx)
assert.equal(stockOf(off), 10)
report('离线开关关闭不扣料', offlineSnapshot(off))
const sufficient = offlineState('8h')
sufficient.skillBoostUntilMs = 72 * HOUR
simulateOffline(sufficient, wallStart, wallStart + 72 * HOUR, ctx)
assert.equal(stockOf(sufficient), 10)
assert.equal(sufficient.gameMs, 8 * HOUR)
assert.equal(sufficient.skillBoostUntilMs - sufficient.gameMs, 64 * HOUR)
report('离线超出上限不额外扣剂', offlineSnapshot(sufficient))

// 真正进入 simulateOffline 的30秒分片支路；故意无效的循环目标由真实入口关闭，不产生战斗。
const productionChunked = offlineState('8h')
productionChunked.autoLoopAnomalyId = 'diagnostic-missing-anomaly'
simulateOffline(productionChunked, wallStart, wallStart + 8 * HOUR, ctx)
assert.equal(stockOf(productionChunked), 9)
assert.equal(productionChunked.skillBoostUntilMs! - productionChunked.gameMs, 5 * 60_000 + 24 * HOUR - 8 * HOUR)
report('生产离线30秒分片支路', offlineSnapshot(productionChunked))

// 无可结算时间不应留下进程级静默记账，影响随后在线续用日志。
const zeroCap = offlineState('8h')
zeroCap.skillBoostUntilMs = 0
simulateOffline(zeroCap, wallStart, wallStart + HOUR, ctx, 0)
advanceGame(zeroCap, 1000, ctx)
check('零额度离线后在线续用日志恢复', zeroCap.logs.filter((l) => l.textId === 'core.consumable.013').length, 1)
setOfflineBoostTally(false)

report('诊断结论', { failures, note: '非空表示业务缺陷仍存在；本工具不修改训练实现。' })
if (failures.length > 0) process.exitCode = 1
