import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSimContext, COMMS_MESSAGES, L10N } from '@whale/data'
import { createInitialState } from '../src/state'
import { advanceComms, commsInbox, commsPopupQueue, dismissCommsPopup } from '../src/comms'
import { noteStandingEarned, spendStanding } from '../src/standing'
import { blackMarketUnlocked } from '../src/blackMarket'
import { BLACK_MARKET_STANDING_REQ } from '../src/events'
import { WORMHOLE_SCAN_UNLOCK_STANDING } from '../src/wormholeScan'
import { advanceGame } from '../src/engine'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ID = 'msg-black-market-unlock'
const message = COMMS_MESSAGES.find(row => row.id === ID)!
const full = buildSimContext()
const ctx = { ...full, commsMessages: new Map([[ID, message]]) }

function world(earned: number, spendable = earned) {
  const state = createInitialState({ nowWallMs: 0, seed: 20261012 })
  state.standingsEarned = { dsi: earned }
  state.standings.dsi = spendable
  return state
}

describe('黑市开放一次性通讯', () => {
  it('黑市与虫洞通讯分别跟随各自解锁门槛，不混用声望条件', () => {
    expect(message.trigger).toEqual({ kind: 'standing', factionId: 'dsi', min: BLACK_MARKET_STANDING_REQ })
    expect(COMMS_MESSAGES.find(row => row.id === 'msg-wormhole-unlock')!.trigger).toEqual({
      kind: 'standing', factionId: 'dsi', min: WORMHOLE_SCAN_UNLOCK_STANDING,
    })
    expect(BLACK_MARKET_STANDING_REQ).not.toBe(WORMHOLE_SCAN_UNLOCK_STANDING)
  })

  it.each([0, 99, 100, 101, 1000])('累计协会声望%s与黑市解锁一致，达到100送达', earned => {
    const state = world(earned)
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID] !== undefined).toBe(earned >= 100)
    expect(blackMarketUnlocked(state)).toBe(earned >= 100)
    expect(message.trigger).toEqual({ kind: 'standing', factionId: 'dsi', min: BLACK_MARKET_STANDING_REQ })
  })

  it('99获得1点累计声望后，真实引擎推进发送且只送一次', () => {
    const state = world(99)
    advanceGame(state, 1000, ctx, { nowWallMs: 0 })
    expect(state.commsDelivered?.[ID]).toBeUndefined()
    noteStandingEarned(state, 'dsi', 1)
    advanceGame(state, 1000, ctx, { nowWallMs: 0 })
    const delivered = state.commsDelivered?.[ID]
    expect(delivered).toBeDefined()
    expect(commsPopupQueue(state)).toEqual([ID])
    advanceGame(state, 5000, ctx, { nowWallMs: 0 })
    expect(state.commsDelivered?.[ID]).toBe(delivered)
    expect(commsInbox(state, ctx).filter(row => row.id === ID)).toHaveLength(1)
    expect(state.logs.filter(row => row.text.includes(message.subject))).toHaveLength(1)
  })

  it('看累计而非余额：累计不足但余额高不送，累计100兑换后仍送', () => {
    const below = world(99, 1000)
    advanceComms(below, ctx)
    expect(below.commsDelivered?.[ID]).toBeUndefined()
    const state = world(100)
    expect(spendStanding(state, 'dsi', 100)).toBe(true)
    expect(state.standings.dsi).toBe(0)
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID]).toBeDefined()
  })

  it('其它势力声望不替代协会声望，无需实验室首访或旧黑市信', () => {
    const state = world(99)
    state.standingsEarned!['other'] = 1000
    state.labOpened = true
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID]).toBeUndefined()
    state.standingsEarned!.dsi = 100
    state.labOpened = false
    delete state.commsDelivered
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID]).toBeDefined()
    expect(state.commsDelivered?.['msg-lab-contraband']).toBeUndefined()
  })

  it('已有累计100以上的老档读入后补发，缺累计账时保留既有声望回退规则', () => {
    const state = loadSaveFile(serializeSaveFile(world(230, 2), 0)).state
    expect(state.commsDelivered?.[ID]).toBeUndefined()
    advanceComms(state, ctx)
    expect(state.commsDelivered?.[ID]).toBeDefined()
    const legacy = world(100)
    delete legacy.standingsEarned
    advanceComms(legacy, ctx)
    expect(legacy.commsDelivered?.[ID]).toBeDefined()
  })

  it('零时刻送达、关闭弹窗及两次整档往返都不重复送，已读和旧消息保持', () => {
    const state = world(100, 1)
    state.commsDelivered = { 'msg-lab-contraband': 0 }
    state.commsRead = { 'msg-lab-contraband': true }
    advanceComms(state, ctx)
    expect(state.commsDelivered![ID]).toBe(0)
    expect(dismissCommsPopup(state, ID)).toBe(true)
    let loaded = loadSaveFile(serializeSaveFile(state, 0)).state
    loaded = loadSaveFile(serializeSaveFile(loaded, 0)).state
    loaded.gameMs += 5000
    advanceComms(loaded, ctx)
    expect(loaded.commsDelivered![ID]).toBe(0)
    expect(loaded.commsRead![ID]).toBe(true)
    expect(loaded.commsDelivered!['msg-lab-contraband']).toBe(0)
    expect(loaded.commsRead!['msg-lab-contraband']).toBe(true)
    expect(commsPopupQueue(loaded)).not.toContain(ID)
  })

  it('黑市商人发件身份与已确认三段稿、市场跳转逐字一致', () => {
    const state = world(100)
    advanceComms(state, full)
    const entry = commsInbox(state, full).find(row => row.id === ID)!
    expect(entry.from).toBe('黑市 · 违禁品柜')
    expect(entry.alignment).toBe('中立')
    expect(entry.subject).toBe('有些货，该给你看看了')
    expect(entry.paragraphs).toEqual([
      '嘿，你在协会那边的名声，我听说了。肯替他们办事的人不少，能做到你这份上的，值得谈点别的生意。',
      '到市场页找「黑市」，我把入口留给你了。外面不常见的装备和图纸，这里兴许有。',
      '先看货，再看价。东西难弄，价钱可不按协会那套来。',
    ])
    expect(entry.hint).toEqual({ text: '前往市场', page: 'market' })
    expect(entry.action).toBeUndefined()
    expect(message.subject).toBe(L10N['ui.commsBlackMarket.001']!.zh)
    expect(message.body).toEqual([2, 3, 4].map(n => L10N[`ui.commsBlackMarket.${String(n).padStart(3, '0')}`]!.zh))
  })

  it('新标题正文与提示仅登记待译，不生成英文；市场页仍有黑市入口', () => {
    const pending = readFileSync(new URL('../../../docs/l10n-pending.md', import.meta.url), 'utf8')
    for (let n = 1; n <= 5; n++) {
      const id = `ui.commsBlackMarket.${String(n).padStart(3, '0')}`
      expect(L10N[id]).toMatchObject({ en: '', enDeferred: true })
      expect(pending).toContain(`| \`${id}\` |`)
    }
    const market = readFileSync(new URL('../../../apps/desktop/src/renderer/src/pages/MarketPage.tsx', import.meta.url), 'utf8')
    expect(market).toContain('blackMarketUnlocked(state)')
    expect(market).toContain('engine.openBlackMarketAt()')
  })
})
