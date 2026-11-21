import { describe, expect, it } from 'vitest'
import { STAGE_TWO_FORMAT, STAGE_TWO_MAX_BYTES, readStageEnvelope, stageRecord } from './stageTwoStorage'

describe('第二阶段外层快照入口', () => {
  it('只接受指定版本/格式与成对经营快照，不把正式游戏档当原型', () => {
    const raw = { format: STAGE_TWO_FORMAT, version: 1, base: '{}' }
    expect(readStageEnvelope(JSON.stringify(raw))).toEqual({ raw, base: '{}' })
    for (const invalid of [{ ...raw, version: '1' }, { ...raw, format: 'save' }, { ...raw, base: {} },
      { state: {}, version: 31 }, [], null]) expect(() => readStageEnvelope(JSON.stringify(invalid))).toThrow()
  })
  it('数组和过大数据在读取内部状态前拒绝', () => {
    expect(() => stageRecord([])).toThrow()
    expect(() => readStageEnvelope(' '.repeat(STAGE_TWO_MAX_BYTES + 1))).toThrow('超过2MiB')
  })
})
