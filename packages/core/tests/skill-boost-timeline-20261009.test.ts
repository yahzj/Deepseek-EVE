import { describe, expect, it, vi } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { SkillsState } from '../src/state'
import { advanceGame, clearSkillQueue, enqueueSkill, moveQueueItem } from '../src/engine'
import { skillQueueStatus } from '../src/activity'
import { simulateOffline } from '../src/simulation'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { useSynapticAccelerant, syncBoostRenew, setOfflineBoostTally } from '../src/consumables'
import { SYNAPTIC_ACCELERANT_MS, skillLevelTimeMs } from '../src/training'

const ctx = buildSimContext()
const HOUR = 3_600_000
const ITEM = 'synaptic-accelerant'
const fresh = () => createInitialState({ nowWallMs: 0, seed: 1009 })
const view = (s: ReturnType<typeof fresh>) => skillQueueStatus(s, ctx.skills).head!

function offlineState(hours: 8 | 32 | 64, units = 10) {
  const s = fresh()
  s.boostAutoRenew = true
  s.skillBoostUntilMs = 300_000
  s.warehouse.items[ITEM] = units
  if (hours > 8) {
    s.skills.trained['offline-ops'] = 5
    s.skills.trained['unattended-dispatch'] = 5
  }
  if (hours === 64) s.ironman = { on: true, seq: 1, sinceWallMs: 1_000_000 }
  return s
}

function slicedOffline(s: ReturnType<typeof fresh>, duration: number, step = 30_000) {
  for (let at = 0; at < duration;) {
    const d = Math.min(step, duration - at)
    simulateOffline(s, 1_000_000 + at, 1_000_000 + at + d, ctx)
    at += d
  }
}

