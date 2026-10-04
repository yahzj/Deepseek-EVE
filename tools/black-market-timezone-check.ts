/** 黑市日界真实时区进程回归。用法：npx tsx tools/black-market-timezone-check.ts。
 * 新进程TZ上海/纽约：跨时区回拨保留货架、纽约夏令时换日23/25小时、锁价/售罄守恒。
 * 合成档，不读写个人档。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createInitialState, blackMarketDayStart, blackMarketNextRefresh, ensureBlackMarket } from '@whale/core'
import { buildSimContext } from '@whale/data'

if (process.argv.includes('--probe')) {
  const now = Date.parse('2026-10-04T01:00:00Z')
  const state = createInitialState({ nowWallMs: now, seed: 10403 })
  state.standingsEarned = { dsi: 100 }
  const ctx = buildSimContext()
  ensureBlackMarket(state, ctx, now)
  if (process.env.BM_IMPORTED_BOARD) {
    state.blackMarket = JSON.parse(process.env.BM_IMPORTED_BOARD)
    state.blackMarket!.offers[0]!.sold = true
    const before = structuredClone(state.blackMarket)
    assert.equal(ensureBlackMarket(state, ctx, now), false)
    assert.deepEqual(state.blackMarket, before)
    const next = blackMarketNextRefresh(state)
    assert.equal(new Date(next).getHours(), 0)
    assert.equal(ensureBlackMarket(state, ctx, next), true)
    assert(state.blackMarket.offers.every((offer) => !offer.sold))
  }
  const lengths = ['2026-03-08T12:00:00', '2026-11-01T12:00:00'].map((day) => {
    const begin = blackMarketDayStart(new Date(day).getTime())
    state.blackMarket = { dayWallMs: begin, offers: [] }
    return (blackMarketNextRefresh(state) - begin) / 3600000
  })
  delete state.blackMarket
  ensureBlackMarket(state, ctx, now)
  console.log(JSON.stringify({ tz: process.env.TZ, day: blackMarketDayStart(now), lengths, board: state.blackMarket }))
} else {
  const probe = (tz: string, board?: object) => JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', resolve('tools/black-market-timezone-check.ts'), '--probe'], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, TZ: tz, ...(board ? { BM_IMPORTED_BOARD: JSON.stringify(board) } : {}) },
  }))
  const shanghai = probe('Asia/Shanghai'), newYork = probe('America/New_York', shanghai.board)
  assert.notEqual(shanghai.day, newYork.day)
  assert.deepEqual(shanghai.lengths, [24, 24])
  assert.deepEqual(newYork.lengths, [23, 25])
  console.log(JSON.stringify({ ok: true, shanghaiDay: shanghai.day, newYorkDay: newYork.day, daylightSavingHours: newYork.lengths, importedBoardPreserved: true }))
}
