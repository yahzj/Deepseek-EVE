/**
 * 装配方案（预设）：保存 / 套用 / 上限 / 缺件 / 超载 / 锁定 / 存档清洗
 * （2026-09-14 船长拍板；口径正文 = `packages/core/src/fitPresets.ts` 头注释，本件是钉子）。
 *
 * 船长四问四答：**按船型归口** · **每型 10 套**（2026-09-17 「上限拓展到10套」；原 3 套）· **存槽位装备 + 无人机舱装载** ·
 * **尽力装 + 逐条提示** · **先卸光再装**；入口在装配页「装配目标」栏右侧；每套可展开**明细**看逐位装了什么（同日船长）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, ItemDef, SimContext } from '../src/index'
import {
  addModule,
  addShipToFleet,
  addWare,
  adjustDroneLoad,
  applyFitPreset,
  countModule,
  countWare,
  createInitialState,
  deleteFitPreset,
  fitPresetBrief,
  fitPresetDetailOf,
  FIT_PRESET_MAX,
  fitPresetsOf,
  fitModule,
  loadSaveFile,
  renameFitPreset,
  saveFitPreset,
  serializeSaveFile,
  unfitAllModules,
} from '../src/index'
import { makeTestCtx, moduleDef, ship } from './helpers'

/** 测试无人机（每架 10 CPU / 10 m³） */
const DRONE: ItemDef = {
  id: 'drone-x',
  name: '试验无人机',
  kind: 'drone',
  unitM3: 10,
  baseSellPriceIsk: 100,
  description: '测试用无人机',
  damageType: 'kinetic',
  dmg: 1,
  cpuUse: 10,
  maxRangeM: 2500,
  hitRate: 0.75,
  falloff: 1,
  droneClass: 'combat',
}

const GUN = {
  rack: 'high' as const,
  damageType: 'kinetic' as const,
  maxRangeM: 3000,
  minRangeM: 0,
  hitRate: 1,
  falloff: 1,
  reloadMs: 1000,
  dmgMult: 2,
  ammoPerEngagement: 10,
}