describe('技能加速：稳定工作量', () => {
  it('技能随档白名单覆盖全部字段，进度标记往返不丢失', () => {
    const allKeys: Record<keyof SkillsState, true> = {
      trained: true, queue: true, savedProgress: true, licenses: true, progressVersion: true,
    }
    const back = loadSaveFile(serializeSaveFile(fresh(), 0)).state
    for (const key of Object.keys(allKeys)) expect(Object.hasOwn(back.skills, key)).toBe(true)
    expect(back.skills.progressVersion).toBe(1)
  })

  it.each([false, true])('学习倍率升级与药效切换：分片结果一致（铁人=%s）', (ironman) => {
    const whole = fresh()
    whole.skills.trained['accelerated-learning'] = 2
    whole.skills.queue = [
      { skillId: 'accelerated-learning', targetLevel: 3, progressMs: 0 },
      { skillId: 'mining', targetLevel: 1, progressMs: 0 },
      { skillId: 'mining', targetLevel: 2, progressMs: 0 },
    ]
    whole.skillBoostUntilMs = 400_000
    if (ironman) whole.ironman = { on: true, seq: 1 }
    const sliced = structuredClone(whole)
    advanceGame(whole, 700_000, ctx)
    for (let at = 0; at < 700_000;) {
      const step = Math.min(777, 700_000 - at)
      advanceGame(sliced, step, ctx)
      at += step
    }
    expect(whole.skills.trained).toEqual(sliced.skills.trained)
    expect(whole.skills.queue.map(q => [q.skillId, q.targetLevel])).toEqual(sliced.skills.queue.map(q => [q.skillId, q.targetLevel]))
    for (let i = 0; i < whole.skills.queue.length; i++) {
      expect(whole.skills.queue[i]!.progressMs).toBeCloseTo(sliced.skills.queue[i]!.progressMs, 5)
    }
  })

  it('中途用药保留比例，仅剩余时间减半；重复用药只延长有效期', () => {
    const s = fresh()
    s.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 120_000 }]
    s.warehouse.items[ITEM] = 2
    const before = view(s)
    expect(useSynapticAccelerant(s).ok).toBe(true)
    expect(view(s).percent).toBeCloseTo(before.percent, 10)
    expect(view(s).remainingMs).toBe(before.remainingMs / 2)
    expect(useSynapticAccelerant(s).ok).toBe(true)
    expect(view(s).percent).toBeCloseTo(before.percent, 10)
    expect(s.skillBoostUntilMs).toBe(2 * SYNAPTIC_ACCELERANT_MS)
  })

  it('超过半程开药不会瞬间升级', () => {
    const s = fresh()
    s.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 300_000 }]
    s.warehouse.items[ITEM] = 1
    useSynapticAccelerant(s)
    advanceGame(s, 1, ctx)
    expect(s.skills.trained.mining ?? 0).toBe(0)
    expect(s.skills.queue[0]!.progressMs).toBe(300_002)
  })

  it('到期保存已练工作；大步与小步都只在药效时段双倍推进', () => {
    const big = fresh()
    big.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 10_000 }]
    big.skillBoostUntilMs = 5000
    const before = view(big).percent
    const small = structuredClone(big)
    advanceGame(big, 10_000, ctx)
    for (let i = 0; i < 10; i++) advanceGame(small, 1000, ctx)
    expect(big.skills.queue).toEqual(small.skills.queue)
    expect(big.skills.queue[0]!.progressMs).toBe(25_000)
    expect(view(big).percent).toBeGreaterThan(before)
  })

  it('升级、后续队列、到期在同一拍按实际时点结算', () => {
    const s = fresh()
    const base = skillLevelTimeMs(ctx.skills.get('mining')!, 1)
    s.skills.queue = [
      { skillId: 'mining', targetLevel: 1, progressMs: base - 2000 },
      { skillId: 'mining', targetLevel: 2, progressMs: 0 },
    ]
    s.skillBoostUntilMs = 5000
    advanceGame(s, 10_000, ctx)
    expect(s.skills.trained.mining).toBe(1)
    expect(s.skills.queue[0]!.progressMs).toBe(13_000)
    expect(s.logs.find(l => l.textId === 'core.engine.004')?.atGameMs).toBe(1000)
    expect(s.gameMs).toBe(10_000)
  })

  it('取消、改序、重排与重载不丢长技能已练工作', () => {
    const s = fresh()
    s.skills.trained['cruiser-ops'] = 4
    for (const id of ctx.skills.get('cruiser-ops')!.prereq ?? []) s.skills.trained[id] = 5
    s.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 100 * HOUR / 4 }]
    s.skillBoostUntilMs = 64 * HOUR
    clearSkillQueue(s)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.skills.savedProgress['cruiser-ops']).toBe(25 * HOUR)
    expect(enqueueSkill(back, 'cruiser-ops', 5, ctx.skills).ok).toBe(true)
    back.skills.queue.push({ skillId: 'mining', targetLevel: 1, progressMs: 0 })
    expect(moveQueueItem(back, 0, 1)).toBe(true)
    expect(moveQueueItem(back, 1, 0)).toBe(true)
    expect(back.skills.queue[0]!.progressMs).toBe(25 * HOUR)
  })

  it('旧档有效药效下进度只转换一次，存档往返保留小数和已练等级', () => {
    const s = fresh()
    s.skills.trained['accelerated-learning'] = 3
    s.skills.trained['cruiser-ops'] = 4
    s.skillBoostUntilMs = SYNAPTIC_ACCELERANT_MS
    s.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 12345 }]
    s.skills.savedProgress.mining = 2345
    const raw = JSON.parse(serializeSaveFile(s, 0))
    delete raw.state.skills.progressVersion
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(back.skills.queue[0]!.progressMs).toBeCloseTo(12345 / 0.44, 8)
    expect(back.skills.savedProgress.mining).toBeCloseTo(2345 / 0.44, 8)
    expect(back.skills.trained['cruiser-ops']).toBe(4)
    expect(loadSaveFile(serializeSaveFile(back, 0)).state.skills).toEqual(back.skills)
  })

  it.each([false, true])('旧档进度按载入状态换算（药效有效=%s），静止读取不会反复换算', (active) => {
    const s = fresh()
    s.gameMs = 100_000
    s.skillBoostUntilMs = active ? 200_000 : 90_000
    s.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 10_000 }]
    const raw = JSON.parse(serializeSaveFile(s, 0))
    delete raw.state.skills.progressVersion
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(back.skills.queue[0]!.progressMs).toBe(active ? 20_000 : 10_000)
    expect(back.skills.progressVersion).toBe(1)
    expect(loadSaveFile(serializeSaveFile(back, 0)).state.skills).toEqual(back.skills)
  })

  it('新档加速期间保存重载不改变进度；药效到期后取消重排也保留比例', () => {
    const s = fresh()
    s.skills.trained.mining = 1
    for (const id of ctx.skills.get('mining')!.prereq ?? []) s.skills.trained[id] = 5
    s.skills.queue = [{ skillId: 'mining', targetLevel: 2, progressMs: 0 }]
    s.warehouse.items[ITEM] = 1
    useSynapticAccelerant(s)
    advanceGame(s, 10_000, ctx)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.skills.queue[0]!.progressMs).toBe(20_000)
    expect(view(back).percent).toBe(view(s).percent)
    clearSkillQueue(back)
    back.gameMs = back.skillBoostUntilMs!
    expect(enqueueSkill(back, 'mining', 2, ctx.skills).ok).toBe(true)
    expect(back.skills.queue[0]!.progressMs).toBe(20_000)
    expect(view(back).percent).toBe(view(s).percent)
  })
})

