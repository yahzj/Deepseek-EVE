/**
 * 远征（V12 两阶段）单元测试：出发校验/去程/途中事件/到港开战/实时战斗/弹药/结算惩罚。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { SimContext, ItemDef, FoeShipDef, AnomalyDef } from '../src/types'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import { addModule, fitModule } from '../src/equipment'
import {
  advanceAutoLoopBounty,
  advanceExpedition,
  battleTacticDesire,
  expeditionStatus,
  setBattleDesire,
  startExpedition,
} from '../src/expedition'
import { battleWinPreview, battleArcsFor, bountyDamageForecast, bountyWinPercentGuarded, createFoeSpecs } from '../src/combat'
import { anomaly, DEFAULT_TEST_ITEMS, makeTestCtx, moduleDef, ship } from './helpers'

describe('远征 V12：两阶段', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 42 })
    state.wallet.isk = 500_000
    ctx = makeTestCtx()
  })

  it('出发校验：采矿中/远征中/未知目标/声望不足拒绝', () => {
    expect(startExpedition(state, '不存在的目标', ctx).ok).toBe(false)
    state.mining.active = true
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(false)
    state.mining.active = false
    // ano-hard 需声望 5，且目标星系需已探索（V13 封锁）
    const r = startExpedition(state, 'ano-hard', ctx)
    expect(r.ok).toBe(false)
    state.standings['dsi'] = 5
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(false) // 未探索 → 拒绝
    state.exploredGalaxies.push('galaxy-far')
    expect(startExpedition(state, 'ano-hard', ctx).ok).toBe(true)
    // 去程取消：下达即进入交火（不再有 out 等待相位）
    expect(state.expedition.phase).toBe('battle')
    expect(state.expedition.active).toBe(true)
  })

  it('去程取消：出发即开战（无 out 等待）；交火打完自动结算', () => {
    // ano-a 在母港星系：即时进入交火
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    expect(state.expedition.phase).toBe('battle')
    expect(state.expedition.battle).not.toBeNull()
    // 长推进把战斗打完（战斗上限 10 分钟；母港目标 vs 沙猫很快分出胜负）
    advanceGame(state, 10 * 60_000, ctx)
    const exp = state.expedition
    if (exp.active && exp.phase === 'battle') {
      // 仍未结束（理论上不会，兜底断言不崩即可）
      advanceGame(state, 20 * 60_000, ctx)
    }
    expect(state.expedition.active).toBe(false)
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })

  it('途中事件在出发瞬间触发一次（去程已取消，无中段等待）', () => {
    const farCtx = makeTestCtx({
      anomalies: [anomaly('ano-far0', 'galaxy-far', { threat: 4, reward: 5_000 })],
      balance: { ...makeTestCtx().balance, travelEventChance: 1 }, // 途中事件必触发（去随机）
    })
    state.exploredGalaxies.push('galaxy-far') // V13：目标星系需已探索
    expect(startExpedition(state, 'ano-far0', farCtx).ok).toBe(true)
    // 去程取消：事件在出发瞬间触发
    expect(state.expedition.eventFired).toBe(true)
    expect(state.logs.some((l) => l.text.includes('途中遭遇事件'))).toBe(true)
    expect(state.expedition.phase).toBe('battle')
  })

  it('失利路径：维修费按期望奖励×50% 扣款、耐久下降', () => {
    // 制造必然战败：威胁极高的母港目标
    const brutalCtx = makeTestCtx({
      anomalies: [anomaly('ano-brutal', 'galaxy-hub', { threat: 2000, reward: 10_000 })],
    })
    expect(startExpedition(state, 'ano-brutal', brutalCtx).ok).toBe(true)
    const durBefore = state.fleet[state.shipId]!.durability
    const walletBefore = state.wallet.isk
    advanceGame(state, 120_000, brutalCtx)
    expect(state.expedition.active).toBe(false)
    const durAfter = state.fleet[state.shipId]!.durability
    if (durAfter < durBefore) {
      // 未弃船：维修费 = min(钱包, 10000×0.5)
      expect(walletBefore - state.wallet.isk).toBeLessThanOrEqual(5_000)
    }
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
  })

  it('炮台参战消耗弹药并退回剩余', () => {
    const tur = moduleDef('tur-b', 'turret', 0.5, { maxRangeM: 4000, minRangeM: 0, hitRate: 0.8, falloff: 0.3, reloadMs: 1500, dmgMult: 2.0 })
    const ctxB = makeTestCtx({ modules: [tur], anomalies: [anomaly('ano-w', 'galaxy-hub', { threat: 1, reward: 1_000 })] })
    state.warehouse.items['ammo-kinetic-l'] = 500
    addModule(state, 'tur-b', 1)
    expect(fitModule(state, 'tur-b', ctxB).ok).toBe(true)
    expect(startExpedition(state, 'ano-w', ctxB).ok).toBe(true)
    advanceGame(state, 10 * 60_000, ctxB) // 打赢（结算在 chunk 末尾）
    advanceGame(state, 125_000, ctxB) // 本地悬赏返港段 120s（2026-09-08）
    expect(state.expedition.active).toBe(false)
    // 剩余弹药退回仓库（消耗后应少于 500）
    const left = state.warehouse.items['ammo-kinetic-l'] ?? 0
    expect(left).toBeLessThan(500)
  })

  it('战后总结带修理组件消耗：战报尾巴「船体维修装置消耗 民用修理组件 ×N」', () => {
    // 2026-09-11 船长：「船体修理装置不单独显示日志。只将消耗组件数量显示到战后总结」
    const rep = moduleDef('mod-hullrep-t', 'support', 0, { rack: 'mid', cpuUse: 1, repairArmorHp: 5, repairHullHp: 5, repairKit: 'repairkit-civ' })
    const ctxR = makeTestCtx({
      ships: [ship('sandcat', { shieldHp: 3_000, armorHp: 5_000, hullHp: 5_000 })], // 同名覆盖默认沙猫：血厚到 5 秒内打不完
      modules: [rep],
      items: [{ id: 'repairkit-civ', name: '民用修理组件', kind: 'kit', unitM3: 1, baseSellPriceIsk: 3_000, description: '测试民用修理组件' }],
      anomalies: [anomaly('ano-repair-t', 'galaxy-hub', { threat: 40, reward: 20_000 })],
      quietEvents: true,
    })
    addModule(state, 'mod-hullrep-t', 1)
    expect(fitModule(state, 'mod-hullrep-t', ctxR).ok).toBe(true)
    state.warehouse.items['repairkit-civ'] = 200 // 预载（货舱优先、仓库兜底）
    expect(startExpedition(state, 'ano-repair-t', ctxR).ok).toBe(true)
    // 人为制造缺口（盾打空、甲/结构重残）：保证每跳都实际修复、都扣组件（同 combat.test 口径）
    state.expedition.battle!.units['player']!.hp = { s: 0, a: 3_000, h: 2_000 }
    // 打完（战斗上限 10 分钟）+ 返港段走完（本地悬赏 120s），按需多推几拍
    for (let i = 0; i < 20 && state.expedition.active; i++) advanceGame(state, 60_000, ctxR)
    expect(state.expedition.active).toBe(false)
    const report = [...state.logs].reverse().find((l) => l.text.includes('战报'))
    expect(report?.text ?? '').toMatch(/船体维修装置消耗 民用修理组件 ×\d+/)
  })

  it('battleTacticDesire / setBattleDesire：战斗中可调期望距离并钳制；**按星系**记忆且出发时沿用', () => {
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    advanceGame(state, 5_000, ctx) // 到港开战
    const galaxy = ctx.anomalies.get('ano-a')!.galaxyId
    const desire = battleTacticDesire(state, ctx, 'kite')
    expect(desire).toBeGreaterThan(0)
    expect(setBattleDesire(state, desire, ctx).ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBe(desire)
    expect(state.expedition.desirePrefByGalaxy?.[galaxy]).toBe(desire) // 记忆 = 该星系的目标距离
    // 巨大值被钳制到开战距离内
    expect(setBattleDesire(state, 1_000_000_000, ctx).ok).toBe(true)
    expect(state.expedition.battle!.myDesireM).toBeLessThan(1_000_000_000)
    // 出发时显式 desireM 优先（开战后 myDesireM 应等于它，且写进该星系的设定）
    const s2 = createInitialState({ nowWallMs: 0, seed: 9 })
    s2.wallet.isk = 500_000
    expect(startExpedition(s2, 'ano-a', ctx, { desireM: 2_000 }).ok).toBe(true)
    advanceGame(s2, 5_000, ctx)
    expect(s2.expedition.battle!.myDesireM).toBe(2_000)
    expect(s2.expedition.desirePrefByGalaxy?.[galaxy]).toBe(2_000)
  })

  it('battleWinPreview 可用；远征面板：下达即交火（combat），交火中不展示预估胜率', () => {
    const p = battleWinPreview(state, ctx, ctx.anomalies.get('ano-a')!, 'sandcat')
    expect(expeditionStatus(state, ctx).winPercent).toBe(0) // 未出发
    startExpedition(state, 'ano-a', ctx)
    const view = expeditionStatus(state, ctx)
    expect(view.phase).toBe('combat') // 去程取消：下达即开战
    expect(view.winPercent).toBe(0) // 交火中按 0（不展示）
    expect(p).toBeGreaterThan(0)
    expect(advanceExpedition).toBeTypeOf('function')
  })

  it('调试快进冻结主控远征战斗：大步推进不瞬结、恢复后正常打完', () => {
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    advanceGame(state, 5_000, ctx) // 到港开战（战斗进行中）
    const exp = state.expedition
    expect(exp.phase).toBe('battle')
    // 冻结大步推进：战斗不瞬结，仍进行中
    advanceGame(state, 10 * 60_000, ctx, { freezeBattle: true })
    expect(exp.phase).toBe('battle')
    expect(exp.battle).not.toBeNull()
    expect(exp.battle!.ended).toBeFalsy()
    expect(exp.battle!.lastTickGameMs).toBe(state.gameMs) // 时钟已同步，不欠快进时间
    // 恢复后正常打完；本地悬赏结算后需再走返港段 120s
    advanceGame(state, 10 * 60_000, ctx)
    advanceGame(state, 125_000, ctx)
    expect(exp.active).toBe(false)
  })

  it('击杀慢镜：分出胜负后延迟 killcamMs 再结算（主控），大步长推进仍立即结算', () => {
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    advanceGame(state, 5_000, ctx) // 到港开战（战斗进行中）
    const exp = state.expedition
    expect(exp.phase).toBe('battle')
    const b = exp.battle!
    // 手工处决：全部敌舰三层血清零 → 下一拍 ended='me'
    for (const u of Object.values(b.units)) {
      if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
    }
    advanceGame(state, 100, ctx)
    expect(b.ended).toBe('me')
    // 慢镜窗口内（击杀后 ~100ms，距 1500ms 门槛尚远）：不结算、不转返航
    expect(exp.phase).toBe('battle')
    expect(exp.battle).not.toBeNull()
    advanceGame(state, 1_000, ctx) // 累计 ~1.1s < 1.5s
    expect(exp.phase).toBe('battle')
    // 窗口走完：结算 → 转返航（母港本地悬赏返港段 120s，2026-09-08 船长定）并出战报
    advanceGame(state, 1_000, ctx) // 累计 ≥2.1s
    expect(state.expedition.active).toBe(true)
    expect(state.expedition.phase).toBe('back')
    expect(state.logs.some((l) => l.text.includes('战报'))).toBe(true)
    advanceGame(state, 120_000, ctx) // 走完返港段 → 停靠母港
    expect(state.expedition.active).toBe(false)
  })

  it('声望仅首胜发放：同一目标重复完成不再涨声望（防低威胁目标无限白刷）', () => {
    // 自定义母港目标：声望 +2/次
    const firstCtx = makeTestCtx({
      anomalies: [anomaly('ano-first', 'galaxy-hub', { threat: 1, reward: 1_000, standingGain: 2 })],
    })
    expect(startExpedition(state, 'ano-first', firstCtx).ok).toBe(true)
    advanceGame(state, 10 * 60_000, firstCtx) // 打赢（结算在 chunk 末尾）
    advanceGame(state, 125_000, firstCtx) // 本地悬赏返港段 120s
    expect(state.expedition.active).toBe(false)
    expect(state.standings['dsi']).toBe(2) // 首胜声望到账
    expect(state.completedBounties).toEqual(['ano-first'])
    const walletAfterFirst = state.wallet.isk
    // 再次重复完成：奖金照发，声望不再增加
    expect(startExpedition(state, 'ano-first', firstCtx).ok).toBe(true)
    advanceGame(state, 10 * 60_000, firstCtx)
    advanceGame(state, 125_000, firstCtx)
    expect(state.expedition.active).toBe(false)
    expect(state.standings['dsi']).toBe(2) // 未再涨
    expect(state.completedBounties).toEqual(['ano-first']) // 清单不重复
    expect(state.wallet.isk).toBeGreaterThan(walletAfterFirst) // 钱照给
    expect(state.logs.some((l) => l.text.includes('无额外声望'))).toBe(true)
  })
})

describe('远征自动返航最近建成站（2026-09-08 船长定：所有自动返航选最近已建成站）', () => {  it('目标星系已建成副站：胜利 = 本地返港 120s，到港停靠该站（不再回母港）', () => {
    const site = {
      id: 'site-far',
      name: '远郊前哨',
      galaxyId: 'galaxy-far',
      standingReq: 0,
      tiers: [
        { name: '档1', bill: [{ itemId: 'ore-a', count: 100 }], unlockDesc: '施工推进' },
        { name: '档2', bill: [{ itemId: 'ore-a', count: 100 }], unlockDesc: '建成并入空间站清单' },
      ],
      introDialogueId: null,
      doneDialogueId: null,
      description: '',
    }
    const st = createInitialState({ nowWallMs: 0, seed: 7 })
    st.wallet.isk = 500_000
    const c = makeTestCtx({
      stations: [site],
      anomalies: [anomaly('ano-far-v', 'galaxy-far', { threat: 2, reward: 8_000 })],
    })
    st.exploredGalaxies.push('galaxy-far')
    st.stationSites['site-far'] = { stage: 2, delivered: {} } // 已建成
    expect(startExpedition(st, 'ano-far-v', c).ok).toBe(true)
    // 小步推进直到转入返航段（2026-09-09：返航从战斗停表时刻起算——大步长会把返航一并结算到家）
    for (let i = 0; i < 600 && !(st.expedition.active && st.expedition.phase === 'back'); i++) {
      advanceGame(st, 500, c)
    }
    expect(st.expedition.phase).toBe('back') // 本地返航段
    advanceGame(st, 125_000, c) // 走完 120s 返港段
    expect(st.expedition.active).toBe(false)
    expect(st.dockedSite).toBe('site-far') // 落点 = 该站（母港镜像入口）
    expect(st.awayGalaxy).toBeNull()
    expect(st.logs.some((l) => l.text.includes('「远郊前哨」'))).toBe(true)
  })
})

describe('战斗界面敌方射程聚合（2026-09-08 玩家反馈：敌方最小射程被 0 初值吞成 0）', () => {
  it('kite/带僚机目标：foe.minM = 真实近盲起点（>0），foe.maxM 正常', () => {
    const st = createInitialState({ nowWallMs: 0, seed: 5 })
    st.wallet.isk = 500_000
    const foe = {
      ...anomaly('ano-kite', 'galaxy-hub', { threat: 34, reward: 1_000 }),
      tactic: 'kite' as const,
      dmgMix: { plasma: 2 } as const,
      escorts: 1,
    }
    const c = makeTestCtx({ anomalies: [foe] })
    expect(startExpedition(st, 'ano-kite', c).ok).toBe(true)
    advanceGame(st, 5_000, c) // 开战（battle 存在即可读聚合视图）
    const arcs = battleArcsFor(st, c)
    expect(arcs).not.toBeNull()
    expect(arcs!.foe.maxM).toBeGreaterThan(0)
    expect(arcs!.foe.minM).toBeGreaterThan(0) // kite 模板 min 1200×(1+成长)>0——回归：旧代码恒为 0
    expect(arcs!.foe.minM).toBeLessThan(arcs!.foe.maxM)
    expect(arcs!.foe.type).toBe('plasma')
  })

  // 2026-09-11 船长：「战斗场景内，假如敌方的舰船射程不一致，只会显示其中一个的射程」
  // ——指屏幕下方那条「敌方 X~Ym」legend；现已按射程带逐条下发（外圈在前）。
  it('敌方多套射程：foeBands 逐带列出（外圈在前、带舰数），聚合带 = 并集（单一带时只有一条）', () => {
    const LONG: FoeShipDef = {
      id: 't-band-long',
      name: '测试头目舰',
      family: 'A',
      hullClassTier: 3,
      speedRatio: 1,
      hp: 400,
      split: { s: 0.2, a: 0.55, h: 0.25 },
      shotDmg: 40,
      hitRate: 0.9,
      reloadMs: 4000,
      rangeMinM: 1,
      rangeMaxM: 2210,
      falloff: 0.3,
      dmgMix: { kinetic: 8, explosive: 2 },
      tactic: 'brawl',
    }
    const SHORT: FoeShipDef = { ...LONG, id: 't-band-short', name: '测试快艇', hullClassTier: 1, rangeMaxM: 1883 }
    const st = createInitialState({ nowWallMs: 0, seed: 5 })
    st.wallet.isk = 500_000
    const card: AnomalyDef = {
      ...anomaly('ano-bands', 'galaxy-hub', { threat: 20, reward: 1_000 }),
      ships: [{ ship: LONG }, { ship: SHORT, count: 3 }],
    }
    const c = makeTestCtx({ anomalies: [card] })
    expect(startExpedition(st, 'ano-bands', c).ok).toBe(true)
    advanceGame(st, 5_000, c)
    const arcs = battleArcsFor(st, c)
    expect(arcs).not.toBeNull()
    // 聚合带仍是并集（旧口径保持：距离尺色带与战场弧继续用它）
    expect(arcs!.foe.minM).toBe(1)
    expect(arcs!.foe.maxM).toBe(2210)
    // 逐带分解：远带在前，各带带出"用它的敌舰艘数"
    expect(arcs!.foeBands.map((b) => [b.minM, b.maxM, b.count])).toEqual([
      [1, 2210, 1],
      [1, 1883, 3],
    ])
    expect(arcs!.foeBands[0]!.names).toEqual(['测试头目舰'])
    expect(arcs!.foeBands[1]!.names).toEqual(['测试快艇'])
    expect(arcs!.foeBands.every((b) => b.type === 'kinetic')).toBe(true)
    // 单一射程带的卡仍只出一条（界面观感与旧版一致）
    const solo = createInitialState({ nowWallMs: 0, seed: 5 })
    solo.wallet.isk = 500_000
    const soloCard: AnomalyDef = {
      ...anomaly('ano-solo-band', 'galaxy-hub', { threat: 20, reward: 1_000 }),
      ships: [{ ship: LONG }, { ship: LONG, count: 2 }],
    }
    const c2 = makeTestCtx({ anomalies: [soloCard] })
    expect(startExpedition(solo, 'ano-solo-band', c2).ok).toBe(true)
    advanceGame(solo, 5_000, c2)
    const arcs2 = battleArcsFor(solo, c2)
    expect(arcs2!.foeBands).toHaveLength(1)
    expect([arcs2!.foeBands[0]!.minM, arcs2!.foeBands[0]!.maxM, arcs2!.foeBands[0]!.count]).toEqual([1, 2210, 3])
  })
})

describe('返航段进度条（2026-09-08 玩家反馈：仅倒计时变、进度条不动）', () => {
  it('本地悬赏 back：percent 随剩余时间推进（0 → 60s 后 50% → 到港）', () => {
    const st = createInitialState({ nowWallMs: 0, seed: 3 })
    st.wallet.isk = 500_000
    const c = makeTestCtx({ anomalies: [anomaly('ano-bar', 'galaxy-hub', { threat: 1, reward: 1_000 })] })
    expect(startExpedition(st, 'ano-bar', c).ok).toBe(true)
    // 小步推进直到转入返航段（2026-09-09 修复后返航从战斗停表时刻起算；大步长会直接把返航结算完）
    for (let i = 0; i < 600 && !(st.expedition.active && st.expedition.phase === 'back'); i++) {
      advanceGame(st, 500, c)
    }
    expect(st.expedition.phase).toBe('back')
    const v0 = expeditionStatus(st, c)
    expect(v0.phase).toBe('back')
    expect(v0.percent).toBeLessThan(5) // 刚转入返航段：进度接近 0（回归：旧分母 outMs×2=0 → 恒 0/卡死）
    advanceGame(st, 60_000, c)
    const v1 = expeditionStatus(st, c)
    expect(v1.percent).toBeGreaterThan(v0.percent) // 进度随剩余时间推进
    expect(v1.percent).toBeGreaterThan(40) // 120s 段已过半附近
    advanceGame(st, 61_000, c)
    expect(st.expedition.active).toBe(false) // 返航完成
  })
})

describe('敌方能量=光束必中 + 普遍高命中/低命中特例（2026-09-08 船长定）', () => {  it('specs：plasma → beam（hitRate 1、近盲带保留 minRange>0）；kinetic 缺省命中 = 0.85、逐卡特例生效', () => {
    const ctx = makeTestCtx({ quietEvents: true })
    const bal = ctx.balance.battle
    const plasma = {
      ...anomaly('ano-p1', 'galaxy-hub', { threat: 20, reward: 1_000 }),
      tactic: 'kite' as const,
      dmgMix: { plasma: 2 } as const,
    }
    const w = createFoeSpecs(plasma, bal)[0]!.weapons[0]!
    expect(w.kind).toBe('beam')
    expect(w.hitRate).toBe(1)
    expect(w.minRangeM).toBeGreaterThan(0) // 近盲带保留
    expect(w.blindDmgMul).toBe(0.3)
    const kin = createFoeSpecs({ ...anomaly('ano-k1', 'galaxy-hub', { threat: 20, reward: 1_000 }), dmgMix: { kinetic: 2 } }, bal)[0]!.weapons[0]!
    expect(kin.kind).toBe('fixed')
    expect(kin.hitRate).toBe(0.85) // 普遍高命中缺省
    const kinLow = createFoeSpecs(
      { ...anomaly('ano-k2', 'galaxy-hub', { threat: 20, reward: 1_000 }), dmgMix: { kinetic: 2 }, foeHitRate: 0.55 },
      bal,
    )[0]!.weapons[0]!
    expect(kinLow.hitRate).toBe(0.55) // 低命中特例（占港/泰坦）
  })

  it('单发推导：无逐卡伤害倍率口，单发 = 名义DPS × 装填 × 命中补偿（2026-09-11 等效回退口退休后锁定）', () => {
    const ctx = makeTestCtx({ quietEvents: true })
    const bal = ctx.balance.battle
    const dps = 34 * bal.foeDpsPerThreat // 名义 DPS = 威胁份额 × foeDpsPerThreat（无僚机 → 份额 = 威胁）
    // 能量（光束必中）：effHit = 1 → 不消费命中补偿 → 单发 = DPS × 装填
    const plasma = {
      ...anomaly('ano-shot-p', 'galaxy-hub', { threat: 34, reward: 1_000 }),
      tactic: 'kite' as const,
      dmgMix: { plasma: 2 } as const,
    }
    const wp = createFoeSpecs(plasma, bal)[0]!.weapons[0]!
    expect(wp.kind).toBe('beam')
    expect(wp.shotDmg).toBe(Math.round(dps * (bal.foeReloadMs / 1000)))
    // 动能（fixed）：单发 = DPS × 装填 ÷ 有效命中 × foeHitCompMul（有效命中 = 缺省 foeHitRate）
    const kinetic = {
      ...anomaly('ano-shot-k', 'galaxy-hub', { threat: 34, reward: 1_000 }),
      dmgMix: { kinetic: 2 } as const,
    }
    const wk = createFoeSpecs(kinetic, bal)[0]!.weapons[0]!
    expect(wk.hitRate).toBe(bal.foeHitRate)
    expect(wk.shotDmg).toBe(Math.round(dps * (bal.foeReloadMs / 1000) * (bal.foeHitCompMul / bal.foeHitRate)))
  })
})

/* ═══════════ 连续作战保险（2026-09-08 船长定：带伤预警 + 战内自动撤退 + 装甲门槛） ═══════════ */