/** 一台装配台：同型两艘船（`uid` 当"模板船"，套用目标另建）+ 三门件（炮 10 CPU / 协处理器 / 装甲 5 CPU） */
function world(opts?: { cpu?: number; slots?: { high: number; mid: number; low: number } }): {
  state: GameState
  ctx: SimContext
  uid: string
} {
  const ctx = makeTestCtx({
    quietEvents: true,
    items: [DRONE],
    ships: [
      ship('sh-fit', {
        cpu: opts?.cpu ?? 200,
        droneBayM3: 100,
        slots: opts?.slots ?? { high: 3, mid: 2, low: 3 },
      }),
    ],
    modules: [
      moduleDef('mod-gun', 'turret', 0, { ...GUN, cpuUse: 10 }),
      moduleDef('mod-cpu', 'cpu', 0, { rack: 'low', cpuUse: 0, cpuBonus: 60 }),
      moduleDef('mod-armor', 'armor', 0, { rack: 'low', cpuUse: 5, armorHpBonus: 0.1 }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  const uid = addShipToFleet(state, 'sh-fit')
  state.shipId = uid
  return { state, ctx, uid }
}

/** 直接摆位（本件测"方案"这一层；装配本身另有用例） */
function place(state: GameState, uid: string, rack: 'high' | 'mid' | 'low', index: number, id: string | null): void {
  state.fleet[uid]!.fitted[rack][index] = id
}

describe('装配方案（预设）：保存', () => {
  it('保存当前装配：默认「方案 1」· 位数组裁尾 · 无人机舱随存', () => {
    const { state, ctx, uid } = world()
    place(state, uid, 'high', 0, 'mod-gun')
    place(state, uid, 'low', 0, 'mod-armor')
    addWare(state, 'drone-x', 5)
    expect(adjustDroneLoad(state, ctx, 'drone-x', 2, uid).ok).toBe(true)

    expect(saveFitPreset(state, ctx, uid).ok).toBe(true)
    const list = fitPresetsOf(state, 'sh-fit')
    expect(list.length).toBe(1)
    expect(list[0]!.name).toBe('方案 1')
    expect(list[0]!.fitted.high).toEqual(['mod-gun']) // 尾部 2 个空位已裁
    expect(list[0]!.fitted.mid).toEqual([])
    expect(list[0]!.fitted.low).toEqual(['mod-armor'])
    expect(list[0]!.droneLoad).toEqual({ 'drone-x': 2 })
    expect(fitPresetBrief(list[0]!)).toBe('装备 2 件（高 1 / 中 0 / 低 1） · 无人机 1 型 2 架')
  })

  it('空装配不许存（与清洗层「全空丢弃」对齐）', () => {
    const { state, ctx, uid } = world()
    const r = saveFitPreset(state, ctx, uid)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('一键卸下全部装备')
    expect(fitPresetsOf(state, "sh-fit").length).toBe(0)
    // 只装一件（或只装无人机）就能存
    addWare(state, 'drone-x', 1)
    expect(adjustDroneLoad(state, ctx, 'drone-x', 1, uid).ok).toBe(true)
    expect(saveFitPreset(state, ctx, uid).ok).toBe(true)
  })

  it('**每型最多 10 套**（船长 2026-09-17「上限拓展到10套」）· 同名可覆盖 · 改名（同名拒绝）· 删除', () => {
    const { state, ctx, uid } = world()
    place(state, uid, 'high', 0, 'mod-gun') // 空装配不许存（见上一条用例）⇒ 先装一件
    for (let i = 1; i <= FIT_PRESET_MAX; i++) {
      expect(saveFitPreset(state, ctx, uid, `甲${i}`).ok, `第 ${i} 套应能存下`).toBe(true)
    }
    expect(fitPresetsOf(state, 'sh-fit').length).toBe(10)

    // 满 10 套后：新名字被拒（文案带新上限），同名仍可覆盖
    const full = saveFitPreset(state, ctx, uid)
    expect(full.ok).toBe(false)
    expect(full.error).toContain('10 套')

    place(state, uid, 'high', 0, 'mod-gun')
    expect(saveFitPreset(state, ctx, uid, '甲1').ok).toBe(true)
    expect(fitPresetsOf(state, 'sh-fit').length).toBe(10)
    expect(fitPresetsOf(state, 'sh-fit')[0]!.fitted.high).toEqual(['mod-gun'])

    // 改名：同名拒绝；改成新名成功
    expect(renameFitPreset(state, 'sh-fit', 0, '甲2').ok).toBe(false)
    expect(renameFitPreset(state, 'sh-fit', 0, '甲改').ok).toBe(true)
    expect(fitPresetsOf(state, 'sh-fit')[0]!.name).toBe('甲改')

    expect(deleteFitPreset(state, 'sh-fit', 1).ok).toBe(true)
    expect(fitPresetsOf(state, 'sh-fit').length).toBe(9)
    expect(fitPresetsOf(state, 'sh-fit')[0]!.name).toBe('甲改')
  })

  it('**方案明细**：逐位铺满本船槽位（空位显示「空」）＋ 无人机「型 × 架」＋ 未知件不隐藏', () => {
    const { state, ctx, uid } = world()
    place(state, uid, 'high', 0, 'mod-gun')
    place(state, uid, 'low', 0, 'mod-armor')
    addWare(state, 'drone-x', 5)
    expect(adjustDroneLoad(state, ctx, 'drone-x', 2, uid).ok).toBe(true)
    expect(saveFitPreset(state, ctx, uid).ok).toBe(true)
    const preset = fitPresetsOf(state, 'sh-fit')[0]!
    const ship = ctx.ships.get('sh-fit')!
    const detail = fitPresetDetailOf(preset, ctx, ship)

    // 逐位铺满：本夹具船 = 高 3 / 中 2 / 低 3（共 8 位）⇒ 空位以 name='空' 标出
    expect(ctx.ships.get('sh-fit')!.slots).toEqual({ high: 3, mid: 2, low: 3 })
    expect(detail.slots.map((s) => `${s.rack}${s.index}:${s.name}`)).toEqual([
      'high1:模块mod-gun',
      'high2:空',
      'high3:空',
      'mid1:空',
      'mid2:空',
      'low1:模块mod-armor',
      'low2:空',
      'low3:空',
    ])
    expect(detail.slots.filter((s) => s.id === null).length).toBe(6)
    expect(detail.drones).toEqual([{ id: 'drone-x', name: '试验无人机', count: 2, missing: false }])
    expect(detail.overflow).toBe(0)

    // 未知 / 已下架的件不隐藏：name 回落成 id 并标 missing（与套用时"逐条报未装"同口径）
    const broken = { name: '坏方案', fitted: { high: ['mod-gone'], mid: [], low: [] }, droneLoad: { 'drone-gone': 3 } }
    const bd = fitPresetDetailOf(broken, ctx, ship)
    const gone = bd.slots.find((s) => s.id === 'mod-gone')!
    expect(gone.name).toBe('mod-gone')
    expect(gone.missing).toBe(true)
    expect(bd.drones[0]!.missing).toBe(true)
  })

  it('**明细：超出本船槽位的方案位如实报出**（套用时按 Math.min 忽略）', () => {
    const { state, ctx, uid } = world()
    place(state, uid, 'high', 0, 'mod-gun')
    expect(saveFitPreset(state, ctx, uid).ok).toBe(true)
    const preset = fitPresetsOf(state, 'sh-fit')[0]!
    // 手工塞一个"比船位多"的形状（船型槽位被改小的情形）：高位 4 个 vs 本船高 3 位
    const wide = { ...preset, fitted: { high: ['mod-gun', 'mod-gun', 'mod-gun', 'mod-gun'], mid: [], low: [] } }
    const detail = fitPresetDetailOf(wide, ctx, ctx.ships.get('sh-fit')!)
    expect(detail.slots.filter((s) => s.rack === 'high').length).toBe(3) // 只铺本船位数
    expect(detail.overflow).toBe(1)
  })
})

describe('装配方案（预设）：套用（先卸光再装 · 尽力装 + 逐条提示）', () => {
  it('整船换装：旧件回装备库 · 新件出库 · 无人机按方案装载', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'mod-gun', 2) // 库存 2（1 件给模板船、1 件留给套用）
    addModule(state, 'mod-armor', 1)
    addWare(state, 'drone-x', 5)
    // 模板船：装一门炮 + 无人机 2 架 ⇒ 存方案
    expect(fitModule(state, 'mod-gun', ctx, { shipId: uid, rack: 'high', index: 0 }).ok).toBe(true)
    expect(adjustDroneLoad(state, ctx, 'drone-x', 2, uid).ok).toBe(true)
    expect(saveFitPreset(state, ctx, uid, '主力').ok).toBe(true)

    // 套用目标：同型第二艘，先装一件装甲（套用时应当被卸回装备库）
    const uid2 = addShipToFleet(state, 'sh-fit')
    expect(fitModule(state, 'mod-armor', ctx, { shipId: uid2, rack: 'low', index: 0 }).ok).toBe(true)
    expect(countModule(state, 'mod-gun')).toBe(1)
    expect(countModule(state, 'mod-armor')).toBe(0)

    const r = applyFitPreset(state, ctx, uid2, 0)
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('已套用「主力」')
    expect(r.summary).toContain('卸下 1 件')
    expect(r.summary).toContain('装上 1 件')
    expect(r.summary).toContain('装入无人机 2 架')

    expect(state.fleet[uid2]!.fitted.high[0]).toBe('mod-gun')
    expect(state.fleet[uid2]!.fitted.low.every((x) => x === null)).toBe(true)
    expect(state.fleet[uid2]!.droneLoad).toEqual({ 'drone-x': 2 })
    expect(countModule(state, 'mod-gun')).toBe(0) // 出库
    expect(countModule(state, 'mod-armor')).toBe(1) // 旧件回库
    // 无人机：模板船占 2 架、套用目标再装 2 架 ⇒ 5 − 2 − 2 = 1
    expect(countWare(state, 'drone-x')).toBe(1)
    // 模板船自己的装配不受影响（方案是按船型共享的"图纸"，不是搬运）
    expect(state.fleet[uid]!.fitted.high[0]).toBe('mod-gun')
  })

  it('装备库缺件：能装的先装上，缺件逐条报出（且旧件已按"先卸光"回库）', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'mod-gun', 1) // 只够一门
    place(state, uid, 'high', 0, 'mod-gun')
    place(state, uid, 'high', 1, 'mod-gun') // 方案要两门
    expect(saveFitPreset(state, ctx, uid, '双炮').ok).toBe(true)

    const uid2 = addShipToFleet(state, 'sh-fit')
    addModule(state, 'mod-armor', 1)
    expect(fitModule(state, 'mod-armor', ctx, { shipId: uid2, rack: 'low', index: 0 }).ok).toBe(true)

    const r = applyFitPreset(state, ctx, uid2, 0)
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('装上 1 件')
    expect(r.summary).toContain('装备库缺 1 件')
    expect(state.fleet[uid2]!.fitted.high[0]).toBe('mod-gun')
    expect(state.fleet[uid2]!.fitted.high[1]).toBeNull()
    // 先卸光的固有代价：旧装甲已回库（方案凑不齐时结果可能不如套用前）
    expect(countModule(state, 'mod-armor')).toBe(1)
  })

  it('CPU 超预算：超出的件计入"未装"清单（中间态永不超载）', () => {
    const { state, ctx, uid } = world({ cpu: 12 }) // 只够 1 门 10 CPU 的炮
    addModule(state, 'mod-gun', 3)
    place(state, uid, 'high', 0, 'mod-gun')
    place(state, uid, 'high', 1, 'mod-gun')
    place(state, uid, 'high', 2, 'mod-gun')
    expect(saveFitPreset(state, ctx, uid, '三炮').ok).toBe(true)

    const uid2 = addShipToFleet(state, 'sh-fit')
    const r = applyFitPreset(state, ctx, uid2, 0)
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('装上 1 件')
    expect(r.summary).toContain('2 件未装')
    expect(r.summary).toContain('装配超载')
    expect(state.fleet[uid2]!.fitted.high.filter((x) => x === 'mod-gun').length).toBe(1)
  })

  it('方案比船长（数据改动后）：超出的位丢弃，不报错', () => {
    const { state, ctx, uid } = world({ slots: { high: 2, mid: 1, low: 1 } })
    state.fitPresets = {
      'sh-fit': [
        {
          name: '旧方案',
          fitted: { high: ['mod-gun', 'mod-gun', 'mod-gun'], mid: [], low: [] },
        },
      ],
    }
    addModule(state, 'mod-gun', 3)
    const r = applyFitPreset(state, ctx, uid, 0)
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('装上 2 件')
    expect(state.fleet[uid]!.fitted.high).toEqual(['mod-gun', 'mod-gun'])
    expect(countModule(state, 'mod-gun')).toBe(1) // 第三门没被吞
  })

  it('无人机不足：逐条报出（不影响装备那部分）', () => {
    const { state, ctx, uid } = world()
    state.fitPresets = {
      'sh-fit': [
        { name: '机群', fitted: { high: ['mod-gun'], mid: [], low: [] }, droneLoad: { 'drone-x': 5 } },
      ],
    }
    addModule(state, 'mod-gun', 1)
    addWare(state, 'drone-x', 1) // 只够 1 架
    const r = applyFitPreset(state, ctx, uid, 0)
    expect(r.ok).toBe(true)
    expect(r.summary).toContain('装上 1 件')
    expect(r.summary).toContain('无人机未装')
    expect(state.fleet[uid]!.droneLoad).toBeUndefined()
  })
})

