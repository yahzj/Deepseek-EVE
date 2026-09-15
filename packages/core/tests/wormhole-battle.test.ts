/**
 * **虫洞 · 洞内战斗与收口（F 批 · 2026-09-13）**。
 *
 * 锁住五组口径：
 * ① **敌卡按层派生**：威胁 = 层曲线（普通节点 / BOSS ×1.2 / 撤离战 ×0.8）；舰级绝对值按比例缩放；
 *    波数把同一编成摊成 N 波（**总战力守恒**）；**选靶模式**随用途分流（BOSS = 打最大的）；
 * ② **开战**：`run.battle` 宿主 + `battle.wormhole` 标记（逐拍同源重建）+ 4 舰编队；
 * ③ **收口 · 胜**：节点战 ⇒ 自动结算该节点（扣回合、推进）；层末守卫 ⇒ 记 `bossCleared` 后放行深入/撤离；
 *    撤离战 ⇒ **收益入港**（背包并入仓库）并结束本趟；
 * ④ **收口 · 负**（= 我方全灭，D 批口径）：**全损**——编队全丢、背包清空；
 * ⑤ **门与句柄**：战斗中不许推进/深入/撤离；层末守卫未清不许深入/撤离；
 * ⑥ **后勤尾巴与远征同源**：未打出去的弹药/修理组件退回仓库、**机群战损真扣清单**、
 *    战报带上船体维修装置消耗（2026-09-13 修：首版全漏 ⇒ 洞内无人机打不死、连打第二场全队哑火）。
 *
 * ✅ 2026-09-14 船长解除不可见：入口常驻、数据全部上线、公开就叫「虫洞」。
 * ⚠ 本文件不产生任何玩家可见文案。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { addShipToFleet, pilotUnavailableReason } from '../src/shipyard'
import { addWare, countWare } from '../src/inventory'
import { advanceBattleFor, battleOpenM, createFoeSpecs, createPlayerSpec, desiredRangeFor, foeDesiredRange, foeHpOfThreat, foeShipTierOf, foeUnitNameOf, startFleetBattleFor, wormholeDerivedAnomaly } from '../src/combat'
import { battleTacticDesire } from '../src/expedition'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import {
  WORMHOLE_BOSS_TARGETING_CHANCE,
  WORMHOLE_CARD_TIERS,
  WORMHOLE_DISPLAY_THREAT_MUL,
  WORMHOLE_FAMILY_ORDER,
  WORMHOLE_FAMILY_TARGETING,
  WORMHOLE_FAMILY_TARGETING_CHANCE,
  WORMHOLE_FOE_CARD_IDS,
  WORMHOLE_ORE_ITEM_ID,
  WORMHOLE_TEMP_CELLS,
  WORMHOLE_TEMP_COLS,
  WORMHOLE_TIER_HP_MUL,
  WORMHOLE_TIER_UNLOCK_DEPTH,
  wormholeAllCardIds,
  wormholeAnomalyOf,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeCardIdForRun,
  wormholeCardIdOfFamily,
  wormholeCardOfTier,
  wormholeCardPoolAt,
  wormholeDescend,
  wormholeDisplayThreat,
  wormholeEnter,
  wormholeExtract,
  wormholeExtractThreat,
  wormholeFleetCargoM3,
  wormholeFoeThreat,
  wormholeGuardCardOf,
  wormholeLayerThreat,
  wormholeNaturalHp,
  wormholeTierOfCard,
} from '../src/wormhole'
import { advanceWormhole, battleFoeAnomaly, wormholeActivateAt, wormholeBattleViewOf, wormholeStartBattle, wormholeTravelTo } from '../src/wormholeBattle'
import type { WormholeRunState } from '../src/wormhole'
import type { WormholePlace } from '../src/wormholeGrid'
import { gridContentIndex, hexDistance } from '../src/wormholeGrid'
import { rareWreckItemIdOf, wreckItemIdOf } from '../src/salvage'
import {
  WORMHOLE_ESSENCE_ITEM_ID,
  wormholeDiscardToFit,
  wormholeHoldOverloaded,
  wormholeHoldStow,
  wormholeHoldUsage,
  wormholeOverloadBlockReason,
  wormholeHoldSyncCargo,
  wormholeTempUsage,
  wormholeRelicBoxIdOf,
} from '../src/wormholeSalvage'
import { holdTransferTo, makeHoldState } from '../src/wormholeHold'
import { WORMHOLE_MATTER_DEVICE_IDS } from '../src/wormholeMatter'

const ctx = buildSimContext()
const T3 = 'sh-thresher'

function fresh(seed = 21): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

/** 起一趟（2×T3 = 7,000 质量 ⇒ 76 回合），并返回状态 */
function enterRun(seed = 21): GameState {
  const state = fresh(seed)
  const a = addShipToFleet(state, T3)
  const b = addShipToFleet(state, T3)
  state.shipId = a
  const r = wormholeEnter(state, ctx, [a, b], seed)
  expect(r.ok).toBe(true)
  return state
}

/** 把场上敌人打光并判我方胜（不动我方血量） */
function winBattle(state: GameState): void {
  const battle = state.wormhole.run!.battle!
  for (const u of Object.values(battle.units)) {
    if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
  }
  battle.ended = 'me'
}

/**
 * **把玩家挪到指定地点的格上**（F3a-2 起：地点效果由**激活**触发，不再是线性节点）。
 * 等价于旧用例里的 `run.pendingNode = { kind: … }`：直接改当前格的真相，省掉"扫/走"的铺垫。
 */
function standOnPlace(run: WormholeRunState, place: WormholePlace): string {
  const g = run.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = place
  g.activated = g.activated.filter((k) => k !== cell.key)
  return cell.key
}

/** 把玩家挪到"下一层入口"那一格（层末守卫守在入口上：站上去激活才开打） */
function standAtExit(run: WormholeRunState): string {
  const g = run.grid!
  g.pos = { q: g.exit.q, r: g.exit.r }
  const key = `${g.exit.q},${g.exit.r}`
  if (!g.visited.includes(key)) g.visited.push(key)
  if (!g.scanned.includes(key)) g.scanned.push(key)
  g.activated = g.activated.filter((k) => k !== key)
  return key
}

/**
 * **收口一场已分胜负的战斗**：跳过「击杀慢镜」窗口（与远征 `bal.killcamMs` 同源）再推进。
 * 引擎在 `ended` 之后**延迟结算**——为的是让战斗界面把最后一击/爆炸演出播完
 * （首版实测：不延迟的话战斗界面会在结束那一瞬间直接卸载，战报窗口没机会播）。
 */
function settleBattle(state: GameState): void {
  const b = state.wormhole.run?.battle
  if (b) state.gameMs = b.lastTickGameMs + 10_000
  advanceWormhole(state, ctx)
}

