/**
 * **劫掠捕获网**（船长 2026-09-16 两句话）＋ **首次遭遇通讯**。
 *
 * 船长原话（照抄）：
 * 1.「新增A族敌人劫掠电子舰，添加挂载件冲锋，并额外加装一件新的挂载件，劫掠捕获网：**降低目标90%移动速度，
 *   并关闭所有类型推进器**。**在自身第一次开火时发动**。动画效果为一根蓝色的光速连着命中舰船。添加进深层的海盗战团里。」
 * 2.「**血量修正为0.7**」＋「**补充一点，劫掠捕获网还会让目标闪避强制为0，射程降低500米**」
 * 3.「**在玩家第一次遭遇劫掠电子舰之后。结束虫洞或回到主界面时，给玩家发送一封通讯，介绍劫掠电子舰的捕获网。**」
 *
 * 四问四答：触发 = **开火即发动**（不看命中）· 作用面 = **只钉目标一艘 · 击杀发动者即解除** ·
 * 编成 = 头目×1 + 电子舰×1 + 快艇×2 · 新舰 = **T1 护卫**（血 0.70 ⇒ 182）。
 * ＋「**将断开距离提高到4500米，且这个断开对敌我都有效**」（2026-09-26）⇒ 超距 4500 米同样解除。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import { addShipToFleet, advanceComms, createInitialState, createPlayerSpec, startFleetBattleFor } from '../src/index'
import { advanceBattleFor, battleArcsFor, createFoeSpecs, WEB_BREAK_DIST_M, wormholeDerivedAnomaly } from '../src/combat'

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
    // 2026-09-19 船长：「海盗电子舰的冲锋也移除，只在洞内单独挂载」⇒ 舰级不带件（两件写在战团条目上，见下）
    expect(s.mounts, '劫掠电子舰舰级不得带挂载件').toBeUndefined()
  })

  it('编成：头目×1 + 电子舰×1 + 快艇×2（单位数仍 4）· 三件挂载写在电子舰条目上', () => {
    const card = ctx.anomalies.get(CARD)!
    expect((card.ships ?? []).map((s) => [s.ship.id, s.count ?? 1])).toEqual([
      ['foe-pirate-warlord', 1],
      [EWAR, 1],
      ['foe-pirate-skiff', 2],
    ])
    // 有效挂载是「条目 ?? 舰级」（替换不是叠加）⇒ 条目必须逐件都写
    // （2026-09-24 起为三件：姿态陀螺仪也挂在这一条上——船长「电子舰也要挂」）
    const ew = (card.ships ?? []).find((s) => s.ship.id === EWAR)!
    expect(ew.mounts).toEqual(['foe-mount-charge-pirate', 'foe-mount-capture-web', 'foe-mount-gyro-stabilizer'])
  })

  it('规格层：队伍里那一条带着捕获网参数与冲锋资格（闪避 = 舰级覆写 ＋ 姿态陀螺仪加算）', () => {
    const card = ctx.anomalies.get(CARD)!
    const derived = wormholeDerivedAnomaly(ctx, card, { depth: 4, kind: 'node', waves: 1 })
    const ew = createFoeSpecs(derived, bal).filter((f) => f.name === '劫掠电子舰')
    expect(ew.length).toBe(1)
    expect(ew[0]!.foeCaptureWeb).toEqual({ slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 })
    expect(ew[0]!.foeCanCharge).toBe(true)
    expect(ew[0]!.foeChargeMul).toBe(1.6)
    // 2026-09-24 船长：「A族添加一个挂载件：姿态陀螺仪：增加10%闪避」＋「电子舰也要挂」
    // ⇒ 舰级覆写 0.30 加算 +0.10 = **0.40**
    expect(ew[0]!.foeEvasionBonusAdd).toBe(0.1)
    expect(ew[0]!.evasion).toBeCloseTo(0.4, 10)
    expect(ew[0]!.foeMountNames).toEqual(['劫掠冲锋推进器', '劫掠捕获网', '姿态陀螺仪'])
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

  /**
   * **超距断开对敌我都有效**（**船长 2026-09-26**：「**将断开距离提高到4500米，且这个断开对敌我都有效**」）。
   *
   * 口径：每拍结算时交战距离 > `WEB_BREAK_DIST_M`（4500 米）⇒ 敌方那张网也**立刻解除**
   * （`expireFoeWebs`）。⚠ 敌方网**整场只张一次**（`foeWebFired` 已记发放）⇒ 距离再压回来也**不会补发**。
   */
  it('超距断开：距离超过 4500 米 ⇒ 敌方网也解除，且本场不再补发', () => {
    const { state, battle, ewTag, tick } = warbandBattle()
    // 先把双方血量拉满：本用例要的是"距离"这一条，不想被"谁先把谁打死"打断
    for (const u of Object.values(battle.units)) {
      u.hp = { s: 1e9, a: 1e9, h: 1e9 }
      u.hpMax = { s: 1e9, a: 1e9, h: 1e9 }
    }
    let webbed = false
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      tick(t)
      if (Object.keys(battle.meWebDebuffs ?? {}).length > 0) {
        webbed = true
        break
      }
      if (battle.ended) break
    }
    expect(webbed, '先把网张出来').toBe(true)
    expect(battle.foeWebFired?.[ewTag!], '发放已记账').toBe(true)
    const logsBefore = state.logs.length
    // ⚠ 白盒：把交战距离拉到断开距离之上（真战斗里由战术推移，这里直接摆位 ⇒ 判据确定）
    battle.distanceM = WEB_BREAK_DIST_M + 1
    tick(state.gameMs + 1_000)
    expect(Object.keys(battle.meWebDebuffs ?? {}), '超距 ⇒ 敌方网也断开').toHaveLength(0)
    expect(
      state.logs.slice(logsBefore).some((l) => l.text.includes('劫掠捕获网') && l.text.includes(String(WEB_BREAK_DIST_M))),
      '应有一条"距离超过 4500 米"的解除日志',
    ).toBe(true)
    // 距离压回来 ⇒ **不补发**（整场只张一次；要恢复只能指望另一艘还没发过网的敌舰）
    battle.distanceM = 2_000
    for (let k = 1; k <= 20; k++) tick(state.gameMs + 1_000)
    expect(Object.keys(battle.meWebDebuffs ?? {}), '断过的网本场不再补发').toHaveLength(0)
  })
})

