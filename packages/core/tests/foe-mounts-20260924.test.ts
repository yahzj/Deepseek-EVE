/**
 * **两件新敌方挂载件**（船长 2026-09-24）——
 * ①「**在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避**」＋「**电子舰也要挂**」；
 * ②「**给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，会吃威胁的加成。**」。
 *
 * 归档落点：`docs/roadmap.md` 2026-09-24 条 ＋ `docs/glossary.md`「敌方挂载件」词条
 * （原设计稿 `docs/design/foe-mounts-20260924.md` 已随归档删除，细节以 git 历史兜底）。
 * 本文件钉四件事（= 原设计稿 §四 第 7 条的"三条用例"＋ 一条随档）：
 * 1. **闪避 +10pp 真进命中判定**：规格层 0.22 → 0.32（A 族）、0.30 → 0.40（劫掠电子舰），
 *    并在 `hitChance` 上**实测**同一发武器对它的命中率下降（不是只改了个字段数）；
 * 2. **层越深回得越多**：k = 本层本次实际威胁 ÷ 45 ⇒ 层 1 = 1.00、层 7 ≈ 1.97（逐值对账）；
 * 3. **满血不再回**：三层满 ⇒ 一跳 0 点、账本 `healed` 不动（也不超满值）；
 * 4. **随档**：`battle.foeRepairPulses` 与档往返不丢（漏了会让战中重载白赚一跳，2026-09-22 立的规则）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import {
  addShipToFleet,
  advanceWormhole,
  createInitialState,
  FOE_MOUNTS,
  FOE_MOUNT_IDS,
  FOE_REPAIR_THREAT_REF,
  pulseFoeMountRepair,
  resolveFoeMounts,
  wormholeEnter,
  wormholeFamilyOfSeed,
  wormholeStartBattle,
  type GameState,
  type WormholeRunState,
} from '../src/index'
import { createBattleState, createFoeSpecs, hitChance, wormholeDerivedAnomaly } from '../src/combat'

const ctx = buildSimContext()
const bal = ctx.balance.battle

/** 扫一个指定族的虫洞种子（`wormholeFamilyOfSeed` 按种子现算 ⇒ 不写死种子的族别） */
function seedOf(family: 'A' | 'G'): number {
  for (let s = 1; s <= 400; s++) if (wormholeFamilyOfSeed(s) === family) return s
  throw new Error(`找不到 ${family} 族种子`)
}
const A_SEED = seedOf('A')
const G_SEED = seedOf('G')

/** 起一趟指定族的虫洞并打一场节点战（与 `wh-foe-mounts-battle.test.ts` 同一套起手；起始层恒 1） */
function wormholeNode(family: 'A' | 'G'): { state: GameState; run: WormholeRunState } {
  const seed = family === 'A' ? A_SEED : G_SEED
  const state = createInitialState({ nowWallMs: 0, seed })
  const ids = [addShipToFleet(state, 'sh-thresher'), addShipToFleet(state, 'sh-thresher')]
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: ['mod-turret-kin-2'], mid: [], low: [] }
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
  expect(wormholeFamilyOfSeed(seed), `本用例要求 ${family} 族洞`).toBe(family)
  expect(wormholeEnter(state, ctx, ids, seed).ok).toBe(true)
  const run = state.wormhole.run!
  expect(run.depth, '新开趟恒层 1').toBe(1)
  const g = run.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = 'ship'
  const r = wormholeStartBattle(state, ctx, 'node', 0)
  expect(r.ok, r.error ?? '').toBe(true)
  return { state, run }
}

/** 某张卡在某层某用途下的敌舰规格（纯派生，不依赖进洞） */
function specsAt(cardId: string, depth: number, kind: 'node' | 'boss' = 'node', waves = 1) {
  const base = ctx.anomalies.get(cardId)!
  const derived = wormholeDerivedAnomaly(ctx, base, { depth, kind, waves })
  return { derived, specs: createFoeSpecs(derived, bal) }
}

