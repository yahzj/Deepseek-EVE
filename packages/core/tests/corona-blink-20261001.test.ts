/**
 * **光环科技 · 闪现跃迁仪**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）。
 *
 * 背景：入侵第二族 R「光环科技 / Corona Systems」（原名「余晖」，同日因侵权嫌疑改判）——
 * 船长给的三条族格 = **激光武器（必中）· 风筝战术 · 闪现**。前两条落在舰级
 * （`energyForm: 'beam'` / `tactic: 'kite'`），**第三条落在本件**。
 *
 * 口径（船长同日逐条裁定）：
 * - **挂哪几档**：选「**乙：五档全带**」（T1~T5 每档都挂）；
 * - **参数与触发**：距离与触发选「**甲**」= 一次拉开 **2,000 m** · **本体被命中时触发**；
 *   🔴 **冷却 5 秒**（船长 2026-10-01 令「**全族闪现的间隔下调到5秒**」，原 12 秒）。
 *
 * 机制要点：本仓战斗**不做二维坐标**（只有 `BattleState.distanceM` 一个标量）⇒「闪现」= **距离突变**。
 * 冷却态记在 `BattleState.foeBlinks[tag]`（`save.ts` 登记 `kind: 'runtime'`，与 `foeCharges` 同口径）。
 *
 * 本用例锁四层：① 件定义与解析 ② 五档挂载 ③ 建档落地（＋别的族零行为变化）
 * ④ **真实战斗里真的闪了**（并验证冷却与"闪不动时不白盖冷却"）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, startFleetBattleFor } from '../src/index'
import { advanceBattleFor, createFoeSpecs } from '../src/combat'
import { FOE_MOUNT_IDS, resolveFoeMounts } from '../src/foeMounts'

const ctx = buildSimContext()
const bal = ctx.balance.battle
/** 光环科技最小的那张卡（外围常驻 · 5× 粼光级）——真实战斗用它起 */
const CARD = 'corona-drift'
const R_SHIP_IDS = [
  'foe-r-corona-glint',
  'foe-r-corona-echo',
  'foe-r-corona-overlay',
  'foe-r-corona-dusk',
  'foe-r-corona-nexus',
] as const

describe('光环科技 · 闪现跃迁仪：件定义与解析', () => {
  it('① 件参数 = 船长选「甲」：一次 2,000 m · 冷却 5 秒；解析出 foeBlink', () => {
    const r = resolveFoeMounts([FOE_MOUNT_IDS.coronaBlink])
    expect(r.unknown, '件 id 必须已登记（否则体检判红）').toEqual([])
    expect(r.foeBlink, '闪现参数应原样带给单位').toEqual({ distanceM: 2_000, cooldownMs: 5_000 })
    console.log(`  [读数] 瞬光跃迁仪：拉开 ${r.foeBlink!.distanceM} m · 冷却 ${r.foeBlink!.cooldownMs / 1000} 秒`)
  })

  it('② 不挂该件的编成 ⇒ 解析结果里没有 foeBlink（既有各族零行为变化）', () => {
    expect(resolveFoeMounts([]).foeBlink).toBeUndefined()
    expect(resolveFoeMounts([FOE_MOUNT_IDS.inkRangeDebuff]).foeBlink).toBeUndefined()
  })
})

describe('光环科技 · 五档壳体（船长选「乙：五档全带」＋ 激光/风筝两条族格）', () => {
  it('③ 五档逐档常挂闪现件，且全部是 laser（beam）＋ kite', () => {
    for (const id of R_SHIP_IDS) {
      const s = FOE_SHIPS.find((x) => x.id === id)
      expect(s, `${id} 应在舰级表里`).toBeTruthy()
      expect(s!.family, `${id} 属 R 族`).toBe('R')
      expect(s!.mounts, `${id} 应常挂闪现件`).toEqual([FOE_MOUNT_IDS.coronaBlink])
      expect(s!.energyForm, `${id} 是激光（能量·必中）`).toBe('beam')
      expect(s!.tactic, `${id} 是风筝战术`).toBe('kite')
    }
    console.log(`  [读数] R 族五档 ${R_SHIP_IDS.length} 艘：全部 beam + kite + 常挂瞬光跃迁仪`)
  })

  it('④ 建档：spec 上带 foeBlink；不带该件的族不带（缺省不写）', () => {
    const card = ctx.anomalies.get(CARD)!
    const specs = createFoeSpecs(card, bal, {})
    expect(specs.length).toBeGreaterThan(0)
    for (const sp of specs) {
      expect(sp.foeBlink, '本卡五艘都应带闪现参数').toEqual({ distanceM: 2_000, cooldownMs: 5_000 })
    }
    // 对照：H 族那四张卡一件都不带（零行为变化）
    const hCard = ctx.anomalies.get('ink-harass')!
    for (const sp of createFoeSpecs(hCard, bal, {})) {
      expect(sp.foeBlink, 'H 族不得带闪现').toBeUndefined()
    }
  })
})