describe('虫洞 · 洞内敌卡按层派生（F 批）', () => {
  it('威胁随用途分流：普通节点 = 层威胁 · BOSS ×1.2 · 撤离战 = **线性**（船长 2026-09-13 改判）', () => {
    expect(wormholeLayerThreat(1)).toBe(45)
    expect(wormholeFoeThreat(1, 'node')).toBe(45)
    expect(wormholeFoeThreat(1, 'boss')).toBe(54) // 45 × 1.2
    expect(wormholeFoeThreat(3, 'node')).toBe(wormholeLayerThreat(3))
    expect(wormholeFoeThreat(3, 'boss')).toBe(Math.round(wormholeLayerThreat(3) * 1.2))
    // **撤离战：线性**（层 2 = 42，每层 +7）——层 2/3 与改判前的读数相同，之后逐层低于等比
    expect(wormholeFoeThreat(2, 'extract')).toBe(42)
    expect(wormholeFoeThreat(3, 'extract')).toBe(49)
    expect(wormholeFoeThreat(4, 'extract')).toBe(56)
    expect(wormholeFoeThreat(8, 'extract')).toBe(84)
    expect(wormholeExtractThreat(12)).toBe(112)
    // 等差（不是等比）：任意相邻两层之差恒为 7
    for (let d = 2; d <= 14; d++) {
      expect(wormholeExtractThreat(d + 1) - wormholeExtractThreat(d)).toBe(7)
    }
    // 且**深层明显低于**等比口径（等比层 8 = 102）：撤离战不该比同层节点战更陡
    expect(wormholeExtractThreat(8)).toBeLessThan(Math.round(wormholeLayerThreat(8) * 0.8))
  })

  it('敌卡按「族锁 + 层档位池」确定抽取：层 1 只浅 / 层 2~3 中2:浅1 / 层 4+ 深2:中1:浅1；守卫取最深已解锁档', () => {
    const weightsOf = (depth: number): Record<string, number> =>
      Object.fromEntries(wormholeCardPoolAt('A', depth).map((e) => [e.tier, e.weight]))
    // 船长 2026-09-15：「层 2~3出场抽取按照2:1抽。层4+出场抽取按照2:1：1抽」
    expect(weightsOf(1)).toEqual({ shallow: 1 })
    expect(weightsOf(2)).toEqual({ shallow: 1, mid: 2 })
    expect(weightsOf(3)).toEqual({ shallow: 1, mid: 2 })
    expect(weightsOf(4)).toEqual({ shallow: 1, mid: 1, deep: 2 })
    expect(weightsOf(9)).toEqual({ shallow: 1, mid: 1, deep: 2 })
    // 出场层（船长：「浅层中层深层分别定为 1/2/4 层开始出现」）
    expect(WORMHOLE_TIER_UNLOCK_DEPTH).toEqual({ shallow: 1, mid: 2, deep: 4 })
    // 层末守卫 = 该层最深已解锁档
    expect(wormholeCardIdForRun({ family: 'A', seed: 7, depth: 1, kind: 'boss' })).toBe('wh-pirate-scout')
    expect(wormholeCardIdForRun({ family: 'A', seed: 7, depth: 3, kind: 'boss' })).toBe('wh-pirate-hunt')
    expect(wormholeCardIdForRun({ family: 'A', seed: 7, depth: 4, kind: 'boss' })).toBe('wh-pirate-warband')
    // 节点抽取：只出该层池内的卡、同 (种子,层,序号) 恒同、深层三档都见过
    const seenAt4 = new Set<string>()
    for (let d = 1; d <= 8; d++) {
      for (let i = 0; i < 8; i++) {
        for (const seed of [1, 2, 3, 11, 97]) {
          const spec = { family: 'A' as const, seed, depth: d, kind: 'node' as const, nodeIndex: i }
          const id = wormholeCardIdForRun(spec)
          expect(wormholeCardIdForRun(spec)).toBe(id) // 确定性
          expect(wormholeCardPoolAt('A', d).map((e) => e.id)).toContain(id)
          if (d >= 4) seenAt4.add(id)
        }
      }
    }
    expect([...seenAt4].sort()).toEqual(['wh-pirate-hunt', 'wh-pirate-scout', 'wh-pirate-warband'])
    // 层 1 绝不会撞上中/深层编成
    for (let i = 0; i < 8; i++) {
      for (const seed of [1, 5, 9]) {
        expect(wormholeCardIdForRun({ family: 'A', seed, depth: 1, kind: 'node', nodeIndex: i })).toBe(
          'wh-pirate-scout',
        )
      }
    }
  })

  it('十五张齐备：五族各三档都在池里；守卫取该层最深已解锁档（缺档兜底转为防御性代码）', () => {
    // 2026-09-15 批 5 收口后**五族三档齐备** ⇒ 层 5 的池一律三档俱全
    for (const f of WORMHOLE_FAMILY_ORDER) {
      expect(wormholeCardPoolAt(f, 5).map((e) => e.tier), `族 ${f}`).toEqual(['shallow', 'mid', 'deep'])
      expect(wormholeCardOfTier(f, 'shallow'), `族 ${f} 缺浅层卡`).toBeTruthy()
      expect(wormholeCardOfTier(f, 'mid'), `族 ${f} 缺中层卡`).toBeTruthy()
      expect(wormholeCardOfTier(f, 'deep'), `族 ${f} 缺深层卡`).toBeTruthy()
    }
    expect(WORMHOLE_FOE_CARD_IDS).toHaveLength(15)
    expect(wormholeAllCardIds()).toHaveLength(15)
    // 守卫取档：层 1 → 浅 / 层 2~3 → 中 / 层 4+ → 深（逐族同口径）
    for (const f of WORMHOLE_FAMILY_ORDER) {
      expect(wormholeGuardCardOf(f, 1)).toBe(wormholeCardOfTier(f, 'shallow'))
      expect(wormholeGuardCardOf(f, 3)).toBe(wormholeCardOfTier(f, 'mid'))
      expect(wormholeGuardCardOf(f, 9)).toBe(wormholeCardOfTier(f, 'deep'))
    }
    /**
     * ⚠ **缺档兜底分支**（`wormholeCardPoolAt` 里"全缺 ⇒ 退回现有最深一张"）自批 5 起**数据上不可达**，
     * 但**代码保留**：它是分批上线期间的救命路径，也是日后新增族/新档时的兜底——若哪天有人把某档
     * 写回 `null`，上面三条 not-null 断言会立刻红，提醒"池会静默退化"，不会静默出事。
     */
    expect(wormholeCardPoolAt('G', 1).map((e) => e.tier)).toEqual(['shallow'])
  })

  it('面板威胁是**显示口径 ×2**（船长 2026-09-15「玩家会因为 1 层的 50 威胁误判」），引擎威胁一字不动', () => {
    // 显示口径：×2 取整（1 层面板显示 90，而不是 45）
    expect(WORMHOLE_DISPLAY_THREAT_MUL).toBe(2)
    expect(wormholeDisplayThreat(45)).toBe(90)
    expect(wormholeDisplayThreat(52)).toBe(104)
    expect(wormholeDisplayThreat(54)).toBe(108)
    expect(wormholeDisplayThreat(42)).toBe(84)
    /**
     * ⚠ **零漂移守卫**：显示倍率**绝不许**渗进引擎 —— 引擎的 `threat` 是血预算的输入
     * （`foeHpOfThreat(威胁) × 10`）⇒ 一旦被乘 2，敌人血量会整体翻倍（那是难度改动、不是显示改动）。
     * 判据用**真数据**：层曲线 / 用途取值 / 派生卡面 threat 三处都必须还是原值。
     */
    expect(wormholeLayerThreat(1)).toBe(45)
    expect(wormholeFoeThreat(1, 'node')).toBe(45)
    expect(wormholeFoeThreat(1, 'boss')).toBe(54)
    expect(wormholeFoeThreat(2, 'extract')).toBe(42)
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const derived = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    expect(derived.threat).toBe(45) // 派生卡面照旧（血预算就按它算）
  })

  it('C 族深层卡（孢群巢穴）：无人机舰 —— 机群吃掉 60% 火力、机型是 C 族孢群机', () => {
    const card = ctx.anomalies.get('wh-alien-hive')!
    const derived = wormholeDerivedAnomaly(ctx, card, { depth: 6, kind: 'node', waves: 1 })
    const specs = createFoeSpecs(derived, ctx.balance.battle)
    const hive = specs.find((s) => s.name.includes('孢群异虫'))
    expect(hive, '深层卡里应有「孢群异虫」').toBeTruthy()
    const gun = hive!.weapons.filter((w) => w.src !== 'drone').reduce((n, w) => n + (w.shotDmg ?? 0), 0)
    const drones = hive!.weapons.filter((w) => w.src === 'drone')
    const droneSum = drones.reduce((n, w) => n + (w.shotDmg ?? 0), 0)
    expect(drones).toHaveLength(3) // 孢群机 ×3（船长「释放蜂群机」）
    expect(drones[0]!.artId).toBe('foe-drone-c-spore') // 机型必须同族（契约：不许串族）
    // A5 守恒：`droneFireShare 0.6` ⇒ 机群拿六成、炮台只剩四成（取整余量内）
    const share = droneSum / (gun + droneSum)
    expect(share).toBeGreaterThan(0.55)
    expect(share).toBeLessThan(0.65)
  })

  it('族表 / 卡 id 清单 / 目录三处一致：每张卡恰属一族一档、不串族、浅层五张仍是旧 id', () => {
    const listed = new Set(WORMHOLE_FOE_CARD_IDS)
    const tiered = wormholeAllCardIds()
    expect(new Set(tiered)).toEqual(listed) // 两张表同集合（少一张/多一张都算漂移）
    expect(tiered.length).toBe(listed.size) // 同一张卡不得占两个档位
    let count = 0
    for (const f of WORMHOLE_FAMILY_ORDER) {
      for (const t of WORMHOLE_CARD_TIERS) {
        const id = wormholeCardOfTier(f, t)
        if (id === null) continue
        count++
        const card = ctx.anomalies.get(id)
        expect(card, `目录里没有洞内敌卡 ${id}`).toBeTruthy()
        expect(card!.hidden).toBe(true) // 不进悬赏目录
        expect(String(card!.foeFamily), `${id} 的族`).toBe(f)
        expect((card!.ships ?? []).length).toBeGreaterThan(0) // 舰级路径
        expect(wormholeTierOfCard(id), `${id} 的档位`).toBe(t)
        // **选靶按族限定**（船长 2026-09-15）：模式与概率都必须等于族定值
        expect(card!.foeTargeting ?? 'random', `${id} 的选靶模式`).toBe(WORMHOLE_FAMILY_TARGETING[f])
        if (WORMHOLE_FAMILY_TARGETING[f] === 'random') {
          expect(card!.foeTargetingChance, `${id} 随机模式不该写概率`).toBeUndefined()
        } else {
          expect(card!.foeTargetingChance, `${id} 的选靶概率`).toBe(WORMHOLE_FAMILY_TARGETING_CHANCE)
        }
      }
    }
    expect(count).toBe(tiered.length)
    // 五族齐 ⇒ 按族掉落池"每族都有来源"（船长 2026-09-13）
    expect([...WORMHOLE_FAMILY_ORDER].sort()).toEqual(['A', 'C', 'D', 'E', 'G'])
    // 浅层五张 = 2026-09-13 的旧 id（老档零迁移的锚：存档里进行中的战斗用的就是它们）
    expect(WORMHOLE_CARD_TIERS.map((t) => wormholeCardOfTier('A', t))).toEqual([
      'wh-pirate-scout',
      'wh-pirate-hunt',
      'wh-pirate-warband',
    ])
    expect(['wh-alien-swarm', 'wh-grave-watch', 'wh-exile-blockade', 'wh-titan-echo'].every((id) => listed.has(id))).toBe(
      true,
    )
  })

  it('分层血量修正：中 ×1.1 / 深 ×1.2，**只加血不加火力**（同层同档总血恒等）', () => {
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const natural = wormholeNaturalHp(base)
    const shallow = wormholeAnomalyOf(base, 4, 'node', 1, { hpBudget: natural * 3 })
    const mid = wormholeAnomalyOf(base, 4, 'node', 1, { hpBudget: natural * 3, hpScaleMul: WORMHOLE_TIER_HP_MUL.mid })
    const deep = wormholeAnomalyOf(base, 4, 'node', 1, { hpBudget: natural * 3, hpScaleMul: WORMHOLE_TIER_HP_MUL.deep })
    expect(wormholeNaturalHp(shallow)).toBeCloseTo(natural * 3, 3)
    expect(wormholeNaturalHp(mid)).toBeCloseTo(natural * 3 * 1.1, 3)
    expect(wormholeNaturalHp(deep)).toBeCloseTo(natural * 3 * 1.2, 3)
    // 单发缩放（= dmgMul）不随分层修正变：只加血、不加火力
    const dmgScale = (a: ReturnType<typeof wormholeAnomalyOf>): number => a.ships?.[0]?.dmgMul ?? 1
    expect(dmgScale(mid)).toBeCloseTo(dmgScale(shallow), 9)
    expect(dmgScale(deep)).toBeCloseTo(dmgScale(shallow), 9)
    expect(WORMHOLE_TIER_HP_MUL).toEqual({ shallow: 1, mid: 1.1, deep: 1.2 })
  })

  it('引擎按卡 id 反查档位：同层同用途下，中层卡总血 = 浅层 ×1.1、深层 = 浅层 ×1.2（火力口径不变）', () => {
    const cards = WORMHOLE_CARD_TIERS.map((t) => ctx.anomalies.get(wormholeCardOfTier('A', t)!)!)
    const totalAt = (card: (typeof cards)[number]): number =>
      wormholeNaturalHp(wormholeDerivedAnomaly(ctx, card, { depth: 4, kind: 'node', waves: 1 }))
    const shallow = totalAt(cards[0]!)
    // 按卡归一后：总血 = 该层预算 × 档位系数 ⇒ 卡间差异只剩档位（同层同档恒等）
    expect(totalAt(cards[1]!) / shallow).toBeCloseTo(1.1, 3)
    expect(totalAt(cards[2]!) / shallow).toBeCloseTo(1.2, 3)
  })

  it('派生：威胁换成目标值、**总血压到该层预算**（按卡归一）；**波数摊薄但总战力守恒**', () => {
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const naturalHp = wormholeNaturalHp(base)
    const one = wormholeAnomalyOf(base, 1, 'node', 1, { hpBudget: naturalHp * 2 })
    expect(one.threat).toBe(45)
    // 目标总血 = 预算（**按卡归一**：卡间的坦克/脆皮差异不再影响"威胁 = 战力标尺"）
    expect(wormholeNaturalHp(one)).toBeCloseTo(naturalHp * 2, 3)
    // 波数摊薄：同一预算摊成两波 ⇒ 条数翻倍、每条半血、**总血不变**
    const two = wormholeAnomalyOf(base, 1, 'node', 2, { hpBudget: naturalHp * 2 })
    expect(wormholeNaturalHp(two)).toBeCloseTo(naturalHp * 2, 3)
    expect((two.ships ?? []).length).toBe((one.ships ?? []).length * 2)
    expect(two.waves?.length).toBe(2)
    // 深层：预算由引擎按层算（`foeHpOfThreat(威胁) × 系数`）⇒ 这里给更大预算即代表更深一层
    const deep = wormholeAnomalyOf(base, 4, 'node', 1, { hpBudget: naturalHp * 3 })
    expect(deep.threat).toBe(wormholeLayerThreat(4))
    expect(wormholeNaturalHp(deep)).toBeCloseTo(naturalHp * 3, 3)
    // 不给预算（纯展示/校准口径）：只换威胁字段，条目保持自然值
    const bare = wormholeAnomalyOf(base, 4, 'node', 1)
    expect(bare.threat).toBe(wormholeLayerThreat(4))
    expect(wormholeNaturalHp(bare)).toBeCloseTo(naturalHp, 3)
  })

  it('选靶模式随用途分流：普通节点用卡上模式、**BOSS 一律打最大的**', () => {
    const pirate = ctx.anomalies.get('wh-pirate-scout')!
    const alien = ctx.anomalies.get('wh-alien-swarm')!
    const grave = ctx.anomalies.get('wh-grave-watch')!
    const exile = ctx.anomalies.get('wh-exile-blockade')!
    expect(wormholeAnomalyOf(pirate, 1, 'node', 1).foeTargeting).toBe('noncombat')
    expect(wormholeAnomalyOf(alien, 1, 'node', 1).foeTargeting).toBe('smallest')
    expect(wormholeAnomalyOf(grave, 1, 'node', 1).foeTargeting).toBe('top-output')
    expect(wormholeAnomalyOf(exile, 1, 'node', 1).foeTargeting).toBe('random')
    for (const card of [pirate, alien, grave, exile]) {
      expect(wormholeAnomalyOf(card, 2, 'boss', 1).foeTargeting).toBe('largest')
    }
  })

  /**
   * **选靶倾向概率**（船长 2026-09-14：「虫洞敌人的攻击倾向，加一个概率」→ 先定 60%、
   * 同日二次改判「**概率降为40%试一下**」）：写了模式的三张卡各挂 **0.4**；BOSS 的模式虽被 core
   * 改成「打最大的」，概率同样 **0.4**（同一条裁定）；随机模式的 G 卡 / E 卡**不写**该字段
   * ⇒ 派生结果 = 1（不掷骰，行为与上线时逐字一致）。
   */
  it('选靶倾向概率：写了模式的卡 0.4 · BOSS 也 0.4 · 随机模式的卡不写（= 1）', () => {
    const pirate = ctx.anomalies.get('wh-pirate-scout')!
    const grave = ctx.anomalies.get('wh-grave-watch')!
    const exile = ctx.anomalies.get('wh-exile-blockade')!
    const titan = ctx.anomalies.get('wh-titan-echo')!
    expect(pirate.foeTargetingChance).toBe(0.4)
    expect(grave.foeTargetingChance).toBe(0.4)
    expect(exile.foeTargetingChance).toBeUndefined()
    expect(titan.foeTargetingChance).toBeUndefined()
    // 派生：普通节点 / 撤离战 = 卡上概率；BOSS = core 常量（同样 0.4，模式仍是"打最大的"）
    expect(wormholeAnomalyOf(pirate, 3, 'node', 1).foeTargetingChance).toBe(0.4)
    expect(wormholeAnomalyOf(pirate, 3, 'extract', 1).foeTargetingChance).toBe(0.4)
    expect(wormholeAnomalyOf(pirate, 3, 'boss', 1).foeTargetingChance).toBe(WORMHOLE_BOSS_TARGETING_CHANCE)
    expect(WORMHOLE_BOSS_TARGETING_CHANCE).toBe(0.4)
    // 随机模式的卡：派生结果 = 1 ⇒ 连一次倾向骰都不掷（洞外与 G/E 卡的零漂移守卫）
    expect(wormholeAnomalyOf(exile, 3, 'node', 1).foeTargetingChance).toBe(1)
    expect(wormholeAnomalyOf(titan, 3, 'node', 1).foeTargetingChance).toBe(1)
  })

  it('派生卡能真实建档（舰级路径）：波次数量与槽位分组一致', () => {
    const base = ctx.anomalies.get('wh-grave-watch')!
    const card = wormholeAnomalyOf(base, 3, 'node', 2)
    const w0 = createFoeSpecs(card, ctx.balance.battle, { tagPrefix: '' })
    const w1 = createFoeSpecs(card, ctx.balance.battle, { tagPrefix: 'w1-' })
    expect(w0.length).toBeGreaterThan(0)
    expect(w1.length).toBeGreaterThan(0)
    expect(w0.length).toBe(w1.length) // 同一编成分波 ⇒ 每波条数相同
  })
})