describe('姿态陀螺仪（A 族洞内 · 船长 2026-09-24）', () => {
  it('目录：加算 0.10 · 英文名已填（l10n 覆盖要用）', () => {
    const def = FOE_MOUNTS[FOE_MOUNT_IDS.gyroStabilizer]
    expect(def.evasionBonus).toEqual({ add: 0.1 })
    expect(def.name).toBe('姿态陀螺仪')
    expect(def.en).toBe('Attitude Gyro')
    expect(resolveFoeMounts([FOE_MOUNT_IDS.gyroStabilizer]).foeEvasionBonusAdd).toBe(0.1)
  })

  it('**双语名对随单位下发**：`foeMountNames` 与 `foeMountNamePairs` 同序、下标对齐', () => {
    const { specs } = specsAt('wh-pirate-scout', 1)
    for (const f of specs) {
      const names = f.foeMountNames ?? []
      const pairs = f.foeMountNamePairs ?? []
      expect(names.length, '两件都挂了 ⇒ 两项').toBe(2)
      expect(pairs.length, '名对必须与名字逐项对齐').toBe(names.length)
      for (let i = 0; i < names.length; i++) expect(pairs[i]![0], `第 ${i} 项的中文名列`).toBe(names[i]!)
      /**
       * 英文侧：2026-09-26 三号按船长令「**翻译交给三号**」补齐了全部 14 件的 `en`
       * （交接项见 `docs/roadmap.md` §三号交接开放项）⇒ 原先那句"缺英文名的件退化成中文"
       * **只剩"没填 en 才退化"这一半仍成立**，这两件现在都该命中真英文名。
       * 并加一条：**英文名不得等于中文名**（日后新增件漏填 `en` 时当场红，而不是静默回退）。
       */
      const gyro = pairs.find((p) => p[0] === '姿态陀螺仪')!
      const charge = pairs.find((p) => p[0] === '劫掠冲锋推进器')!
      expect(gyro[1], '姿态陀螺仪的英文名').toBe('Attitude Gyro')
      expect(charge[1], '劫掠冲锋推进器的英文名').toBe('Raider Charge Thruster')
      for (const p of pairs) expect(p[1], `${p[0]} 的英文名不得等于中文名（漏填 en）`).not.toBe(p[0])
    }
  })

  it('规格层：洞内 A 族 0.22 → 0.32；劫掠电子舰 0.30 → 0.40（**电子舰也要挂**）', () => {
    // 逐卡逐条核（含"该挂的都挂了"）：A 族洞内三张卡上的一切 A 族单位都应带 0.10 加数
    for (const id of ['wh-pirate-scout', 'wh-pirate-hunt', 'wh-pirate-warband']) {
      const { specs } = specsAt(id, 1)
      expect(specs.length, `${id} 应有编成`).toBeGreaterThan(0)
      for (const f of specs) {
        expect(f.foeEvasionBonusAdd, `${id}/${f.tag} 应挂姿态陀螺仪`).toBe(0.1)
        const isEw = f.foeCaptureWeb !== undefined // 只有劫掠电子舰带捕获网
        expect(f.evasion, `${id}/${f.tag} 闪避`).toBeCloseTo(isEw ? 0.4 : 0.32, 10)
      }
    }
    // 点名两条（防"循环空转通过"）
    const ew = specsAt('wh-pirate-warband', 1).specs.find((f) => f.foeCaptureWeb !== undefined)!
    expect(ew.name, '该条应是劫掠电子舰').toContain('电子舰')
    expect(ew.evasion, '洞内劫掠电子舰 = 0.30 + 0.10').toBeCloseTo(0.4, 10)
    expect(ew.foeMountNames).toContain('姿态陀螺仪')
  })

  it('**真进命中判定**：同一发武器对 0.32 的命中率低于对 0.22 的（差值 = 0.10 × 距离折减）', () => {
    const weapon = { hitRate: 0.9, minRangeM: 1, maxRangeM: 10_000, falloff: 0.5 }
    const atk = { hitBonus: 0.1 }
    const plain = hitChance(weapon, atk, { evasion: 0.22 }, 4_000, bal)
    const gyro = hitChance(weapon, atk, { evasion: 0.32 }, 4_000, bal)
    expect(gyro, '加了陀螺仪更难被打中').toBeLessThan(plain)
    // 距离折减可实测：把同一发在极近距离（df ≈ 1）与 4km 处比，差值应等比缩小
    const near = { plain: hitChance(weapon, atk, { evasion: 0.22 }, 1, bal), gyro: hitChance(weapon, atk, { evasion: 0.32 }, 1, bal) }
    expect(near.plain - near.gyro, '近界处差值 ≈ 满额 0.10').toBeCloseTo(0.1, 2)
    expect(plain - gyro).toBeLessThan(near.plain - near.gyro)
    expect(plain - gyro).toBeGreaterThan(0)
  })

  it('洞外零该件：星图侧一切 A 族条目都不带这件（否则低安/悬赏一起加闪避）', () => {
    let checked = 0
    for (const a of ctx.anomalies.values()) {
      if (a.id.startsWith('wh-')) continue
      for (const sl of a.ships ?? []) {
        if (sl.ship.family !== 'A') continue
        expect(
          resolveFoeMounts(sl.mounts ?? sl.ship.mounts).foeEvasionBonusAdd,
          `${a.id}/${sl.ship.id} 洞外不得带姿态陀螺仪`,
        ).toBeUndefined()
        checked++
      }
    }
    expect(checked, '星图侧应真有 A 族条目可查').toBeGreaterThan(0)
  })
})