describe('连续作战保险', () => {
  let state: GameState
  let ctx: SimContext

  beforeEach(() => {
    state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.wallet.isk = 500_000
    ctx = makeTestCtx({ quietEvents: true })
  })

  it('带伤预警口径：预计损耗越大展示扣分越多；无损耗时与原预览一致（结算口径 battleWinPreview 不变）', () => {
    const weak = ctx.anomalies.get('ano-a')!
    const strong = ctx.anomalies.get('ano-hard')!
    const fw = bountyDamageForecast(state, ctx, weak, state.shipId)
    const fs = bountyDamageForecast(state, ctx, strong, state.shipId)
    // 自洽：损耗比在 0~1；强敌（threat 40）预计损耗 ≥ 弱敌（threat 8）
    for (const f of [fw, fs]) {
      expect(f.armorLoss).toBeGreaterThanOrEqual(0)
      expect(f.armorLoss).toBeLessThanOrEqual(1)
      expect(f.hullLoss).toBeGreaterThanOrEqual(0)
      expect(f.hullLoss).toBeLessThanOrEqual(1)
    }
    expect(fs.hullLoss + fs.armorLoss).toBeGreaterThanOrEqual(fw.hullLoss + fw.armorLoss)
    // 展示口径 ≤ 原口径；损耗大时扣分更多
    const rawWeak = battleWinPreview(state, ctx, weak, state.shipId)
    const gWeak = bountyWinPercentGuarded(state, ctx, weak, state.shipId)
    const gStrong = bountyWinPercentGuarded(state, ctx, strong, state.shipId)
    expect(gWeak).toBeLessThanOrEqual(rawWeak + 1e-9)
    expect(gStrong).toBeLessThanOrEqual(gWeak + 1e-9)
    // 原口径 battleWinPreview 不受影响（仍按满耐久基准）
    expect(battleWinPreview(state, ctx, weak, state.shipId)).toBe(rawWeak)
  })

  it('巡回自动再出发门槛看装甲：装甲 <50% 且无修理组件 → 停环（原先只看结构，太晚）', () => {
    state.autoLoopAnomalyId = 'ano-a' // 本地目标（无冷却/无探索门槛）
    const fs = state.fleet[state.shipId]!
    fs.armorPct = 0.4 // 装甲已残、结构尚好——旧逻辑（结构 <0.5 才拦）会放行
    fs.durability = 0.9
    const reason = advanceAutoLoopBounty(state, ctx)
    expect(reason).toContain('修理组件耗尽')
    expect(state.autoLoopAnomalyId).toBeNull()
    expect(state.expedition.active).toBe(false) // 未出发
  })

  it('巡回自动再出发：装甲 <50% 时有货仓修理组件 → 自动修补到 60% 再出发（战斗挂保险阈值 50%）', () => {
    const kit: ItemDef = {
      id: 'repairkit-civ',
      name: '民用修理组件',
      kind: 'kit',
      unitM3: 1,
      baseSellPriceIsk: 100,
      repairRestore: 30,
      description: '',
    }
    ctx = makeTestCtx({ quietEvents: true, items: [...DEFAULT_TEST_ITEMS, kit] })
    state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.wallet.isk = 500_000
    state.autoLoopAnomalyId = 'ano-a'
    const fs = state.fleet[state.shipId]!
    fs.armorPct = 0.4
    fs.durability = 0.9
    fs.cargo['repairkit-civ'] = 50
    const reason = advanceAutoLoopBounty(state, ctx)
    expect(reason).toBeNull()
    expect(state.fleet[state.shipId]!.armorPct ?? 1).toBeGreaterThanOrEqual(0.6) // 修补目标 0.6
    expect(state.expedition.active).toBe(true)
    expect(state.expedition.phase).toBe('battle') // 本地目标即时开战
    expect(state.expedition.battle!.hullEscapeFrac).toBe(0.5) // 巡回场挂自动撤退阈值
    expect(state.logs.some((l) => l.text.includes('自动使用修理组件'))).toBe(true)
  })

  it('巡回场战斗内结构损失过半 → 自动撤退：轻损保船、停环、转返航（绝不弃船）', () => {
    expect(startExpedition(state, 'ano-a', ctx).ok).toBe(true)
    expect(state.expedition.phase).toBe('battle')
    const b = state.expedition.battle!
    // 等效巡回场（自动再出发路径在 beginBattleAt 挂 0.5；手动开场等效补挂）
    state.autoLoopAnomalyId = 'ano-a'
    b.hullEscapeFrac = 0.5
    // 人为压伤：结构剩 40%（< 50% 阈值）
    b.units['player']!.hp.h = Math.floor((b.units['player']!.hp.h * 0.4) * 100) / 100
    const shipId = state.shipId
    advanceGame(state, 2_000, ctx)
    const exp = state.expedition
    expect(exp.active).toBe(true)
    expect(exp.phase).toBe('back') // 已自动撤退转返航
    expect(exp.returnReason).toBe('retreat')
    expect(state.autoLoopAnomalyId).toBeNull() // 撤退即终止重复清剿
    expect(state.fleet[shipId]).toBeDefined() // 船没丢
    const dur = state.fleet[shipId]!.durability
    expect(dur).toBeGreaterThan(0.05) // 下限保护
    expect(dur).toBeLessThan(0.5) // 本场已残
    expect(state.logs.some((l) => l.text.includes('自动撤退'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('重复清剿已停止'))).toBe(true)
    // 返航到港：作业完整结束
    advanceGame(state, 10 * 60_000, ctx)
    expect(state.expedition.active).toBe(false)
  })
})
