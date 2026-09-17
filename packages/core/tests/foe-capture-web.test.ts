/**
 * **劫掠捕获网**（船长 2026-09-16 两句话）＋ **首次遭遇通讯**。
 *
 * 船长原话（照抄）：
 * 1.「新增A族敌人劫掠电子舰，添加挂载件冲锋，并额外加装一件新的挂载件，劫掠捕获网：**降低目标90%移动速度，
 *   并关闭所有类型推进器**。**在自身第一次开火时发动**。动画效果为一根蓝色的光速连着命中舰船。添加进深层的海盗战团里。」
 * 2.「**血量修正为0.7**」＋「**补充一点，劫掠捕获网还会让目标闪避强制为0，射程降低500米**」
 * 3.「**在玩家第一次遭遇劫掠电子舰之后。结束虫洞或回到主界面时，给玩家发送一封通讯，介绍劫掠电子舰的捕获网。**」
 *
 * 四问四答：触发 = **开火即发动**（不看命中）· 作用面 = **只钉目标一艘 · 本场永久 · 击杀发动者即解除** ·
 * 编成 = 头目×1 + 电子舰×1 + 快艇×2 · 新舰 = **T1 护卫**（血 0.70 ⇒ 182）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import { addShipToFleet, advanceComms, createInitialState, createPlayerSpec, startFleetBattleFor } from '../src/index'
import { advanceBattleFor, battleArcsFor, createFoeSpecs, wormholeDerivedAnomaly } from '../src/combat'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const CARD = 'wh-pirate-warband'
const EWAR = 'foe-pirate-raider'

/** 起一场「海盗战团」战斗（用真实开战入口：深度 4 = 该卡的出场层） */
function warbandBattle() {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const ids = [addShipToFleet(state, 'sh-thresher'), addShipToFleet(state, 'sh-thresher')]
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
  const battle = startFleetBattleFor(state, ctx, ids, CARD, 0, null, { depth: 4, kind: 'node', waves: 1 })
  expect(battle).toBeTruthy()
  const b = battle!
  const ewTag = Object.values(b.units).find((u) => u.name === '劫掠电子舰')?.tag
  return {
    state,
    battle: b,
    ewTag,
    tick: (toMs: number) => {
      state.gameMs = toMs
      advanceBattleFor(state, ctx, b, ids[0]!, CARD)
    },
  }
}

describe('劫掠电子舰 · 舰级与挂载件', () => {
  it('舰级数值（T1 护卫 · 血 182 = 260×0.70 · 闪避 0.30 · 单发 30 · 速 374）', () => {
    const s = FOE_SHIPS.find((x) => x.id === EWAR)!
    expect(s.name).toBe('劫掠电子舰')
    expect(s.family).toBe('A')
    expect(s.hullClassTier).toBe(1)
    expect(s.hp).toBe(182)
    expect(s.evasion).toBe(0.3)
    expect(s.shotDmg).toBe(30)
    expect(Math.round(bal.hullClassBaseSpeedMps[1] * s.speedRatio)).toBe(374)
    expect(s.mounts).toEqual(['foe-mount-charge-pirate', 'foe-mount-capture-web'])
  })

  it('编成：头目×1 + 电子舰×1 + 快艇×2（单位数仍 4）', () => {
    const card = ctx.anomalies.get(CARD)!
    expect((card.ships ?? []).map((s) => [s.ship.id, s.count ?? 1])).toEqual([
      ['foe-pirate-warlord', 1],
      [EWAR, 1],
      ['foe-pirate-skiff', 2],
    ])
  })

  it('规格层：队伍里那一条带着捕获网参数与冲锋资格（闪避也走舰级覆写）', () => {
    const card = ctx.anomalies.get(CARD)!
    const derived = wormholeDerivedAnomaly(ctx, card, { depth: 4, kind: 'node', waves: 1 })
    const ew = createFoeSpecs(derived, bal).filter((f) => f.name === '劫掠电子舰')
    expect(ew.length).toBe(1)
    expect(ew[0]!.foeCaptureWeb).toEqual({ slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 })
    expect(ew[0]!.foeCanCharge).toBe(true)
    expect(ew[0]!.foeChargeMul).toBe(1.6)
    expect(ew[0]!.evasion).toBe(0.3)
    expect(ew[0]!.foeMountNames).toEqual(['劫掠冲锋推进器', '劫掠捕获网'])
  })
})