describe('离线自动续用：事件时间轴', () => {
  it.each([
    { units: 0, remain: 0, learning: 0, ironman: false },
    { units: 1, remain: 300_000, learning: 5, ironman: true },
    { units: 5, remain: 60_000, learning: 3, ironman: false },
    { units: 10, remain: 25 * HOUR, learning: 4, ironman: true },
    { units: 10, remain: 0, learning: 0, ironman: false },
  ])('库存/药效/倍率组合不依赖心跳步长：%j', ({ units, remain, learning, ironman }) => {
    const whole = offlineState(32, units)
    whole.skillBoostUntilMs = remain
    whole.skills.trained['accelerated-learning'] = learning
    whole.skills.trained['cruiser-ops'] = 4
    whole.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 7 * HOUR }]
    if (ironman) whole.ironman = { on: true, seq: 1 }
    const split = structuredClone(whole)
    advanceGame(whole, 32 * HOUR, ctx)
    for (let elapsed = 0; elapsed < 32 * HOUR;) {
      const step = Math.min(123_457, 32 * HOUR - elapsed)
      advanceGame(split, step, ctx)
      elapsed += step
    }
    expect(whole.warehouse.items[ITEM]).toBe(split.warehouse.items[ITEM])
    expect(whole.skillBoostUntilMs).toBe(split.skillBoostUntilMs)
    expect(whole.boostAutoRenew).toBe(split.boostAutoRenew)
    expect(whole.skills.trained).toEqual(split.skills.trained)
    expect(whole.skills.queue.map(q => [q.skillId, q.targetLevel])).toEqual(split.skills.queue.map(q => [q.skillId, q.targetLevel]))
    for (let i = 0; i < whole.skills.queue.length; i++) {
      expect(whole.skills.queue[i]!.progressMs).toBeCloseTo(split.skills.queue[i]!.progressMs, 4)
    }
  })

  it.each([8, 32, 64] as const)('%i小时跨续用时点：大步/30秒/不规则分片扣料与剩余一致', (hours) => {
    const whole = offlineState(hours)
    const sliced = structuredClone(whole)
    const irregular = structuredClone(whole)
    simulateOffline(whole, 1_000_000, 1_000_000 + hours * HOUR, ctx)
    slicedOffline(sliced, hours * HOUR)
    slicedOffline(irregular, hours * HOUR, 71_123)
    expect(whole.warehouse.items[ITEM]).toBe(sliced.warehouse.items[ITEM])
    expect(whole.skillBoostUntilMs).toBe(sliced.skillBoostUntilMs)
    expect(whole.skillBoostUntilMs).toBe(irregular.skillBoostUntilMs)
    const n = hours === 8 ? 1 : hours === 32 ? 2 : 3
    expect(whole.warehouse.items[ITEM]).toBe(10 - n)
    expect(whole.skillBoostUntilMs! - whole.gameMs).toBe(300_000 + n * SYNAPTIC_ACCELERANT_MS - hours * HOUR)
    const summary = whole.logs.find(l => l.textId === 'core.simulation.002')!
    expect(summary.textParams?.p5p1).toBe(n)
    expect(whole.logs.some(l => l.textId === 'core.consumable.013')).toBe(false)
  })

  it('一剂耗尽后训练降回普通速度，不能覆盖整段32小时', () => {
    const whole = offlineState(64, 1)
    whole.skills.trained['cruiser-ops'] = 4
    whole.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 0 }]
    const sliced = structuredClone(whole)
    simulateOffline(whole, 1_000_000, 1_000_000 + 32 * HOUR, ctx)
    slicedOffline(sliced, 32 * HOUR)
    expect(whole.skills.trained['cruiser-ops']).toBe(4)
    expect(whole.skills.queue[0]!.progressMs).toBeCloseTo(sliced.skills.queue[0]!.progressMs, 4)
    expect(whole.skillBoostUntilMs).toBe(300_000 + SYNAPTIC_ACCELERANT_MS)
    expect(whole.boostAutoRenew).toBe(false)
    expect(whole.logs.filter(l => l.textId === 'core.consumable.015')).toHaveLength(1)
  })

  it('长技能提前补够覆盖时段，不在同一时刻重复烧剂；重载后保持同样结果', () => {
    const s = offlineState(32)
    s.skills.trained['cruiser-ops'] = 4
    s.skills.queue = [{ skillId: 'cruiser-ops', targetLevel: 5, progressMs: 0 }]
    syncBoostRenew(s, ctx)
    const stock = s.warehouse.items[ITEM]
    syncBoostRenew(s, ctx)
    expect(s.warehouse.items[ITEM]).toBe(stock)
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    const sliced = structuredClone(back)
    simulateOffline(back, 1_000_000, 1_000_000 + 32 * HOUR, ctx)
    slicedOffline(sliced, 32 * HOUR)
    expect(back.skillBoostUntilMs).toBe(sliced.skillBoostUntilMs)
    expect(back.warehouse.items[ITEM]).toBe(sliced.warehouse.items[ITEM])
  })

  it('零额度离线不留下静默状态，之后在线仍写续用日志', () => {
    const s = offlineState(8)
    simulateOffline(s, 1_000_000, 4_600_000, ctx, 0)
    s.skillBoostUntilMs = 0
    advanceGame(s, 1000, ctx)
    const log = s.logs.find(l => l.textId === 'core.consumable.013')
    try { expect(log).toBeDefined() } finally { setOfflineBoostTally(false) }
  })

  it('离线推进抛错也关闭静默状态，并恢复游戏时钟', () => {
    const s = offlineState(8)
    s.skillBoostUntilMs = 0
    s.skills.queue = [{ skillId: 'mining', targetLevel: 1, progressMs: 0 }]
    const get = vi.spyOn(ctx.skills, 'get').mockImplementationOnce(() => { throw new Error('synthetic failure') })
    try {
      expect(() => simulateOffline(s, 1_000_000, 1_001_000, ctx)).toThrow('synthetic failure')
      expect(s.gameMs).toBe(1000)
    } finally { get.mockRestore() }
    try {
      advanceGame(s, 1000, ctx)
      expect(s.logs.some(l => l.textId === 'core.consumable.013')).toBe(true)
    } finally { setOfflineBoostTally(false) }
  })
})