describe('装配方案（预设）：锁定与一键卸下', () => {
  it('进洞中的船：保存 / 套用 / 一键卸下全部装备 一律拒绝', () => {
    const { state, ctx, uid } = world()
    place(state, uid, 'high', 0, 'mod-gun')
    state.fitPresets = {
      'sh-fit': [{ name: 'P', fitted: { high: ['mod-gun'], mid: [], low: [] } }],
    }
    state.wormhole = { run: { fleet: [uid] } as never, lastFleetLost: 0 }

    const save = saveFitPreset(state, ctx, uid)
    expect(save.ok).toBe(false)
    expect(save.error).toContain('虫洞')
    expect(applyFitPreset(state, ctx, uid, 0).ok).toBe(false)
    const un = unfitAllModules(state, ctx, uid)
    expect(un.ok).toBe(false)
    expect(un.removed).toBe(0)
    expect(state.fleet[uid]!.fitted.high[0]).toBe('mod-gun') // 一件没动
  })

  it('一键卸下全部装备：件数正确、件回装备库、无人机按机舱整理', () => {
    const { state, ctx, uid } = world()
    addModule(state, 'mod-cpu', 1)
    addModule(state, 'mod-gun', 2)
    addWare(state, 'drone-x', 5)
    expect(fitModule(state, 'mod-cpu', ctx, { shipId: uid, rack: 'low', index: 0 }).ok).toBe(true)
    expect(fitModule(state, 'mod-gun', ctx, { shipId: uid, rack: 'high', index: 0 }).ok).toBe(true)
    expect(adjustDroneLoad(state, ctx, 'drone-x', 3, uid).ok).toBe(true)

    const un = unfitAllModules(state, ctx, uid)
    expect(un.ok).toBe(true)
    expect(un.removed).toBe(2)
    expect(state.fleet[uid]!.fitted.high.every((x) => x === null)).toBe(true)
    expect(state.fleet[uid]!.fitted.low.every((x) => x === null)).toBe(true)
    expect(countModule(state, 'mod-gun')).toBe(2)
    expect(countModule(state, 'mod-cpu')).toBe(1)
    // 全卸本身不动无人机（机舱还在）；再点一次也不报错
    expect(unfitAllModules(state, ctx, uid).removed).toBe(0)
  })
})