describe('船体修理装置（G 族洞内 · 船长 2026-09-24）', () => {
  /** 基数（船长 2026-09-24 二次令：**5/5 上调至 15/15**）——用例一律**从目录读**，改基数只需改这一处来源 */
  const BASE = FOE_MOUNTS[FOE_MOUNT_IDS.hullRepair].repairPulse!

  it('目录：每 5 秒 15 装甲 + 15 结构（船长二次令上调）· 英文名已填', () => {
    expect(FOE_MOUNTS[FOE_MOUNT_IDS.hullRepair].repairPulse).toEqual({ everyMs: 5_000, armor: 15, hull: 15 })
    expect(FOE_MOUNTS[FOE_MOUNT_IDS.hullRepair].en).toBe('Hull Repair Unit')
  })

  it('规格层：洞内 G 族每条编成都带该件，且层 1 的 k = 1.00（= 威胁 45 ÷ 45）', () => {
    for (const id of ['wh-exile-blockade', 'wh-exile-swarm', 'wh-exile-line']) {
      const { derived, specs } = specsAt(id, 1)
      expect(specs.length, `${id} 应有编成`).toBeGreaterThan(0)
      for (const f of specs) {
        expect(f.foeRepairPulse, `${id}/${f.tag} 应挂船体修理装置`).toBeTruthy()
        expect(f.foeRepairPulse!.everyMs).toBe(5_000)
        expect(f.foeRepairPulse!.armor).toBe(BASE.armor)
        expect(f.foeRepairPulse!.hull).toBe(BASE.hull)
        expect(f.foeRepairPulse!.k, `${id} 层 1 的 k`).toBeCloseTo(derived.threat! / FOE_REPAIR_THREAT_REF, 10)
      }
      expect(derived.threat, `${id} 层 1 节点威胁 = 基准 45`).toBe(FOE_REPAIR_THREAT_REF)
    }
  })

  it('**层越深回得越多**：k = 层威胁 ÷ 45 逐值对账（层 1 = 1.00 · 层 7 ≈ 1.97）', () => {
    const rows = [1, 2, 4, 7, 10].map((depth) => {
      const { derived, specs } = specsAt('wh-exile-blockade', depth)
      return { depth, threat: derived.threat!, k: specs[0]!.foeRepairPulse!.k }
    })
    for (const r of rows) expect(r.k, `层 ${r.depth} 的 k`).toBeCloseTo(r.threat / FOE_REPAIR_THREAT_REF, 10)
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.k, `层 ${rows[i]!.depth} 应比上一层回得多`).toBeGreaterThan(rows[i - 1]!.k)
    }
    expect(rows[0]!.k, '层 1 = 归一基准').toBe(1)
    expect(rows[3]!.k, '设计稿 §二：层 7 ≈ 1.97').toBeGreaterThan(1.9)
    expect(rows[3]!.k).toBeLessThan(2.05)
  })

  it('层末守卫另吃 ×1.2 的威胁倍率 ⇒ 同层 boss 的 k 高于节点', () => {
    const node = specsAt('wh-exile-blockade', 7, 'node').specs[0]!
    const boss = specsAt('wh-exile-blockade', 7, 'boss').specs[0]!
    expect(boss.foeRepairPulse!.k).toBeGreaterThan(node.foeRepairPulse!.k)
  })

  it('一跳实收 = `round(基数 × k)` 装甲 ＋ 同额结构；**满血不再回**、不超满值', () => {
    const fodder = specsAt('wh-exile-blockade', 1).specs[0]!
    const me = { ...fodder, tag: 'player', side: 'me' as const }
    const battle = createBattleState(me, [fodder], 0, 5_000)
    const ledger = { nextPulseAtMs: 5_000, pulses: 0, healed: 0 }
    const rt = battle.units[fodder.tag]!
    rt.hp = { ...rt.hp, a: Math.max(1, Math.floor(fodder.hp.a / 2)), h: Math.max(1, Math.floor(fodder.hp.h / 2)) }
    const before = { ...rt.hp }
    pulseFoeMountRepair(battle, fodder, ledger)
    expect(ledger.pulses).toBe(1)
    expect(rt.hp.a - before.a, `装甲 +round(${BASE.armor}×1.00)`).toBe(BASE.armor)
    expect(rt.hp.h - before.h, `结构 +round(${BASE.hull}×1.00)`).toBe(BASE.hull)
    expect(ledger.healed).toBe(BASE.armor + BASE.hull)
    // 满血 ⇒ 一跳 0 点，且永不超过满值
    rt.hp = { ...fodder.hp }
    const healedBefore = ledger.healed
    pulseFoeMountRepair(battle, fodder, ledger)
    expect(rt.hp.a).toBe(fodder.hp.a)
    expect(rt.hp.h).toBe(fodder.hp.h)
    expect(ledger.healed, '满血那一跳不产生修理量').toBe(healedBefore)
  })

  it('层越深一跳越多（战斗内实收）：层 7 一跳 > 层 1 一跳', () => {
    const healAt = (depth: number): number => {
      const spec = specsAt('wh-exile-blockade', depth).specs[0]!
      const battle = createBattleState({ ...spec, tag: 'player', side: 'me' as const }, [spec], 0, 5_000)
      // ⚠ **留 1 点结构**：结构归零 = 阵亡，而阵亡单位按 2026-09-19「尸体不复活」的口径**不修**
      battle.units[spec.tag]!.hp = { s: 0, a: 0, h: 1 }
      // ⚠ `createBattleState` 只建战斗（不跑开战建档的 `initFoeRepairPulses`）⇒ 账本由本用例自建，
      // 与引擎同形（见 `combat.initFoeRepairPulses`）
      const ledger = { nextPulseAtMs: 5_000, pulses: 0, healed: 0 }
      pulseFoeMountRepair(battle, spec, ledger)
      return ledger.healed
    }
    const l1 = healAt(1)
    const l7 = healAt(7)
    const k7 = specsAt('wh-exile-blockade', 7).specs[0]!.foeRepairPulse!.k
    expect(l1).toBe(BASE.armor + BASE.hull)
    expect(l7).toBe(Math.round(BASE.armor * k7) + Math.round(BASE.hull * k7))
    expect(l7).toBeGreaterThan(l1)
  })

  it('端到端：G 族洞内节点战开战后账本按 tag 建好、首跳 = 开战 + 5 秒，且 6 秒时已跳一跳', () => {
    const { state, run } = wormholeNode('G')
    const battle = run.battle!
    const ledgers = battle.foeRepairPulses ?? {}
    const tags = Object.keys(ledgers)
    // ⚠ 与引擎**同源**：账本条数 = "本卡挂了该件的编成条数"（本用例不写死张数）
    const need = createFoeSpecs(
      wormholeDerivedAnomaly(ctx, ctx.anomalies.get(battle.wormhole!.cardId)!, {
        depth: battle.wormhole!.depth,
        kind: 'node',
        waves: 1,
      }),
      bal,
    ).filter((f) => f.foeRepairPulse !== undefined)
    expect(tags.length, '账本条数应等于挂件条数').toBe(need.length)
    for (const t of tags) expect(ledgers[t]!.nextPulseAtMs).toBe(battle.startedAtGameMs + 5_000)
    // 走到第 6 秒：每台各跳一次（逐拍推进由 advanceWormhole 承担）
    state.gameMs = battle.startedAtGameMs + 6_000
    advanceWormhole(state, ctx)
    for (const t of tags) expect(ledgers[t]!.pulses, `${t} 应已跳 ≥1 次`).toBeGreaterThanOrEqual(1)
  })
})