describe('虫洞 · 开战（F 批）', () => {
  it('地点战可开战：宿主在 run.battle、带 wormhole 标记、我方 4 单位路径生效', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    const r = wormholeStartBattle(state, ctx, 'node', 0)
    expect(r.ok).toBe(true)
    const battle = run.battle!
    /**
     * 敌卡 = **本趟锁定的族**（船长 2026-09-14 定案 · 丁：一处虫洞一族、整趟同族）。
     * 本用例的 run 没写 `family`（老档口径）⇒ 按 `run.seed` 现算，与 `wormholeCardIdOfFamily` 同源。
     */
    expect(battle.wormhole).toEqual({
      cardId: wormholeCardIdOfFamily(run.family, run.seed),
      depth: 1,
      kind: 'node',
      waves: 1,
    })
    expect(battle.myFleet?.length).toBe(2) // 两艘都在（主控置首）
    expect(battle.hullEscapeFrac).toBeUndefined() // 副本内无"结构过半自动脱离"
    // 敌卡已按层派生：威胁 45 的卡（网格层的地点战不分波）
    expect(battle.waveIdx ?? 0).toBe(0)
    const foes = Object.values(battle.units).filter((u) => u.side === 'foe')
    expect(foes.length).toBeGreaterThan(0)
    // 同一战斗不能重复开
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(false)
  })

  it('非交火地点开不了战（网格层：战斗只由「舰船信号」地点触发）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'vein') // 矿脉：不是交火地点
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(false)
    expect(run.battle ?? null).toBeNull()
  })

  it('战术期望距离（洞内）：三档都给**非零**距离，且走洞内中段口径（2026-09-14 修"点战术=整队贴脸"）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    // 主视角 = 编队首舰（与 `setBattleDesire` 同一口径）
    const me = createPlayerSpec(state, ctx, run.fleet[0]!)!
    const bal = ctx.balance.battle
    for (const t of ['assault', 'mid', 'kite'] as const) {
      const v = battleTacticDesire(state, ctx, t)
      // 旧实现在洞内取不到敌卡（只认 expedition.anomalyId）⇒ **恒返回 0** ⇒ 战场里点战术按钮会把
      // 期望距离设成 0、被 `setBattleDesire` 钳到最近 = 整队贴脸（船长报障"开始位置似乎不对"的连带）
      expect(v, `洞内 ${t} 战术期望距离不该是 0`).toBeGreaterThan(0)
      expect(v, `洞内 ${t} 走默认档（与星图同值）`).toBe(desiredRangeFor(me, t, bal))
    }
    // 取消分档的证据：洞内「中距」= 星图「中距」= `desireBandMid`（0.8 高位）
    expect(battleTacticDesire(state, ctx, 'mid')).toBe(
      desiredRangeFor(me, 'mid', bal, bal.desireBandMid),
    )
    // 显式传一张不存在的卡 ⇒ 仍返回 0（保底分支没被改坏）
    expect(battleTacticDesire(state, ctx, 'mid', 'ano-not-exist')).toBe(0)
  })

  it('敌卡取值单点 `battleFoeAnomaly`：洞内 = 按层派生卡（族形/舰种档都查得到）· 洞外 = 远征卡', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const card = battleFoeAnomaly(state, ctx)
    expect(card, '洞内交火时必须给得出敌卡').toBeTruthy()
    // 与开战记录同一张卡（派生卡保住 id 与族：视图据 `foeFamily` 选敌族图形/动画、据舰种档定体积）
    expect(card!.id).toBe(run.battle!.wormhole!.cardId)
    const base = ctx.anomalies.get(run.battle!.wormhole!.cardId)!
    expect(card!.foeFamily).toBe(base.foeFamily)
    expect(card!.foeFamily, '敌族必须显式登记（不许落到兜底）').toBeTruthy()
    // 视图的两处查询在洞内真的能取到值（旧口径下都是 undefined ⇒ 兜底族 A + 体积 170/90）
    const foeTag = Object.values(run.battle!.units).find((u) => u.side === 'foe')!.tag
    expect(foeShipTierOf(card!, foeTag), '舰种档可解析（体积阶梯）').toBeGreaterThan(0)
    expect(foeUnitNameOf(card!, foeTag), '敌舰名可解析').not.toBe('')
    // 反证：把洞内战摘掉（等价旧口径"只认远征"）⇒ 拿不到卡
    const noWh: GameState = { ...state, wormhole: { ...state.wormhole, run: null } }
    expect(battleFoeAnomaly(noWh, ctx)).toBeUndefined()
    // 洞外口径逐字不变：远征卡照给
    const exp: GameState = { ...state, expedition: { ...state.expedition, anomalyId: base.id } }
    expect(battleFoeAnomaly(exp, ctx)?.id).toBe(base.id)
  })

  it('战斗中：推进 / 深入 / 撤离一律被拒（船长第 8 条）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    expect(wormholeExtract(run).ok).toBe(false)
    expect(wormholeDescend(state, 21).ok).toBe(false)
    expect(run.phase).toBe('inside')
  })

  it('层末守卫守在**下一层入口**上：没站上入口开不了，打完才放行深入/撤离', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    expect(wormholeStartBattle(state, ctx, 'boss', 0).ok).toBe(false) // 没站在入口格上
    expect(wormholeDescend(state, 21).ok).toBe(false) // 守卫没清
    standAtExit(run)
    expect(wormholeStartBattle(state, ctx, 'boss', 0).ok).toBe(true)
    winBattle(state)
    settleBattle(state)
    expect(run.bossCleared).toBe(1)
    expect(run.battle).toBeNull()
    expect(wormholeDescend(state, 21).ok).toBe(true)
    expect(run.depth).toBe(2)
  })
})

