import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'

describe('C09 行情窗口读档保真', () => {
  it.each([0, 24, 48, 49])('%s 点保留最新48点的值与顺序', count => {
    const s = createInitialState({ nowWallMs: 0, seed: 29 })
    const points = Array.from({ length: count }, (_, i) => i + 100)
    s.market.priceHistory['ore-olivine'] = points
    const back = loadSaveFile(serializeSaveFile(s, 0)).state
    expect(back.market.priceHistory['ore-olivine'] ?? []).toEqual(points.slice(-48))
  })
  it('过滤非法值后再取完整窗口，合法价格按现行规则取整', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 29 })
    const raw = JSON.parse(serializeSaveFile(s, 0))
    raw.state.market.priceHistory['ore-olivine'] = [null, -1, '3', 0, ...Array.from({ length: 49 }, (_, i) => 100.4 + i)]
    const back = loadSaveFile(JSON.stringify(raw)).state
    expect(back.market.priceHistory['ore-olivine']).toEqual(Array.from({ length: 48 }, (_, i) => 101 + i))
  })
})

describe('C10 增强审计发现的名称清洗幂等', () => {
  it.each(['123456789 后缀', '12345678  后缀', '123456789\t后缀', '123456789😀后缀'])('截断后尾部空白一次清净：%s', name => {
    const s = createInitialState({ nowWallMs: 0, seed: 29 })
    s.fleet[s.shipId]!.customName = name
    const first = loadSaveFile(serializeSaveFile(s, 0)).state
    const second = loadSaveFile(serializeSaveFile(first, 0)).state
    expect(second.fleet[s.shipId]!.customName).toBe(first.fleet[s.shipId]!.customName)
  })
})