/**
 * **多艘同场：没钉到人的网不算用掉**（⟪**2026-09-25 船长报障**⟫）。
 *
 * 船长原话：「**装备劫掠捕获网的船攻击时，如果命中已经被捕获的船时，并不会触发，而是保留直到攻击了
 * 没有被捕获的船。**」——现状与他要的相反：`fireFoeCaptureWeb` 原先**无条件**先记 `foeWebFired` 再判
 * "目标已被钉住"，于是第 2 艘起的网被**静默作废**（无蓝线、无日志、此后整场不再发放）。
 *
 * 为什么这条报障值得单开一组用例：网挂在 **H 族「墨潮突击舰」的舰级上**（2026-09-24 船长令
 * 「墨潮突击舰添加 A 族洞内电子舰同款网子和冲锋」），而引用它的卡是 **2~4 艘同时上场**
 * （`ink-harass` = 骚扰舰队 ×4）⇒ 多网同场是**常态**、不是边角。
 */
describe('劫掠捕获网 · 多艘同场：打空不算用掉（船长 2026-09-25 报障）', () => {
  /**
   * 起一场「墨潮帮骚扰舰队」（墨潮突击舰 ×4，舰级自带捕获网）＋ 我方 1 艘。
   *
   * ⚠ **双方血量白盒拉满**：本卡是威胁 90 的入侵编成，真打起来我方单舰十几秒就没了、
   * 敌方也会被点掉 ⇒ 走不到"四艘都开过火"那一步（第一版就是这么红的）。拉满后**只有我在用例里
   * 手动清零的那些单位会死**，判据因此完全确定。
   */
  function inkBattle() {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const id = addShipToFleet(state, 'sh-thresher')
    state.shipId = id
    state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
    for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
    const battle = startFleetBattleFor(state, ctx, [id], 'ink-harass', 0)!
    for (const u of Object.values(battle.units)) {
      u.hp = { s: 1e9, a: 1e9, h: 1e9 }
      u.hpMax = { s: 1e9, a: 1e9, h: 1e9 }
    }
    const foes = Object.values(battle.units).filter((u) => u.side === 'foe')
    /**
     * ⚠ **"这一艘开过火没有"只能从 fx 事件看**：`foeShots` 是**战斗级**计数器（`b.stats.foeShots`），
     * 不是逐单位字段（第一版按 `u.foeShots` 判 ⇒ 恒 0、条件永不成立）。
     * 敌舰每一次开火（含张网那条）都会推一条 `side:'foe'` 且带自己 tag 的 fx ⇒ 按 tag 收齐即可。
     */
    const firedFoes = new Set<string>()
    const step = (t: number): void => {
      state.gameMs = t
      advanceBattleFor(state, ctx, battle, id, 'ink-harass')
      for (const f of battle.fx) if (f.side === 'foe' && f.tag) firedFoes.add(f.tag)
    }
    const runUntil = (cond: () => boolean, maxMs = 60_000): boolean => {
      for (let t = 1_000; t <= maxMs; t += 1_000) {
        step(t)
        if (cond()) return true
        if (battle.ended) break
      }
      return cond()
    }
    return { state, battle, id, foes, firedFoes, step, runUntil }
  }

  it('4 艘网船打同一个目标：**只记 1 艘已发放**（改前记 4 艘 = 3 张网白费）', () => {
    const w = inkBattle() // 我方只 1 艘 ⇒ 敌方全体只能瞄准它，4 张网必然全打同一目标
    expect(w.foes.length, '骚扰舰队 = 墨潮突击舰 ×4').toBe(4)
    // 跑到"四艘都开过火"（每艘装填 4 秒 + 入场错峰 ⇒ 30 秒足够）
    w.runUntil(() => w.foes.every((f) => w.firedFoes.has(f.tag)), 30_000)
    expect(w.foes.filter((f) => w.firedFoes.has(f.tag)).length, '四艘都开过火').toBe(4)
    expect(Object.keys(w.battle.meWebDebuffs ?? {}), '只有 1 个目标可钉').toHaveLength(1)
    /**
     * ⚠ **本用例就是报障判据**：改前这里是 4（每艘都在"第一次开火"时被记账，后 3 张静默作废）；
     * 改后只有**真正钉住人**的那 1 艘记账，其余 3 张网留着。
     */
    expect(Object.keys(w.battle.foeWebFired ?? {}).length, '只有真正钉住人的那艘才算发放').toBe(1)
    expect(w.battle.fx.filter((f) => f.web === true).length, '蓝线只应出现 1 条').toBe(1)
  })

  it('保留的网**后来会发**：把首张网的发动者打沉（网解除）⇒ 留着的网在同一个目标上补发', () => {
    const w = inkBattle()
    // ① 跑到第一张网发出
    expect(w.runUntil(() => Object.keys(w.battle.meWebDebuffs ?? {}).length > 0, 30_000), '首张网应发出').toBe(true)
    const pinned = Object.keys(w.battle.meWebDebuffs!)[0]!
    const firstCaster = w.battle.meWebDebuffs![pinned]!.byTag
    expect(Object.keys(w.battle.foeWebFired ?? {}), '此刻只有 1 艘记了发放').toEqual([firstCaster])
    // ② 白盒打沉首张网的发动者 ⇒ 按既有口径"击杀发动者即解除"，目标重新变成**未被捕获**
    w.battle.units[firstCaster]!.hp = { s: 0, a: 0, h: 0 }
    w.runUntil(() => Object.keys(w.battle.meWebDebuffs ?? {}).length === 0, 10_000)
    expect(Object.keys(w.battle.meWebDebuffs ?? {}), '发动者已沉 ⇒ 网解除（既有口径）').toHaveLength(0)
    // ③ 继续跑：**留着的那几张网**应在这个"重新未被捕获"的目标上发出来
    const rePinned = w.runUntil(
      () => Object.entries(w.battle.meWebDebuffs ?? {}).some(([, d]) => d.byTag !== firstCaster),
      30_000,
    )
    expect(rePinned, '保留的网应在（重新）未被捕获的目标上发出来').toBe(true)
    expect(
      Object.keys(w.battle.foeWebFired ?? {}).length,
      '发放数应随"钉到新目标"增加（改前第 2 艘的网早在首发时就作废了、这里恒为 1）',
    ).toBeGreaterThan(1)
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