describe('虫洞 · 战斗收口（F 批）', () => {
  it('**胜 · 地点战**：回合在"激活地点"那一步已扣；收口不再重复扣、地点留在已处理', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const key = standOnPlace(run, 'ship')
    const turnsBefore = run.turnsLeft
    const act = wormholeActivateAt(state, ctx)
    expect(act.ok).toBe(true)
    expect(act.started).toBe('node') // 激活"舰船信号" ⇒ 立刻开战（不用界面再点一次）
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 激活那一步就扣了回合
    expect(run.battle).not.toBeNull()
    winBattle(state)
    settleBattle(state)
    expect(run.battle).toBeNull()
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 收口不重复扣费
    expect(run.grid!.activated).toContain(key)
  })

  it('**到达即开打**（船长 2026-09-13）：走到舰船信号那一格就地交火，只花「前往」那 1 回合', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const g = run.grid!
    const target = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}` && hexDistance(c, g.pos) === 1)!
    target.place = 'ship'
    g.scanned.push(target.key)
    const turnsBefore = run.turnsLeft
    const r = wormholeTravelTo(state, ctx, { q: target.q, r: target.r })
    expect(r.ok).toBe(true)
    expect(r.autoBattle).toBe(true)
    expect(run.battle).not.toBeNull()
    expect(run.battle!.wormhole?.kind).toBe('node')
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 到达即开打 ⇒ 没有第二次「激活」扣费
    winBattle(state)
    settleBattle(state)
    expect(run.battle).toBeNull()
    expect(run.turnsLeft).toBe(turnsBefore - 1) // 收口也不重复扣
  })

  it('开战起不来（编队被掏空）⇒ **整趟移动回滚**：人留在原格、回合不丢、地点没被记成已处理', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const g = run.grid!
    const target = g.cells.find((c) => c.key !== `${g.pos.q},${g.pos.r}` && hexDistance(c, g.pos) === 1)!
    target.place = 'ship'
    g.scanned.push(target.key)
    const posBefore = { ...g.pos }
    const turnsBefore = run.turnsLeft
    run.fleet = [] // `startFleetBattleFor` 建不出战斗
    const r = wormholeTravelTo(state, ctx, { q: target.q, r: target.r })
    expect(r.ok).toBe(false)
    expect(g.pos).toEqual(posBefore)
    expect(run.turnsLeft).toBe(turnsBefore)
    expect(g.visited).not.toContain(target.key)
    expect(g.activated).not.toContain(target.key)
    expect(run.battle ?? null).toBeNull()
  })

  it('**激活入口格 ⇒ 层末守卫战**（网格层的"打完才放行"落点）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standAtExit(run)
    const act = wormholeActivateAt(state, ctx)
    expect(act.ok).toBe(true)
    expect(act.effect?.kind).toBe('exit')
    expect(act.started).toBe('boss')
    expect(run.battle!.wormhole?.kind).toBe('boss')
    winBattle(state)
    settleBattle(state)
    expect(run.bossCleared).toBe(1)
    expect(wormholeDescend(state, 21).ok).toBe(true)
  })

  it('**撤离 = 下一拍直接入港**（2026-09-15 船长取消撤离战）：不再开战、结算单不带 skippedExtractBattle', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.depth = 2 // 旧口径"第 2 层起才有撤离战"——现行口径深浅同待遇，这里特意站在第 2 层验证
    run.bossCleared = run.depth
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 500 }]
    const before = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeExtract(run).ok).toBe(true)
    expect(run.phase).toBe('extracting')
    // ⚠ 关键差异：下一拍**不再开战**，直接结算入港
    advanceWormhole(state, ctx)
    expect(run.battle ?? null).toBeNull()
    expect(state.wormhole.run).toBeNull() // 本趟结束
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(before + 500) // 收益入港
    // **结算单**（界面弹层用）：收益写进来、没有损失、不再带"免战"标记
    const st = state.wormhole.lastSettle!
    expect(st.kind).toBe('extract')
    expect(st.depth).toBe(2)
    expect(st.oreUnits).toBe(500)
    expect(st.oreIsk).toBe(500 * (ctx.items.get(WORMHOLE_ORE_ITEM_ID)?.baseSellPriceIsk ?? 0))
    expect(st.shipsLost).toEqual([])
    expect(st.lostIsk).toBe(0)
    expect(st.skippedExtractBattle).toBeUndefined()
  })

  it('**老档照打完**：存档里已经在打的撤离战仍能收口（赢了入港、不出错）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 300 }]
    expect(wormholeExtract(run).ok).toBe(true)
    /**
     * **手工造一场"老档遗留的撤离战"**：新口径下 `wormholeStartBattle` 已不接受 `'extract'`
     * （类型与实现都不再产生它），所以这里**照 2026-09-15 之前的建档路径**重建那一场
     * （`wormholeCardIdForRun` 取撤离战敌卡 → `startFleetBattleFor` 建战斗 → 挂到 `run.battle`），
     * 正是老档读档后的形状。
     */
    const cardId = wormholeCardIdForRun({ family: run.family, seed: run.seed, depth: run.depth, kind: 'extract', nodeIndex: 0 })
    const battle = startFleetBattleFor(state, ctx, run.fleet, cardId, state.gameMs, null, {
      depth: run.depth,
      kind: 'extract',
      waves: 1,
    })
    expect(battle).not.toBeNull()
    run.battle = battle!
    const before = countWare(state, WORMHOLE_ORE_ITEM_ID)
    winBattle(state)
    settleBattle(state)
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(before + 300) // 打赢 ⇒ 收益入港
    expect(state.wormhole.run).toBeNull()
    expect(state.wormhole.lastSettle!.kind).toBe('extract')
  })

  /**
   * **形状件（遗迹安全货柜）随趟带回**——⚠ 这条是 2026-09-13 修掉的**真 BUG**：
   * 货柜走 `run.hold.placements`（不在 `run.bag`），而撤离结算只扫 `run.bag` 与 `run.relics`
   * ⇒ 打捞到的货柜会在"撤离成功"那一刻**静默消失**，"带回后精炼炉拆解"永远发生不了。
   */
  it('**撤离：货仓里的货柜也进仓库**（不是只有散货入港）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.depth = 2
    run.bossCleared = run.depth
    // 直接用「装舱」入位（等价从格上拾取）：**2026-09-15 起安全货柜占 3×2 = 6 格** ⇒ 先清掉散货腾出整块空位
    const family = String(ctx.anomalies.get(wormholeCardIdForRun({ family: run.family, seed: run.seed, depth: run.depth, kind: 'node', nodeIndex: 0 }))?.foeFamily ?? 'A')
    // ⚠ 2026-09-15：安全货柜 4 格 → **6 格（3×2）**，而本夹具的货仓容量 < 6 格 ⇒ 改用同批新增的
    //   **军用备货柜**（正好 2×2 = 4 格）验同一条链；安全货柜 6 格那条另有用例（形状表 / 货仓用例）。
    const boxId = family ? 'box-military' : 'box-military'
    expect(wormholeHoldStow(state, ctx, boxId).ok).toBe(true)
    expect(countWare(state, boxId)).toBe(0)
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx) // 2026-09-15 起：撤离下一拍直接入港（不再有战斗）
    expect(countWare(state, boxId)).toBe(1) // **货柜真的到港了**
    expect(state.wormhole.run).toBeNull()
    expect(state.wormhole.lastSettle!.boxes).toEqual([boxId]) // 结算单里也报出这件货柜
  })

  /**
   * **谜质装置 ⇒ 虫洞谜质**（2026-09-15 船长定「虫洞战利品与经济扩充」①，**改了 09-14 的老口径**）。
   *
   * 老口径（09-14 修一号核验缺陷时定的）：谜质装置与货柜**共用同一套形状件账本**（都记 `kind: 'box'`），
   * 撤离收口按 `p.kind === 'box'` 取件 ⇒ 装置被当货柜交给 `wormholeDeliverRelics` 进了仓库，
   * 与物品说明「离开虫洞即失效」相反 ⇒ 当时改成**按物品 `kind` 排除 `matter`**（随趟消失、不进仓库）。
   * 新口径：**撤离成功那一刻按 1 台 = 1 枚折成「虫洞谜质」入库**（只收不卖、纯金钱收益）；
   * 全损走不到折算点 ⇒ 一枚都拿不到。装置本身仍**既不进仓库、也不进拆解池**。
   */
  it('**谜质装置折成「虫洞谜质」**：撤离成功才折算（1 台 = 1 枚），装置本身仍不进仓库', () => {
    // ⚠ 两台 2×2 装置要 8 格 ⇒ 用 3 舰编队（本文件默认夹具 2 舰的货仓装不下两台）
    const state = fresh(21)
    const a = addShipToFleet(state, T3)
    const b = addShipToFleet(state, T3)
    const c = addShipToFleet(state, T3)
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a, b, c], 21).ok).toBe(true)
    const run = state.wormhole.run!
    run.depth = 2
    run.bossCleared = run.depth
    const matterId = WORMHOLE_MATTER_DEVICE_IDS[0]!
    expect(wormholeHoldStow(state, ctx, matterId).ok, '装置能装进货仓（2×2 形状件）').toBe(true)
    expect(wormholeHoldStow(state, ctx, matterId).ok, '再装一台（两件同型）').toBe(true)
    expect(countWare(state, matterId)).toBe(0)
    const before = countWare(state, WORMHOLE_ESSENCE_ITEM_ID)
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx) // 2026-09-15 起：撤离下一拍直接入港（不再有战斗）
    expect(countWare(state, matterId), '装置本身不进仓库（折算是唯一出口）').toBe(0)
    expect(countWare(state, WORMHOLE_ESSENCE_ITEM_ID) - before, '2 台 ⇒ 2 枚').toBe(2)
    const st = state.wormhole.lastSettle!
    expect(st.essences).toBe(2)
    expect(st.essenceIsk, '按行价给参考估值（不计入到手合计）').toBe(2 * 70_000)
    expect(st.boxes, '结算单不把它列成货柜').not.toContain(matterId)
  })

  it('**负 · 全灭**：全损 ⇒ 谜质装置一枚都折不出来（谜质仍是"带出去才算钱"）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.bossCleared = run.depth
    const matterId = WORMHOLE_MATTER_DEVICE_IDS[0]!
    expect(wormholeHoldStow(state, ctx, matterId).ok).toBe(true)
    const before = countWare(state, WORMHOLE_ESSENCE_ITEM_ID)
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    for (const u of Object.values(battle.units)) {
      if (u.side === 'me') u.hp = { s: 0, a: 0, h: 0 }
    }
    battle.ended = 'foe'
    settleBattle(state)
    expect(state.wormhole.run).toBeNull()
    expect(countWare(state, WORMHOLE_ESSENCE_ITEM_ID)).toBe(before)
    expect(state.wormhole.lastSettle!.kind).toBe('lost')
    expect(state.wormhole.lastSettle!.essences ?? 0).toBe(0)
  })

  /**
   * **临时空间里的东西随趟入港**（2026-09-14 修 · 一号核验查出的缺陷）。
   *
   * 收口原来读的是**老档只读字段** `run.temp`（2026-09-14 起账本已迁到 `run.tempGrid`）⇒
   * 临时空间里的件会在"撤离成功"那一刻**凭空消失**；当时被界面规则「撤离前必须清空临时空间」
   * 挡成不可达，所以没炸。
   */
  it('**临时空间随趟入港**：撤离成功时 `tempGrid` 里的散货按单位入库（不再凭空消失）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.depth = 2
    run.bossCleared = run.depth
    // 现场：货仓正好占满 ⇒ 把一件散货挪进临时空间（照搬 salvage 那条的造法）
    const slots = wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet)) // 2×T3 ⇒ 10 格
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: slots * 500 }]
    wormholeHoldSyncCargo(state, ctx)
    const piece = run.hold!.placements.find((p) => p.kind === 'cargo')!
    const moved = holdTransferTo(run.hold!, (run.tempGrid = makeHoldState(WORMHOLE_TEMP_COLS)), piece.id, WORMHOLE_TEMP_CELLS)
    expect(moved.ok, moved.error ?? '').toBe(true)
    // 同步一次 ⇒ 数量账本（`run.bag`）不再含这一件（否则撤离时会被两边各算一次）
    wormholeHoldSyncCargo(state, ctx)
    expect(run.tempGrid!.placements.length, '临时空间里确实有件').toBeGreaterThan(0)
    const bagUnits = run.bag.reduce((s, e) => s + Math.floor(e.units), 0)
    const tempUnits = run.tempGrid!.placements.reduce((s, p) => s + Math.floor(p.units ?? 0), 0)
    expect(tempUnits).toBeGreaterThan(0)
    const before = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx) // 2026-09-15 起：撤离下一拍直接入港（不再有战斗）
    // 背包那批 ＋ **临时空间那批**都要到港（修前只到背包那批）
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(before + bagUnits + tempUnits)
  })


  it('**负 · 全灭**：全损——货柜一起丢（不带走）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.bossCleared = run.depth
    const family = String(ctx.anomalies.get(wormholeCardIdForRun({ family: run.family, seed: run.seed, depth: run.depth, kind: 'node', nodeIndex: 0 }))?.foeFamily ?? 'A')
    // ⚠ 2026-09-15：安全货柜 4 格 → **6 格（3×2）**，而本夹具的货仓容量 < 6 格 ⇒ 改用同批新增的
    //   **军用备货柜**（正好 2×2 = 4 格）验同一条链；安全货柜 6 格那条另有用例（形状表 / 货仓用例）。
    const boxId = family ? 'box-military' : 'box-military'
    expect(wormholeHoldStow(state, ctx, boxId).ok).toBe(true)
    /**
     * ⚠ 2026-09-15 改口径：撤离不再有战斗 ⇒ **全损只能来自节点战 / 守卫战**。
     * 原做法（掏空编队让"撤离战建不出来"⇒ 全损）已随撤离战退役；现在改成**站上舰船信号、
     * 开一场节点战并让它打输**。
     */
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    for (const u of Object.values(battle.units)) {
      if (u.side === 'me') u.hp = { s: 0, a: 0, h: 0 }
    }
    battle.ended = 'foe'
    settleBattle(state)
    expect(state.wormhole.run).toBeNull()
    expect(countWare(state, boxId)).toBe(0) // 全损 ⇒ 货柜随趟一起丢
    expect(state.wormhole.lastSettle!.kind).toBe('lost')
  })

  it('**负 · 全灭**：全损——编队全丢、背包清空、本趟结束', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const fleetBefore = Object.keys(state.fleet).length
    const runFleet = [...run.fleet]
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    run.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 300 }]
    const oreBefore = countWare(state, WORMHOLE_ORE_ITEM_ID)
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    for (const u of Object.values(battle.units)) {
      if (u.side === 'me') u.hp = { s: 0, a: 0, h: 0 }
    }
    battle.ended = 'foe'
    settleBattle(state)
    expect(state.wormhole.run).toBeNull()
    expect(state.wormhole.lastFleetLost).toBe(runFleet.length)
    expect(Object.keys(state.fleet).length).toBe(fleetBefore - runFleet.length) // 船真丢了
    expect(countWare(state, WORMHOLE_ORE_ITEM_ID)).toBe(oreBefore) // 背包内容没入港
    // **结算单**（界面弹层用）：全损也要有单子，且把"损失了哪几艘 / 本来能带走多少"写清楚
    const st = state.wormhole.lastSettle!
    expect(st.kind).toBe('lost')
    expect(st.shipsLost.length).toBe(runFleet.length)
    expect(st.oreIsk).toBe(0)
    expect(st.lostIsk).toBeGreaterThan(0) // 300 单位母矿本来能带走
    // **绝不软锁**：主控也在这批损失里 ⇒ 弃船补驾驶必须已经补上（全损是终局玩法，不能停在"没船可开"）
    expect(state.fleet[state.shipId], '全损后没有可驾驶船').toBeTruthy()
    expect(pilotUnavailableReason(state)).toBeNull()
  })

  it('单舰入洞打全损（连保底船都没有了）⇒ 协会补发保底舰船，不会软锁', () => {
    const state = fresh()
    const only = state.shipId
    expect(wormholeEnter(state, ctx, [only], 21).ok).toBe(true)
    const run = state.wormhole.run!
    expect(run.fleet).toEqual([only])
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    for (const u of Object.values(run.battle!.units)) {
      if (u.side === 'me') u.hp = { s: 0, a: 0, h: 0 }
    }
    run.battle!.ended = 'foe'
    settleBattle(state)
    expect(state.wormhole.run).toBeNull()
    expect(state.fleet[only]).toBeUndefined() // 唯一那艘真丢了
    expect(Object.keys(state.fleet).length).toBeGreaterThanOrEqual(1) // 协会补发保底舰船
    expect(state.fleet[state.shipId]).toBeTruthy()
    expect(pilotUnavailableReason(state)).toBeNull()
  })

  it('**沉船后格数缩水 ⇒ 超载（不自动丢货）**：船长 F4 裁定「要求玩家手动抛弃货物」', () => {
    const state = fresh()
    const ids = [addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3)]
    state.shipId = ids[0]!
    expect(wormholeEnter(state, ctx, ids, 21).ok).toBe(true)
    const run = state.wormhole.run!
    const cheap = 'ore-veldspar'
    const dear = WORMHOLE_ORE_ITEM_ID
    const capBefore = wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))
    expect(capBefore).toBeGreaterThanOrEqual(6)
    run.bag = [
      { itemId: cheap, units: (capBefore - 2) * 500 },
      { itemId: dear, units: 2 * 500 },
    ]
    const bagBefore = JSON.stringify(run.bag)
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    run.battle!.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    run.battle!.units['ally-2']!.hp = { s: 0, a: 0, h: 0 }
    winBattle(state)
    settleBattle(state)
    const back = state.wormhole.run!
    expect(wormholeBagSlots(wormholeFleetCargoM3(state, ctx, back.fleet))).toBeLessThan(capBefore)
    /**
     * **一件都没被自动丢掉**（新口径）：逐条比"数量只增不减"——
     * ⚠ 不能直接比整串相等：这一场是**胜仗**，战果（残骸）本来就会进背包；
     * 旧口径下货仓刚好装满 ⇒ 战果装不下、进不来；现在临时空间接得住 ⇒ 背包会**多出**战果条目。
     */
    for (const before of JSON.parse(bagBefore) as Array<{ itemId: string; units: number }>) {
      const after = back.bag.find((s) => s.itemId === before.itemId)?.units ?? 0
      expect(after, `${before.itemId} 被自动丢了（旧口径在自动丢货）`).toBeGreaterThanOrEqual(before.units)
    }
    /**
     * ⚠ **2026-09-14 新口径**（船长把临时空间加大到 4×8 = 32 格，且「不占容量、不算超载」）：
     * 沉船缩水后多出来的那几格不再算"放不下"，而是**落进临时空间**（收货阶梯第二层）⇒
     * `wormholeHoldOverloaded` 为假，但**撤离前必须先把它清空**（引擎侧第二道闸）。
     * 惩罚因此从"立刻封锁"改成"**撤离前必须丢到容量内**"，洞里仍可继续搜打撤。
     */
    expect(wormholeHoldUsage(state, ctx).unplacedCells).toBe(0)
    expect(wormholeTempUsage(state, ctx).cells, '多出来的货落在临时空间').toBeGreaterThan(0)
    expect(wormholeHoldOverloaded(state, ctx), '临时空间不算超载').toBe(false)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('超载'))).toBe(true)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('手动抛弃货物'))).toBe(true)
    // 玩家点「一键抛到容量内」（先便宜的）⇒ 恢复
    const fit = wormholeDiscardToFit(state, ctx)
    expect(fit.ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // ⚠ 这一场是**胜仗**：战果（残骸）会进背包 —— 裁剪后再同步，多出来的战果落在临时空间里等玩家处理
    expect(wormholeHoldUsage(state, ctx).used).toBeLessThanOrEqual(wormholeHoldUsage(state, ctx).capacity)
    const dearLeft = back.bag.find((s) => s.itemId === dear)?.units ?? 0
    expect(dearLeft, '贵货被丢了（应先丢便宜的）').toBe(1000)
  })

  it('**一键抛货的顺序**（玩家点按钮，仍按价值）：普通残骸先丢、原矿其次、**稀有残骸最后丢**', () => {
    const state = fresh()
    const ids = [addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3), addShipToFleet(state, T3)]
    state.shipId = ids[0]!
    expect(wormholeEnter(state, ctx, ids, 21).ok).toBe(true)
    const run = state.wormhole.run!
    const card = 'wh-pirate-scout'
    const common = wreckItemIdOf(card)
    const rare = rareWreckItemIdOf(card)
    const capBefore = wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))
    expect(capBefore).toBe(20) // 4×T3 合计货仓 10,400 m³ ÷ 500
    // 12 格普通残骸 + 3 格虚空母矿 + 1 格稀有残骸 = 16 格 > 缩容后的 10 格
    run.bag = [
      { itemId: common, units: 12 * 500 },
      { itemId: WORMHOLE_ORE_ITEM_ID, units: 3 * 500 },
      { itemId: rare, units: 30 },
    ]
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    run.battle!.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    run.battle!.units['ally-2']!.hp = { s: 0, a: 0, h: 0 }
    winBattle(state)
    settleBattle(state)
    const back = state.wormhole.run!
    expect(wormholeBagSlots(wormholeFleetCargoM3(state, ctx, back.fleet))).toBe(10)
    // 16 格 > 缩容后的 10 格 ⇒ 多出的 6 格落进临时空间（不算超载，但撤离前必须清空）
    expect(wormholeTempUsage(state, ctx).cells).toBeGreaterThan(0)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    // 玩家点「抛到容量内」⇒ 只动最便宜的（普通残骸），原矿与稀有残骸留着
    const fit = wormholeDiscardToFit(state, ctx)
    expect(fit.ok).toBe(true)
    expect(wormholeHoldOverloaded(state, ctx)).toBe(false)
    expect(wormholeHoldUsage(state, ctx).used).toBeLessThanOrEqual(wormholeHoldUsage(state, ctx).capacity)
    /**
     * 族锁定（丁）之后，**同族的稀有残骸是同一种物品** ⇒ 两格产出的稀有残骸会合成一堆，
     * 这里不再钉"恰好 30"，只要求"还在"（没被当便宜货丢掉）。
     */
    expect(back.bag.find((s) => s.itemId === rare)?.units ?? 0, '稀有残骸被丢了').toBeGreaterThanOrEqual(30)
    expect(back.bag.find((s) => s.itemId === WORMHOLE_ORE_ITEM_ID)?.units, '虚空母矿被丢了').toBe(1500)
    expect(back.bag.find((s) => s.itemId === common)?.units ?? 0, '普通残骸没被扣').toBeLessThan(12 * 500)
  })

  it('某个僚舰被打沉（战斗仍胜）：该船从编队与舰队里一起消失，其余船继续', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    const fleetBefore = Object.keys(state.fleet).length
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    battle.units['ally-1']!.hp = { s: 0, a: 0, h: 0 } // 僚舰沉
    winBattle(state)
    settleBattle(state)
    expect(run.fleet.length).toBe(1) // 编队只剩主控
    expect(Object.keys(state.fleet).length).toBe(fleetBefore - 1)
    expect(state.wormhole.run).not.toBeNull() // 还有船 ⇒ 本趟继续
    expect(run.battle).toBeNull()
  })

  it('撤离战开不起来（编队没了之类的硬故障）⇒ 按全损收场，不卡在撤离相位', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    run.bossCleared = run.depth
    run.bag = []
    // 掏空编队记录 ⇒ `startFleetBattleFor` 建不出战斗
    run.fleet = []
    expect(wormholeExtract(run).ok).toBe(true)
    advanceWormhole(state, ctx)
    expect(state.wormhole.run).toBeNull()
  })
})

describe('虫洞 · 开战距离与派生一致性（船长 2026-09-13 两条口径）', () => {
  it('**开战距离特殊规则**：非近战敌人开局就站在**自己的目标距离**（不是"最远射程 + 缓冲"）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const card = ctx.anomalies.get(battle.wormhole!.cardId)!
    const me = createPlayerSpec(state, ctx, run.fleet[0]!)!
    const foes = createFoeSpecs(
      wormholeAnomalyOf(card, 1, 'node', 1, {
        hpBudget: foeHpOfThreat(wormholeLayerThreat(1), ctx.balance.battle) * 10,
      }),
      ctx.balance.battle,
    )
    const anyBrawl = foes.some((f) => f.foeTactic === 'brawl')
    // ⚠ 近战怪那一支走**独立的洞内开局档** `wormholeBrawlOpenBand`（0.5 中段）——船长 2026-09-15 选定「乙」：
    // 默认期望抬到 0.8，但"贴脸怪一开场就在你脸上"（2026-09-13）保留 ⇒ 不许写成 `desiredRangeFor(me,'mid',bal)`
    const expected = anyBrawl
      ? desiredRangeFor(me, 'mid', ctx.balance.battle, ctx.balance.battle.wormholeBrawlOpenBand)
      : foeDesiredRange(me, foes, ctx.balance.battle)
    const openM = battleOpenM(me, foes, ctx.balance.battle)
    // 常规口径是"最远射程 + 缓冲"（= openM）；洞内口径落在**目标距离**上（被 openM 钳制的场合取钳制值）
    expect(battle.distanceM).toBe(
      Math.max(ctx.balance.battle.minDistanceM, Math.min(openM, Math.round(expected))),
    )
    expect(battle.distanceM).toBeLessThanOrEqual(openM)
  })

  it('**洞内默认期望跟星图同档 0.8；近战怪开局仍守中段 0.5**（船长 2026-09-15「口误」更正 + 选定「乙」）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const me = createPlayerSpec(state, ctx, run.fleet[0]!)!
    const bal = ctx.balance.battle
    expect(bal.desireBandMid).toBe(0.8) // 星图与洞内同一个默认档（分档已取消）
    expect(bal.wormholeBrawlOpenBand).toBe(0.5) // 洞内"近战怪开局"独立档，保留中段
    expect(run.desireM ?? null).toBeNull() // 本趟没设过期望距离 ⇒ 走默认档
    const midPos = desiredRangeFor(me, 'mid', bal) // = 0.8 档
    const brawlPos = desiredRangeFor(me, 'mid', bal, bal.wormholeBrawlOpenBand) // = 0.5 档
    expect(brawlPos).toBeLessThan(midPos) // 中段比 0.8 档更近（本船射程带 min < max）
    // 期望（稳态目标）跟星图同档；开战距离（= 双方最远射程×1.1）恒大于它 ⇒ 不会被钳
    expect(run.battle!.myDesireM).toBe(midPos)
  })

  it('**逐拍重建与开战同源**：敌人真能打疼你（首版就错在这里——血强化了、炮还是自然值）', () => {
    const state = enterRun(7)
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const meTags = (battle.myFleet ?? []).map((e) => e.tag)
    const hpSum = (): number =>
      meTags.reduce((n, t) => {
        const u = battle.units[t]
        return n + (u ? u.hp.s + u.hp.a + u.hp.h : 0)
      }, 0)
    const before = hpSum()
    let guard = 0
    while (!battle.ended && guard < 180) {
      state.gameMs += 1_000
      advanceBattleFor(state, ctx, battle, run.fleet[0]!, battle.wormhole!.cardId)
      guard++
    }
    const lost = before - hpSum()
    expect(battle.stats.foeShots, '敌人整场没开火（开战距离或派生口径又错了）').toBeGreaterThan(0)
    expect(lost, '敌人开火了却打不掉血（开战 / 逐拍两处派生不同源）').toBeGreaterThan(0)
    // 强度系数 10 的口径下，这一场应当打出**成规模**的战损（不是挠痒痒）
    expect(lost / before).toBeGreaterThan(0.05)
  })
  it('**战报**：每场洞内战斗结束都留一条同源战报（交火时长 / 双方开火命中 / 编队残血）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    winBattle(state)
    settleBattle(state)
    const line = state.logs.map((l) => l.text).filter((t) => t.includes('交火结束')).pop()
    expect(line, '地点战胜利没有战报').toBeTruthy()
    expect(line!).toContain('第 1 层地点')
    expect(line!).toContain('编队残血')
    /**
     * ⚠ **撤离这一支 2026-09-15 改口径**：撤离不再有战斗 ⇒ 不再有「撤离战交火结束」的战报，
     * 只剩一条「撤离成功」的入港日志（老档遗留的撤离战仍会写战报，但新趟不会）。
     */
    const run2 = state.wormhole.run!
    run2.depth = 2
    run2.bossCleared = run2.depth
    run2.bag = [{ itemId: WORMHOLE_ORE_ITEM_ID, units: 500 }]
    expect(wormholeExtract(run2).ok).toBe(true)
    advanceWormhole(state, ctx) // 下一拍直接入港（零战斗）
    expect(run2.battle ?? null).toBeNull()
    expect(state.logs.map((l) => l.text).some((t) => t.includes('撤离成功'))).toBe(true)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('撤离战交火结束'))).toBe(false)
  })
  it('**机群照吃战损**（与远征/遭遇同款）：洞内首舰的无人机被打下来要**真扣清单**，不是白嫖', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const leader = run.fleet[0]!
    // 首舰装机库甲板 + 带上侦察无人机（真走 `buildMyUnitSpecs` ⇒ 机群生存池）
    state.fleet[leader]!.fitted = { high: ['mod-drone-rack-3'], mid: [], low: [] }
    state.fleet[leader]!.droneLoad = { 'drone-scout': 4 }
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    // 2026-09-14「逐舰机群」：池键 = `舰tag:武器下标`；首舰 4 架 ⇒ 四条 `player:*`
    expect(battle.dronePools, '洞内没建机群生存池').toBeTruthy()
    const leaderKeys = Object.keys(battle.dronePools!).filter((k) => k.startsWith('player:'))
    expect(leaderKeys.length).toBe(4)
    expect(Object.values(battle.dronePools!).every((p) => p.owner === 'player')).toBe(true)
    expect(battle.droneLoadAtStart?.['drone-scout']).toBe(4)
    expect(battle.droneLoadAtStartBy?.player?.['drone-scout']).toBe(4)
    // 模拟"被打下来 4 架"（点防/敌机群击落的落账口径：**合计 + 逐舰两份都写**），再收口
    battle.droneLost = { 'drone-scout': 4 }
    battle.droneLostBy = { player: { 'drone-scout': 4 } }
    winBattle(state)
    settleBattle(state)
    // **净损失已从清单扣除**：回收率 20%~50% ⇒ 4 架里回收 1~2 架，但**不可能一架不少**
    const left = state.fleet[leader]?.droneLoad?.['drone-scout'] ?? 0
    expect(left).toBeLessThan(4)
    expect(left).toBeGreaterThanOrEqual(1)
    expect(state.logs.map((l) => l.text).some((t) => t.includes('机群战损'))).toBe(true)
    // 账本已清（幂等：重复结算不会二次扣）
    expect(state.wormhole.run?.battle).toBeNull()
  })
  it('**逐舰机群 · 战损按舰归属**（船长 2026-09-14）：僚舰的机群也会被打掉，且**只扣它自己的清单**', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const leader = run.fleet[0]!
    const wing = run.fleet[1]!
    // 主控**不带**机群；僚舰装无人机舱 + 4 架侦察机
    state.fleet[wing]!.fitted = { high: ['mod-drone-rack-3'], mid: [], low: [] }
    state.fleet[wing]!.droneLoad = { 'drone-scout': 4 }
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    // 池里**只有僚舰那四条**（主控没带 ⇒ 一条 `player:*` 都不该有）——这就是"逐舰建池"的判据
    const keys = Object.keys(battle.dronePools ?? {})
    expect(keys.length).toBe(4)
    expect(keys.every((k) => k.startsWith('ally-1:')), `键不是僚舰的：${keys.join(',')}`).toBe(true)
    expect(battle.droneLoadAtStartBy?.['ally-1']?.['drone-scout']).toBe(4)
    // 僚舰被打掉 2 架 ⇒ 结算只该扣**僚舰**那份清单
    battle.droneLost = { 'drone-scout': 2 }
    battle.droneLostBy = { 'ally-1': { 'drone-scout': 2 } }
    winBattle(state)
    settleBattle(state)
    const wingLeft = state.fleet[wing]?.droneLoad?.['drone-scout'] ?? 0
    expect(wingLeft, '僚舰的机群战损没扣到它自己头上').toBeLessThan(4)
    expect(wingLeft).toBeGreaterThanOrEqual(1) // 回收率 20%~50% ⇒ 回收 0~1 架
    expect(state.fleet[leader]?.droneLoad?.['drone-scout'] ?? 0, '主控没带机群却被扣了').toBe(0)
    // 逐舰账本清掉本舰那一份（幂等）
    expect(state.wormhole.run?.battle).toBeNull()
  })
  it('**老档/旧战斗回落**：只有全队合计 `droneLost`、没有逐舰账本 ⇒ 照旧按主控扣（零迁移）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const leader = run.fleet[0]!
    state.fleet[leader]!.fitted = { high: ['mod-drone-rack-3'], mid: [], low: [] }
    state.fleet[leader]!.droneLoad = { 'drone-scout': 4 }
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    // 把逐舰账本整个抹掉 = 复刻"改动前开的那场战斗 / 老档"
    battle.droneLost = { 'drone-scout': 4 }
    battle.droneLostBy = undefined
    winBattle(state)
    settleBattle(state)
    const left = state.fleet[leader]?.droneLoad?.['drone-scout'] ?? 0
    expect(left, '老档（无逐舰账本）没按主控扣').toBeLessThan(4)
    expect(left).toBeGreaterThanOrEqual(1)
  })
  it('**战报带后勤尾巴**：船体维修装置消耗写进洞内战报（与远征同口径）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const repair = battle.repair ?? { units: [], kits: {}, pulses: 0, kitsUsed: 0 }
    repair.kitsUsed = 2
    repair.kitsUsedByType = { 'repairkit-mil': 2 }
    battle.repair = repair
    winBattle(state)
    settleBattle(state)
    const line = state.logs.map((l) => l.text).filter((t) => t.includes('交火结束')).pop()
    expect(line).toContain('船体维修装置')
    expect(line).toContain('×2')
  })
  it('**战后弹药退款**（与远征同款）：仓库只损失**真打出去**的那些 ⇒ 连打第二场不会哑火', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    // 让编队真带上炮与弹（默认档里两艘 T3 没装配）
    for (const uid of run.fleet) {
      state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
    }
    addWare(state, 'ammo-kinetic-l', 5_000)
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    const before = countWare(state, 'ammo-kinetic-l')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const loaded = battle.ammo.kin
    expect(loaded).toBeGreaterThan(0) // 开战装载了两艘船各自的弹
    // 真打一会儿（会消耗弹药）
    let guard = 0
    while (!battle.ended && guard++ < 90) {
      state.gameMs += 1_000
      advanceBattleFor(state, ctx, battle, run.fleet[0]!, battle.wormhole!.cardId)
    }
    const left = battle.ammo.kin
    const fired = loaded - left
    if (!battle.ended) {
      for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
      battle.ended = 'me'
    }
    settleBattle(state)
    // **退款 = 未打出去的那部分**（首版漏退款 ⇒ 每场把整批预载吞掉，第二场起全队哑火）
    expect(countWare(state, 'ammo-kinetic-l')).toBe(before - fired)
    // 第二场照样有弹
    const run2 = state.wormhole.run
    if (run2) {
      standOnPlace(run2, 'ship') // 第二场：把所在地点改成舰船信号再开打
      expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
      expect(state.wormhole.run!.battle!.ammo.kin).toBeGreaterThan(0)
    }
  })
})

describe('虫洞 · 战场视图（F2 · 2026-09-13）', () => {
  it('视图上下文：给出按层派生的敌卡 / 主控锚 / 场景名；**分胜负后仍要给 combat**（击杀慢镜窗口）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    expect(wormholeBattleViewOf(state, ctx)).toBeNull() // 没开战时没有视图
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const v = wormholeBattleViewOf(state, ctx)!
    expect(v.name).toBe('虫洞 · 第 1 层')
    expect(v.leaderShipId).toBe(run.fleet[0])
    expect(v.anomaly.threat).toBe(wormholeLayerThreat(1)) // 已按层派生
    expect(v.combat).not.toBeNull()
    expect(Object.keys(v.combat!.foeHp).length).toBeGreaterThan(0)
    // **分出胜负后 combat 仍在**：战斗界面靠它把最后一击/战报窗口播完（提前置 null ⇒ 界面直接卸载）
    winBattle(state)
    const v2 = wormholeBattleViewOf(state, ctx)!
    expect(v2.combat).not.toBeNull()
    // 结算之后（战斗宿主清掉）视图才消失
    settleBattle(state)
    expect(state.wormhole.run!.battle).toBeNull()
    expect(wormholeBattleViewOf(state, ctx)).toBeNull()
  })

  it('**阵亡的敌舰仍留在 `combat.foeHp` 里**（否则战斗界面看不到"血量归零那一拍"⇒ 敌方没有爆炸动画）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    const battle = run.battle!
    const foeTag = Object.keys(battle.units).find((t) => battle.units[t]!.side === 'foe')!
    // 先把这一艘打空（= 引擎里刚被击毁的那一拍）
    battle.units[foeTag]!.hp = { s: 0, a: 0, h: 0 }
    const v = wormholeBattleViewOf(state, ctx)!
    // 口径：**按 side 收、不按血量收** —— 条目还在（血量 0），界面才能靠 `prevHpRef` 的 >0 → 0 触发爆炸
    expect(v.combat!.foeHp[foeTag], '阵亡敌舰的条目不该从 foeHp 里消失').toBeTruthy()
    expect(v.combat!.foeHp[foeTag]!.s + v.combat!.foeHp[foeTag]!.a + v.combat!.foeHp[foeTag]!.h).toBe(0)
  })

  it('击杀慢镜：分出胜负后要等 `killcamMs` 才结算（否则战斗界面一结束就卸载）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    winBattle(state)
    // 未满窗口：不结算、战斗还在
    state.gameMs = run.battle!.lastTickGameMs + 100
    advanceWormhole(state, ctx)
    expect(run.battle).not.toBeNull()
    // 满窗口：结算落地
    state.gameMs = run.battle!.lastTickGameMs + ctx.balance.battle.killcamMs + 100
    advanceWormhole(state, ctx)
    expect(run.battle).toBeNull()
  })
})

describe('虫洞 · 随档（F 批）', () => {
  it('战斗宿主与升级标记随档往返：`run.battle` + `battle.wormhole` + `bossCleared` 都不丢', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    standOnPlace(run, 'ship')
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    run.bossCleared = 1
    // 战斗中掉一点血，便于断言"动态量也带过去了"
    run.battle!.units['player']!.hp = { s: 1, a: 2, h: 3 }
    const back = loadSaveFile(serializeSaveFile(state, 1)).state.wormhole.run!
    expect(back.battle, '战中重载丢了战斗宿主').toBeTruthy()
    expect(back.battle!.wormhole).toEqual(run.battle!.wormhole)
    expect(back.battle!.myFleet).toEqual(run.battle!.myFleet)
    expect(back.battle!.units['player']!.hp).toEqual({ s: 1, a: 2, h: 3 })
    expect(back.bossCleared).toBe(1)
    // 归一化容错：坏掉的战斗标记 ⇒ 丢弃（退回原卡强度）而不是整档弃置
    const raw = JSON.parse(serializeSaveFile(state, 1)) as {
      state: { wormhole: { run: { battle: { wormhole: unknown } } } }
    }
    raw.state.wormhole.run.battle.wormhole = { cardId: '', kind: 'nope', depth: -1 }
    const broken = loadSaveFile(JSON.stringify(raw)).state.wormhole.run!.battle
    expect(broken).toBeTruthy()
    expect(broken!.wormhole).toBeUndefined()
  })

  it('**战中重载后收口照旧**：沉掉的僚舰照样真丢、机群战损照样扣（`myFleet`/`droneLost` 必须随档）', () => {
    const state = enterRun()
    const run = state.wormhole.run!
    const leader = run.fleet[0]!
    const ally = run.fleet[1]!
    standOnPlace(run, 'ship') // F3a-2：洞内战由**地点**触发（等价旧「当前节点是战斗节点」）
    expect(wormholeStartBattle(state, ctx, 'node', 0).ok).toBe(true)
    // 战斗中：僚舰沉 + 机群被打下来 3 架（都还没收口）——此刻存档
    run.battle!.units['ally-1']!.hp = { s: 0, a: 0, h: 0 }
    run.battle!.droneLost = { 'drone-scout': 3 }
    state.fleet[leader]!.droneLoad = { 'drone-scout': 4 }
    const back = loadSaveFile(serializeSaveFile(state, 1)).state
    // 重载后打赢并收口：沉船判定靠 `myFleet`（运行时不算），机群账本靠 `droneLost`
    winBattle(back)
    settleBattle(back)
    expect(back.fleet[ally], '重载后沉掉的僚舰又活过来了（`myFleet` 没随档）').toBeUndefined()
    expect(back.wormhole.run!.fleet).not.toContain(ally)
    expect(back.wormhole.run!.fleet).toContain(leader)
    const left = back.fleet[leader]?.droneLoad?.['drone-scout'] ?? 0
    expect(left, '重载后机群战损没落账（`droneLost` 没随档）').toBeLessThan(4)
  })
})