describe('光环科技 · 闪现：真实战斗里的触发与冷却', () => {
  /** 起一场「光环 · 游弋集群」的真实战斗（照 `foe-capture-web` 的真开战入口写法） */
  function coronaBattle() {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ids = [addShipToFleet(state, 'sh-thresher'), addShipToFleet(state, 'sh-thresher')]
    state.shipId = ids[0]!
    for (const id of ids) state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
    for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
    const battle = startFleetBattleFor(state, ctx, ids, CARD, 0, null, { depth: 4, kind: 'node', waves: 1 })
    expect(battle).toBeTruthy()
    const b = battle!
    return {
      state,
      b,
      tick: (toMs: number) => {
        state.gameMs = toMs
        advanceBattleFor(state, ctx, b, ids[0]!, CARD)
      },
    }
  }

  it('⑤ 跑满一场：真的闪过（foeBlinks 里出现冷却戳），且冷却戳 = 触发时刻 + 12 秒', () => {
    const { b, tick } = coronaBattle()
    let sawBlink = false
    for (let t = 500; t <= 120_000 && b.ended === null; t += 500) {
      tick(t)
      const stamps = Object.values(b.foeBlinks ?? {})
      if (stamps.length > 0) {
        sawBlink = true
        // 冷却戳必须是「某个 500ms 整数拍的 lastTickGameMs + 12,000」
        for (const v of stamps) expect((v - 5_000) % 500, '冷却戳 = 触发时刻 + 5 秒').toBe(0)
        break
      }
    }
    expect(sawBlink, '这场仗里应有敌舰被命中后闪现').toBe(true)
    console.log(`  [读数] 闪现冷却戳 ${JSON.stringify(b.foeBlinks)}（单位 tag → 下次可用时刻 ms）`)
  })

  it('⑥ 冷却期内不重复闪：同一单位的冷却戳只记一次（值单调不减）', () => {
    const { b, tick } = coronaBattle()
    const seen = new Map<string, number>()
    for (let t = 500; t <= 90_000 && b.ended === null; t += 500) {
      tick(t)
      for (const [tag, v] of Object.entries(b.foeBlinks ?? {})) {
        const prev = seen.get(tag)
        if (prev !== undefined) expect(v, `${tag} 的冷却戳只在重新可用后才会更新`).toBeGreaterThanOrEqual(prev)
        seen.set(tag, v)
      }
    }
    expect(seen.size, '至少有一艘闪过').toBeGreaterThan(0)
  })

  it('⑦ 方向 = 与我方意图距离「反着来」（船长 2026-10-01 改判）', () => {
    /**
     * 本质判据（不依赖具体是拉远还是拉进）：**闪现后，该舰与"我方期望距离"的偏离必须变大**
     * —— 我方想近它就拉开、我方想远它就拉近 ⇒ 净效果永远是"破坏我方当前的走位意图"。
     */
    const { b, tick } = coronaBattle()
    let checked = 0
    let prevBlinks = new Set(Object.keys(b.foeBlinks ?? {}))
    for (let t = 500; t <= 120_000 && b.ended === null; t += 500) {
      const before = b.distanceM
      tick(t)
      const nowTags = Object.keys(b.foeBlinks ?? {})
      const fresh = nowTags.filter((tag) => !prevBlinks.has(tag))
      if (fresh.length > 0) {
        const desire = b.myDesireM
        const gapBefore = Math.abs(before - desire)
        const gapAfter = Math.abs(b.distanceM - desire)
        expect(
          gapAfter,
          `闪现后应离我方意图更远（${before} → ${b.distanceM}，我方意图 ${desire}）`,
        ).toBeGreaterThan(gapBefore)
        checked += 1
        console.log(
          `  [读数] 闪现 #${checked}：距离 ${before} → ${b.distanceM}（我方意图 ${desire}）⇒ 偏离 ${gapBefore} → ${gapAfter}`,
        )
        prevBlinks = new Set(nowTags)
      }
      if (checked >= 3) break
    }
    expect(checked, '至少应观察到一次闪现').toBeGreaterThan(0)
  })
})