describe('劫掠捕获网 · 触发与四层效果', () => {
  it('第一次开火即发动（不看命中）：钉住本发目标，四层效果全落地', () => {
    const { battle, ewTag, tick } = warbandBattle()
    expect(ewTag, '本卡应有劫掠电子舰').toBeTruthy()
    // 开打前：我方速度 = 面板口径原值
    tick(1_000)
    const speedBefore = battle.meSpeedMps!
    expect(speedBefore).toBeGreaterThan(0)
    // 推进到它开火（装填 4 秒 + 入场/错峰窗口）
    let webbed = false
    for (let t = 2_000; t <= 60_000; t += 1_000) {
      tick(t)
      if (Object.keys(battle.meWebDebuffs ?? {}).length > 0) {
        webbed = true
        break
      }
      if (battle.ended) break
    }
    expect(webbed, '电子舰第一次开火后应张开捕获网').toBe(true)
    const entry = Object.entries(battle.meWebDebuffs!)[0]!
    expect(entry[1].byTag, '施放者 = 劫掠电子舰').toBe(ewTag)
    expect(entry[1]).toMatchObject({ slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 })
    // 整场只发一次
    expect(battle.foeWebFired?.[ewTag!]).toBe(true)
    // 特效：一条 web 连线事件（渲染层据此画蓝色光束）
    expect(battle.fx.some((e) => e.web === true && e.tag === ewTag && e.to === entry[0])).toBe(true)
    // ⚠ 这里**不**断言"下一拍速度掉到一成"：真战斗里我方很可能在挨网后很快被打完
    //   （深层战团），`meSpeedMps` 会停在被钉前那一拍的值。该口径由下面那条**独立用例**钉
    //   （手工上账本 ⇒ 下一拍重建必须吃效果）。
  })

  /**
   * **每拍重建口径**（与"触发"分开测）：手工写账本 ⇒ 下一拍 `buildMyUnitSpecs` 必须按账本重建
   * ⇒ 显示速度掉到约一成、推进器熄火；**视图**（面板/射程带同一把尺）也吃同一份效果。
   */
  it('被钉后每拍重建：显示速度 ×0.1、视图射程带 −500m', () => {
    const { state, battle, ewTag, tick } = warbandBattle()
    tick(1_000)
    // ⚠ 不读"钉之前"的实测值：真战斗里电子舰可能**这一拍已经开火**（本用例只验重建口径）
    //   ⇒ 用"干净规格"算期望值（两艘同型：一艘被钉 ⇒ 平均 = (0.1 + 1) ÷ 2 = 0.55×）。
    const clean = createPlayerSpec(state, ctx, state.shipId)!
    const cleanPanel = clean.speedMps
    // 手工上账本（等价于"电子舰刚发了网"；只钉 player 一条 = 船长口径"只钉目标一艘"）
    battle.meWebDebuffs = {
      player: { byTag: ewTag ?? 'foe-0', slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500, atMs: 1_000 },
    }
    tick(2_000)
    expect(battle.meSpeedMps!, '被钉那一艘掉到一成 ⇒ 编队平均 ≈ 0.55×').toBe(Math.round((cleanPanel * 0.1 + cleanPanel) / 2))
    // 视图：锚舰射程带上限应比"干净规格"短 500（显式给视图上下文：本用例是"直接开卡"，不走洞外远征槽）
    const cleanMax = Math.max(...clean.weapons.map((w) => w.maxRangeM))
    const arcs = battleArcsFor(state, ctx, { battle, anomaly: ctx.anomalies.get(CARD)!, leaderShipId: state.shipId })!
    // 视图里的武器条（含兜底基础舰炮）也逐条 −500：取其最远端与"干净规格最远端 − 500"对齐
    expect(Math.max(...arcs.me.map((w) => w.maxM))).toBe(Math.max(2, cleanMax - 500))
  })

  it('解除：击沉发动者 ⇒ 账本清空、效果消失', () => {
    const { battle, ewTag, tick } = warbandBattle()
    let webbed = false
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      tick(t)
      if (Object.keys(battle.meWebDebuffs ?? {}).length > 0) {
        webbed = true
        break
      }
      if (battle.ended) break
    }
    expect(webbed).toBe(true)
    // 白盒：直接把发动者打沉（等价于"玩家把它点掉了"）
    const rt = battle.units[ewTag!]!
    rt.hp = { s: 0, a: 0, h: 0 }
    tick(62_000)
    expect(Object.keys(battle.meWebDebuffs ?? {}), '发动者已沉 ⇒ 网应解除').toHaveLength(0)
  })
})

describe('首次遭遇通讯（结束虫洞或回主界面才送达）', () => {
  it('开战即记下"见过这艘舰"；洞内/交战中压着不投递，空了才送', () => {
    const { state, battle } = warbandBattle()
    expect(state.foeShipSeen?.[EWAR], '开战应记下见过的敌方舰级').toBe(true)
    // 模拟"还在洞里/还在交火"：洞外的在途战斗挂在 expedition.battle
    state.expedition.battle = battle
    advanceComms(state, ctx)
    expect(state.commsDelivered?.['msg-pirate-capture-web'], '忙时不该送达').toBeUndefined()
    // 回到主界面（没有在途战斗、不在洞内）⇒ 这一拍送达
    state.expedition.battle = null
    advanceComms(state, ctx)
    expect(state.commsDelivered?.['msg-pirate-capture-web'], '空了应送达').toBeDefined()
  })

  it('没遇到过就不发（新档 / 没打过这张卡）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    advanceComms(state, ctx)
    expect(state.commsDelivered?.['msg-pirate-capture-web']).toBeUndefined()
  })
})