describe('两件挂载件的共同边界', () => {
  it('洞外零该两件（星图侧一切卡 × 一切条目）', () => {
    for (const a of ctx.anomalies.values()) {
      if (a.id.startsWith('wh-')) continue
      for (const sl of a.ships ?? []) {
        const eff = resolveFoeMounts(sl.mounts ?? sl.ship.mounts)
        expect(eff.foeEvasionBonusAdd, `${a.id}/${sl.ship.id} 不得带姿态陀螺仪`).toBeUndefined()
        expect(eff.foeRepairPulse, `${a.id}/${sl.ship.id} 不得带船体修理装置`).toBeUndefined()
      }
    }
  })

  it('洞内十五张卡的家族分布（前缀判据与 content:check 的归属契约同源）', () => {
    const wh = [...ctx.anomalies.values()].filter((a) => a.id.startsWith('wh-'))
    expect(wh.length).toBe(15)
    expect(wh.filter((a) => a.foeFamily === 'A').length).toBe(3)
    expect(wh.filter((a) => a.foeFamily === 'G').length).toBe(3)
  })

  it('**挂件不参与派生血/火力**：摘掉挂件的同形卡 ⇒ 派生威胁、三层血、单发逐值不变', () => {
    const withMounts = ctx.anomalies.get('wh-exile-blockade')!
    // 同形卡：只把编成里的 mounts 摘掉（其余字段一字不动）
    const stripped = { ...withMounts, ships: (withMounts.ships ?? []).map((sl) => ({ ...sl, mounts: undefined })) }
    for (const depth of [1, 5]) {
      const a = wormholeDerivedAnomaly(ctx, withMounts, { depth, kind: 'node', waves: 1 })
      const b = wormholeDerivedAnomaly(ctx, stripped, { depth, kind: 'node', waves: 1 })
      expect(a.threat, `层 ${depth} 的威胁`).toBe(b.threat)
      const [fa] = createFoeSpecs(a, bal)
      const [fb] = createFoeSpecs(b, bal)
      expect(fa!.hp, `层 ${depth} 的三层血`).toEqual(fb!.hp)
      expect(fa!.weapons.map((w) => w.shotDmg), `层 ${depth} 的单发`).toEqual(fb!.weapons.map((w) => w.shotDmg))
    }
  })
})
