import { describe, expect, it } from 'vitest'
import { buildSimContext, HULL_CLASS_NAME, hullClassOf, L10N, SHIPS } from '@whale/data'
import { createInitialState } from '../src/state'
import { fireMarketOrderEvent, BLACK_MARKET_STANDING_REQ, BLACK_MARKET_LIFE_MS } from '../src/events'
import { ensureMarket } from '../src/market'
import { DSI_FACTION_ID, spendStanding } from '../src/standing'
import { shipSizeLabel } from '../src/labels'
import { wormholeAdmission, WORMHOLE_ADMISSION_TEXT } from '../src/wormhole'
import { makeTestCtx } from './helpers'

const ctx = makeTestCtx({ marketGoods: [{ key:'rare-test',kind:'module',refId:'mod-a',rarity:'rare',basePrice:20000 }] })
function world(earned: number, spendable = earned, seed = 42) {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.standingsEarned = { [DSI_FACTION_ID]: earned }
  state.standings[DSI_FACTION_ID] = spendable
  ensureMarket(state, ctx)
  return state
}

describe('黑市累计声望100门槛，沿用既有现货交易链', () => {
  it.each([0,99])('累计%s不出黑市供货，逐单降级买家且随机序列与解锁者相同', (earned) => {
    const locked = world(earned, 1000), open = world(100)
    for (let i=0;i<100;i++) {
      fireMarketOrderEvent(locked, ctx)
      fireMarketOrderEvent(open, ctx)
      expect(locked.rng).toEqual(open.rng)
    }
    expect(locked.market.npcSell['rare-test']).toHaveLength(0)
    expect(locked.market.npcBuy['rare-test']).toHaveLength(100)
    expect(open.market.npcSell['rare-test']!.length).toBeGreaterThan(0)
    expect(locked.logs.some((l)=>l.textParams?.p1Id==='core.events.089')).toBe(false)
  })
  it('累计100含边界开放，可支配花光不会重新锁住，不扣声望', () => {
    const state=world(100)
    expect(BLACK_MARKET_STANDING_REQ).toBe(100)
    expect(spendStanding(state, DSI_FACTION_ID,100)).toBe(true)
    for(let i=0;i<50;i++)fireMarketOrderEvent(state,ctx)
    const orders=state.market.npcSell['rare-test']!
    expect(orders.length).toBeGreaterThan(0)
    for(const o of orders){expect(o.qty).toBe(1);expect(o.expiresAtGameMs-state.gameMs).toBe(BLACK_MARKET_LIFE_MS);expect(o.price).toBeGreaterThan(30000)}
    expect(state.standings[DSI_FACTION_ID]).toBe(0)
    expect(state.standingsEarned![DSI_FACTION_ID]).toBe(100)
  })
  it('刚跨100后出现供货；旧档无累计账沿用声望单点兜底', () => {
    const state=world(99)
    fireMarketOrderEvent(state,ctx)
    state.standingsEarned![DSI_FACTION_ID]=100
    for(let i=0;i<50;i++)fireMarketOrderEvent(state,ctx)
    expect(state.market.npcSell['rare-test']!.length).toBeGreaterThan(0)
    const legacy=world(0,100)
    delete legacy.standingsEarned
    for(let i=0;i<50;i++)fireMarketOrderEvent(legacy,ctx)
    expect(legacy.market.npcSell['rare-test']!.length).toBeGreaterThan(0)
  })
  it.each([0,100])('累计%s离线静默仅掷骰，不建单写日志且序列一致', (earned) => {
    const offline=world(earned), online=world(earned)
    const before=JSON.stringify(offline.market)
    const logBefore=structuredClone(offline.logs)
    for(let i=0;i<50;i++){fireMarketOrderEvent(offline,ctx,true);fireMarketOrderEvent(online,ctx)}
    expect(offline.rng).toEqual(online.rng)
    expect(JSON.stringify(offline.market)).toBe(before)
    expect(offline.logs).toEqual(logBefore)
  })
})

describe('T5泰坦分类，中英与核心名称一致，不改旗舰职务', () => {
  it('分类/蓝图/手册同词，具体舰名与入侵旗舰保留', () => {
    expect(HULL_CLASS_NAME[5]).toBe('泰坦')
    expect(hullClassOf({tier:5})).toBe('泰坦')
    expect(shipSizeLabel(5)).toBe('泰坦')
    for(const id of ['ui.labelsText.018','ui.labelsText.064','ui.Handbook.213','ui.Handbook.272','ui.Wormhole.089']){
      expect(L10N[id]!.zh).toContain('泰坦')
      expect(L10N[id]!.en).toContain('Titan')
    }
    expect(SHIPS.find((s)=>s.id==='sh-colossal')!.name).toContain('旗舰')
    expect(L10N['ui.weekend.060']!.zh).toContain('旗舰')
  })
  it('T5仍不能进入虫洞，拒因取新分类名称', () => {
    const result=wormholeAdmission(buildSimContext(),['sh-colossal'])
    expect(result.ok).toBe(false)
    expect(result.code).toBe('tier-too-high')
    expect(WORMHOLE_ADMISSION_TEXT['tier-too-high']).toContain('泰坦')
  })
})
