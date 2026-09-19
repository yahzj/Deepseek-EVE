/**
 * **残骸合并的存档迁移**（v27 → v28；船长 2026-09-19 六答之五「写存档迁移」）。
 *
 * 口径：旧档里"每卡一种"的残骸（普通 42 + 稀有 37）全部折进**所属组**（普通 13 + 稀有 13），
 * **同组数量累加**——玩家一件不丢，只是同族同地区的箱子并成一件。
 * 本用例逐账本钉住：仓库 / 货舱 / 挂卖锁仓 / 稀有残骸三本账 / 炉子 / 我的挂单 / 洞内趟内（背包·格内堆·货仓格）
 * + 市场派生量的旧键清理 + **幂等**（新档再过一遍是空操作）。
 */
import { describe, expect, it } from 'vitest'
import { CURRENT_STATE_VERSION, createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'
import { migratedWreckItemId } from '../src/wreckGroups'
import type { WormholeGridState } from '../src/wormholeGrid'

/** 造一份"v27 形态"的档：版本号回退到 27（迁移链会跑 v27→v28 那一段） */
function legacySave(inject: (s: GameState) => void): GameState {
  const s = createInitialState({ nowWallMs: 0, seed: 9 })
  inject(s)
  return { ...s, version: 27 } as unknown as GameState
}

function roundTrip(s: GameState): GameState {
  return loadSaveFile(serializeSaveFile(s, 0)).state
}

describe('残骸合并 · 存档迁移（v27 → v28）', () => {
  it('仓库/货舱/挂卖锁仓：同组**累加**、非同组不动、非残骸物品原样', () => {
    const legacy = legacySave((s) => {
      // 三张 D 族低安卡（坟场守墓者 / 穹顶守卫 / 虚海守望者）→ 全部折进 wreck-d-lo
      s.warehouse.items['wreck-ano-gravekeeper'] = 40
      s.warehouse.items['wreck-ano-vault-sentinel'] = 60
      s.warehouse.items['wreck-ano-voidedge-warden'] = 5
      s.warehouse.items['min-tritanium'] = 999 // 非残骸：不动
      s.warehouse.items['wreck-ano-unknown-card'] = 7 // 未知卡：原样保留（不猜组）
      const ship = s.fleet[s.shipId]!
      ship.cargo['wreck-wh-pirate-scout'] = 30
      ship.cargo['wreck-wh-pirate-hunt'] = 20
      s.escrowItems['wreck-rare-ano-harbor-escort'] = 3
      s.escrowItems['frag-mod-miner-2'] = 4
    })
    const out = roundTrip(legacy)
    expect(out.version).toBe(CURRENT_STATE_VERSION) // v27 档一路迁到当前版本（v28 残骸合并 → v29 谜质科技树）
    expect(out.warehouse.items['wreck-d-lo']).toBe(105) // 40 + 60 + 5
    expect(out.warehouse.items['wreck-ano-gravekeeper']).toBeUndefined()
    expect(out.warehouse.items['min-tritanium']).toBe(999)
    expect(out.warehouse.items['wreck-ano-unknown-card']).toBe(7)
    expect(out.fleet[out.shipId]!.cargo['wreck-a-wh']).toBe(50) // 30 + 20（同族同地区的洞内卡）
    expect(out.fleet[out.shipId]!.cargo['wreck-wh-pirate-scout']).toBeUndefined()
    expect(out.escrowItems['wreck-rare-b-hi']).toBe(3) // B 族两卡（退役窝点）→ b-hi，旧档兼容落点
    expect(out.escrowItems['frag-mod-miner-2']).toBe(4)
  })

  it('稀有残骸三本账（rareBurnUnits / rareBoxesOpened / rareOpenedUnits）：同组累加', () => {
    const legacy = legacySave((s) => {
      s.rareBurnUnits['wreck-rare-ano-gravekeeper'] = 30
      s.rareBurnUnits['wreck-rare-ano-vault-sentinel'] = 12
      s.rareBoxesOpened['wreck-rare-ano-gravekeeper'] = 1
      s.rareOpenedUnits['wreck-rare-wh-alien-hive'] = 30
      s.rareBurnUnits['wreck-a-hi'] = 5 // 已是新 id：不动
    })
    const out = roundTrip(legacy)
    expect(out.rareBurnUnits['wreck-rare-d-lo']).toBe(42)
    expect(out.rareBurnUnits['wreck-rare-ano-gravekeeper']).toBeUndefined()
    expect(out.rareBoxesOpened['wreck-rare-d-lo']).toBe(1)
    expect(out.rareOpenedUnits['wreck-rare-c-wh']).toBe(30)
    expect(out.rareBurnUnits['wreck-a-hi']).toBe(5)
  })

  it('炉子与我的挂单：只换 id（多炉不合并、不同价的挂单各自保留）', () => {
    const baseRun: GameState['refineRuns'][number] = {
      active: true,
      id: 0,
      worker: 'pilot',
      recipe: 'recycle',
      itemId: null,
      batchUnits: 10,
      cycleMs: 25_000,
      finishAtGameMs: 0,
      batchesDone: 0,
      recAcc: { min: {}, mod: {}, frag: {}, drone: {} },
    }
    const legacy = legacySave((s) => {
      // 两台炉：主控一台 + AI 核心一台（同 itemId 是合法状态 ⇒ 迁移**不合并炉**）
      s.refineRuns = [
        { ...baseRun, id: 0, worker: 'pilot', itemId: 'wreck-ano-gravekeeper' },
        { ...baseRun, id: 1, worker: 'basic', itemId: 'wreck-ano-vault-sentinel' },
      ]
      s.orders = [
        { id: 1, side: 'sell', good: 'wreck-ano-gravekeeper', price: 111, qty: 10, filled: 0, placedAtGameMs: 0 },
        { id: 2, side: 'sell', good: 'wreck-ano-vault-sentinel', price: 222, qty: 20, filled: 0, placedAtGameMs: 0 },
      ] as GameState['orders']
    })
    const out = roundTrip(legacy)
    expect(out.refineRuns.map((r) => r.itemId)).toEqual(['wreck-d-lo', 'wreck-d-lo']) // 两台炉照旧各自存在
    expect(out.orders.map((o) => o.good)).toEqual(['wreck-d-lo', 'wreck-d-lo'])
    expect(out.orders.map((o) => o.price)).toEqual([111, 222]) // 不同价的挂单不合并
  })

  it('洞内趟内（背包 / 格内堆 / 货仓格）与自动探索报告：只换 id', () => {
    const legacy = legacySave((s) => {
      const grid = {
        radius: 2,
        start: { q: 0, r: 0 },
        exit: { q: 1, r: 0 },
        pos: { q: 0, r: 0 },
        scanRadius: 1,
        scanned: [],
        visited: [],
        activated: [],
        cells: [
          { key: '0,0', q: 0, r: 0, place: 'graveyard', piles: [{ itemId: 'wreck-wh-pirate-scout', units: 500 }] },
        ],
      } as unknown as WormholeGridState
      s.wormhole = {
        run: {
          phase: 'inside',
          depth: 1,
          nodeIndex: 0,
          turnsLeft: 10,
          turnsTotal: 10,
          fleet: [],
          totalMass: 0,
          bag: [{ itemId: 'wreck-wh-pirate-hunt', units: 200 }],
          pendingNode: null,
          nodesPerLayer: 2,
          grid,
          hold: { placements: [{ id: 'p1', itemId: 'wreck-rare-wh-alien-hive', kind: 'cargo', units: 30, x: 0, y: 0, w: 1, h: 1 }] },
        } as unknown as NonNullable<GameState['wormhole']['run']>,
        lastFleetLost: 0,
      }
      s.wormholeAutoReports = [
        {
          id: 'r1',
          stockId: 'st1',
          depth: 2,
          finishedAtGameMs: 1000,
          shipIds: [],
          coresReleased: 0,
          gains: [{ itemId: 'wreck-wh-exile-line', units: 400 }],
          damage: [],
          confirmed: false,
        },
      ]
    })
    const out = roundTrip(legacy)
    const run = out.wormhole.run!
    expect(run.bag[0]!.itemId).toBe('wreck-a-wh')
    expect(run.grid!.cells[0]!.piles![0]!.itemId).toBe('wreck-a-wh')
    expect(run.hold!.placements[0]!.itemId).toBe('wreck-rare-c-wh')
    expect(out.wormholeAutoReports![0]!.gains[0]!.itemId).toBe('wreck-g-wh')
  })

  it('市场派生量：旧残骸键清掉（池/簿/消化/价格小史），新键由 ensureMarket 重建', () => {
    const legacy = legacySave((s) => {
      s.market.pools['wreck-ano-gravekeeper'] = { q: 100, shock: 0, netVol: 0, lastHistoryGameMs: 0, noise: 0 }
      s.market.npcBuy['wreck-ano-gravekeeper'] = [{ qty: 10, price: 30, perWindow: 1 } as never]
      s.market.npcSell['wreck-ano-vault-sentinel'] = [{ qty: 5, price: 50, perWindow: 1 } as never]
      s.market.priceHistory['wreck-a-hi'] = [30, 31] // 新 id：不该被当成"旧键"删掉
    })
    const out = roundTrip(legacy)
    expect(out.market.pools['wreck-ano-gravekeeper']).toBeUndefined()
    expect(out.market.npcBuy['wreck-ano-gravekeeper']).toBeUndefined()
    expect(out.market.npcSell['wreck-ano-vault-sentinel']).toBeUndefined()
    expect(out.market.priceHistory['wreck-a-hi']).toEqual([30, 31])
  })

  it('幂等：v28 新档再过一遍迁移链是空操作（新 id 不是旧键）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 3 })
    s.warehouse.items['wreck-d-lo'] = 105
    s.warehouse.items['wreck-rare-c-wh'] = 30
    const once = roundTrip({ ...s, version: 27 } as unknown as GameState)
    const twice = roundTrip({ ...once, version: 27 } as unknown as GameState)
    expect(twice.warehouse.items['wreck-d-lo']).toBe(105)
    expect(twice.warehouse.items['wreck-rare-c-wh']).toBe(30)
    expect(Object.keys(twice.warehouse.items).sort()).toEqual(Object.keys(once.warehouse.items).sort())
  })

  it('映射单点：`migratedWreckItemId` 覆盖全部 42 张卡（普通 + 稀有），未知 id 一律 null', () => {
    // 与组表 `members` 同源 ⇒ 只要组表成员齐，本用例即"全卡可迁移"的护栏
    expect(migratedWreckItemId('wreck-ano-training')).toBe('wreck-b-hi')
    expect(migratedWreckItemId('wreck-rare-ano-training')).toBe('wreck-rare-b-hi')
    expect(migratedWreckItemId('wreck-enc-pirate-4')).toBe('wreck-a-hi') // 隐藏遭遇模板（旧档可能有）
    expect(migratedWreckItemId('wreck-rare-wh-titan-hulk')).toBe('wreck-rare-e-wh')
    expect(migratedWreckItemId('wreck-d-lo')).toBeNull()
    expect(migratedWreckItemId('wreck-ano-nonexistent')).toBeNull()
    expect(migratedWreckItemId('ore-voidmother')).toBeNull()
  })
})