describe('装配方案（预设）：存档', () => {
  it('方案随档往返；**没有方案时不落键**（老档逐字一致）', () => {
    const { state, ctx, uid } = world()
    expect(serializeSaveFile(state, 1)).not.toContain('fitPresets')

    place(state, uid, 'high', 0, 'mod-gun')
    expect(saveFitPreset(state, ctx, uid, '主力').ok).toBe(true)
    const back = loadSaveFile(serializeSaveFile(state, 2)).state
    const list = fitPresetsOf(back, 'sh-fit')
    expect(list.length).toBe(1)
    expect(list[0]!.name).toBe('主力')
    expect(list[0]!.fitted.high).toEqual(['mod-gun'])

    // 删空 ⇒ 键整个消失（清洗不留空表 ⇒ 又回到"老档形状"）
    expect(deleteFitPreset(back, 'sh-fit', 0).ok).toBe(true)
    expect(serializeSaveFile(back, 3)).not.toContain('fitPresets')

    // ⚠ 直接压**清洗层**（`normalizeState`）：空表读回来必须是「没有方案」，而不是空对象。
    //   `serializeSaveFile` 走的是内存态、不经过清洗 ⇒ 光靠上面的断言咬不住这一层（负向验证实测）。
    state.fitPresets = {}
    const back2 = loadSaveFile(serializeSaveFile(state, 4)).state
    expect(back2.fitPresets).toBeUndefined()
    expect(serializeSaveFile(back2, 5)).not.toContain('fitPresets')
  })

  it('存档清洗：空名/全空方案丢弃 · **每型截断到 10 条** · 无人机只收正整数', () => {
    const { state } = world()
    /** A..K = 11 条有效（第 11 条 K 必须被截掉）＋ 两条不合规 */
    const valid = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'].map((name) => ({
      name,
      fitted: { high: ['mod-gun'], mid: [], low: [] },
    }))
    state.fitPresets = {
      'sh-fit': [
        { name: '   ', fitted: { high: ['mod-gun'], mid: [], low: [] } }, // 空名 ⇒ 丢
        { name: '空方案', fitted: { high: [], mid: [], low: [] } }, // 全空 ⇒ 丢
        { name: 'A', fitted: { high: ['mod-gun'], mid: [], low: [] }, droneLoad: { 'drone-x': 0 } }, // 0 架 ⇒ 不落 droneLoad
        ...valid.slice(1),
      ],
    } as unknown as GameState['fitPresets']

    const back = loadSaveFile(serializeSaveFile(state, 4)).state
    const list = fitPresetsOf(back, 'sh-fit')
    expect(list.length).toBe(10) // 11 条有效 ⇒ 截到上限 10
    expect(list.map((p) => p.name)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
    expect(list[0]!.droneLoad).toBeUndefined()
    expect(list[0]!.fitted.high).toEqual(['mod-gun'])
  })
})
