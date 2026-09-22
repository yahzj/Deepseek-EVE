/**
 * T9 副空间站：分档施工（2026-09-08 船长定：未建成不视为任何站点，不停靠不提供功能）、
 * 现场交付/交付航线、抵达挂点、通讯剧本登记、建成并入空间站清单与"最近空间站"解析。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext, StationSiteDef } from '../src/types'
import { createInitialState } from '../src/state'
import { serializeSaveFile, loadSaveFile, SAVE_FORMAT, MIN_MIGRATABLE_VERSION} from '../src/save'
import {
  deliverStationResources,
  isSiteBuilt,
  onArriveAtGalaxy,
  playDialogue,
  siteProgress,
  tierRemaining,
} from '../src/station'
import { nearestStationGalaxyId, stationGalaxyIds, isAtHomeLike, startSiteDeliverTrip, cancelSiteDeliverTrip } from '../src/location'
import { startRefineRun, startRecycleRun, startUnboxRun, redeemFragments } from '../src/industry'
import { FRAGMENT_RECIPES, wreckItemIdOf } from '../src/salvage'
import { startManufacturing } from '../src/manufacturing'
import { learnBlueprint } from '../src/market'
import { changeShip, repairShip } from '../src/shipyard'
import { advanceGame } from '../src/engine'
import { makeTestCtx } from './helpers'

/** 迷你建站点：挂在 galaxy-far，两档（100 / 150），收 ore-a */
function siteDef(): StationSiteDef {
  return {
    id: 'site-test',
    name: '测试前哨站',
    galaxyId: 'galaxy-far',
    standingReq: 0,
    tiers: [
      { name: '奠基', bill: [{ itemId: 'ore-a', count: 100 }], unlockDesc: '施工推进' },
      { name: '建成', bill: [{ itemId: 'ore-a', count: 150 }], unlockDesc: '建成并入空间站清单' },
    ],
    introDialogueId: 'dlg-intro',
    doneDialogueId: null,
    description: '测试站点',
  }
}

function world() {
  const ctx: SimContext = makeTestCtx({
    stations: [siteDef()],
    quietEvents: true,
    /**
     * 「货柜拆解」的探针货柜（2026-09-21）：位置门排在统一判据之后 ⇒ 要走到那道门必须用**真实存在的
     * 货柜物品**（合成 ctx 默认不含 container；残骸那一路由 `wreckItemIdOf('ano-a')` 现成提供）。
     */
    items: [
      { id: 'box-a', name: '测试货柜', kind: 'container', unitM3: 1, baseSellPriceIsk: 1000, description: '测试货柜' },
    ],
  } as Parameters<typeof makeTestCtx>[0])
  const state: GameState = createInitialState({ nowWallMs: 0, seed: 1 })
  return { state, ctx }
}

describe('T9 建站交付与档位', () => {
  it('未停靠站点不能提交；收料名单外拒绝；提交从仓库扣减并按档累计', () => {
    const { state, ctx } = world()
    state.warehouse.items['ore-a'] = 500
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 50).ok).toBe(false) // 未停靠
    state.dockedSite = 'site-test' // 假装停靠（经 onArriveAtGalaxy 或建成路径设置）
    state.awayGalaxy = null
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-b', 10).ok).toBe(false) // 不收
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 40).ok).toBe(true)
    expect(siteProgress(state, 'site-test').delivered['ore-a']).toBe(40)
    expect(state.warehouse.items['ore-a']).toBe(460)
    expect(tierRemaining(state, ctx.stations.get('site-test')!)).toBe(60)
    // 超额提交被截断到本档需求
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 500).ok).toBe(true)
    expect(siteProgress(state, 'site-test').stage).toBe(1) // 第一档自动结算
    expect(siteProgress(state, 'site-test').delivered).toEqual({})
    expect(state.warehouse.items['ore-a']).toBe(400) // 460 - 60
    expect(tierRemaining(state, ctx.stations.get('site-test')!)).toBe(150)
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(false)
  })

  it('全部档位交付完毕 = 建成（并入空间站清单与最近空间站解析生效）', () => {
    const { state, ctx } = world()
    state.dockedSite = 'site-test'
    state.awayGalaxy = null
    state.warehouse.items['ore-a'] = 1000
    deliverStationResources(state, ctx, 'site-test', 'ore-a', 100)
    deliverStationResources(state, ctx, 'site-test', 'ore-a', 150)
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(true)
    expect(siteProgress(state, 'site-test').stage).toBe(2)
    // 空间站清单 = [母港, galaxy-far]；从 galaxy-far 出发的最近站 = galaxy-far（0 分钟 < 2 分钟回母港）
    expect(stationGalaxyIds(state, ctx)).toContain('galaxy-far')
    expect(nearestStationGalaxyId(state, ctx, 'galaxy-far')).toBe('galaxy-far')
    // 建成后再提交被拒
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 1).ok).toBe(false)
  })

  it('工地现场交付（2026-09-06 玩家反馈修复 + 2026-09-08 收口）：野外停留于站点星系即可提交——无需停靠', () => {
    const { state, ctx } = world()
    state.warehouse.items['ore-a'] = 500
    state.awayGalaxy = 'galaxy-far' // 现场（stage 0：工地不提供停靠，现场交付即可）
    state.dockedSite = null
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 100).ok).toBe(true)
    expect(siteProgress(state, 'site-test').stage).toBe(1) // 首档结算
    expect(state.warehouse.items['ore-a']).toBe(400)
    // 建成前仍不能停靠（不视为站点）：现场继续提交第二档
    state.awayGalaxy = 'galaxy-far'
    state.dockedSite = null
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 150).ok).toBe(true)
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(true)
    // 建成后即可正常停靠
    state.awayGalaxy = null
    state.dockedSite = 'site-test'
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 1).ok).toBe(false) // 已建成拒收
  })

  it('不在工地现场（母港/他处星系/他站）仍不可提交', () => {
    const { state, ctx } = world()
    state.warehouse.items['ore-a'] = 100
    state.awayGalaxy = 'galaxy-hub' // 别处野外
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 10).ok).toBe(false)
    state.awayGalaxy = null
    state.dockedSite = null // 母港
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 10).ok).toBe(false)
    state.dockedSite = 'site-other' // 停在别的副站
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 10).ok).toBe(false)
  })
})

describe('T9 抵达挂点与通讯', () => {
  it('抵达未建成站点星系：一律工地现场野外停留（2026-09-08：未建成不视为站点，不再停靠）+ 自动挂起介绍通讯', () => {
    const { state, ctx } = world()
    onArriveAtGalaxy(state, ctx, 'galaxy-far')
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(state.dockedSite).toBeNull()
    expect(state.pendingDialogue).toBe('dlg-intro')
    // 已读（播放后清待播）再次抵达不重复挂起
    state.pendingDialogue = null
    state.dialogueSeen['dlg-intro'] = true
    onArriveAtGalaxy(state, ctx, 'galaxy-far')
    expect(state.pendingDialogue).toBeNull()
  })

  it('抵达已建成站点星系：直接停靠该站（建成后才视为空间站）', () => {
    const { state, ctx } = world()
    state.warehouse.items['ore-a'] = 1000
    state.awayGalaxy = 'galaxy-far'
    state.dockedSite = null
    deliverStationResources(state, ctx, 'site-test', 'ore-a', 100)
    deliverStationResources(state, ctx, 'site-test', 'ore-a', 150)
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(true)
    state.awayGalaxy = 'galaxy-hub'
    onArriveAtGalaxy(state, ctx, 'galaxy-far')
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBe('site-test')
  })

  it('通讯播放：逐句镜像日志、标记已读并清待播', () => {
    const { state, ctx } = world()
    state.pendingDialogue = 'dlg-intro'
    playDialogue(state, 'dlg-intro', ctx, [
      { speaker: '基建部', text: '第一句' },
      { speaker: '基建部', text: '第二句' },
    ])
    expect(state.dialogueSeen['dlg-intro']).toBe(true)
    expect(state.pendingDialogue).toBeNull()
    const commLogs = state.logs.filter((l) => l.text.startsWith('[通讯]'))
    expect(commLogs).toHaveLength(2)
    expect(commLogs[0]!.text).toContain('第一句')
  })
})

describe('T9 存档（v16.1 兼容字段）', () => {
  it('stationSites/dockedSite/dialogueSeen/pendingDialogue 往返一致且容错', () => {
    const { state, ctx } = world()
    state.stationSites['site-test'] = { stage: 1, delivered: { 'ore-a': 40 } }
    state.dockedSite = 'site-test'
    state.dialogueSeen['dlg-intro'] = true
    state.pendingDialogue = 'dlg-x'
    const loaded = loadSaveFile(serializeSaveFile(state, 0))
    expect(loaded.state.stationSites['site-test']).toEqual({ stage: 1, delivered: { 'ore-a': 40 } })
    expect(loaded.state.dockedSite).toBe('site-test')
    expect(loaded.state.dialogueSeen['dlg-intro']).toBe(true)
    expect(loaded.state.pendingDialogue).toBe('dlg-x')

    const raw = JSON.stringify({
      format: SAVE_FORMAT,
      version: MIN_MIGRATABLE_VERSION,
      savedAtWallMs: 0,
      state: {
        stationSites: {
          a: { stage: 9, delivered: { x: 5, y: 'bad', z: -1 } },
          b: 'junk',
        },
        dockedSite: 42,
        dialogueSeen: { d1: true, d2: false, d3: 'x' },
        pendingDialogue: 'p1',
      },
    })
    const l2 = loadSaveFile(raw)
    expect(l2.state.stationSites['a']).toEqual({ stage: 3, delivered: { x: 5 } })
    expect(l2.state.stationSites['b']).toBeUndefined()
    expect(l2.state.dockedSite).toBeNull()
    expect(l2.state.dialogueSeen).toEqual({ d1: true })
    expect(l2.state.pendingDialogue).toBe('p1')
  })
})

describe('T9 建成副站 = 母港镜像（2026-09-08 船长定：母港功能全可用、共享仓库）', () => {
  function builtWorld() {
    const { state, ctx } = world()
    state.warehouse.items['ore-a'] = 1000
    state.warehouse.items['min-a'] = 10 // 亲自开线探针用（bp-a 的料 + 学会配方）
    state.blueprintStock['bp-a'] = 1
    learnBlueprint(state, ctx, 'bp-a')
    state.dockedSite = 'site-test'
    state.awayGalaxy = null
    deliverStationResources(state, ctx, 'site-test', 'ore-a', 100)
    deliverStationResources(state, ctx, 'site-test', 'ore-a', 150)
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(true)
    return { state, ctx }
  }
  const GATE_HINT = '需停靠空间站（母港或已建成副站）'

  it('isAtHomeLike：母港与已建成副站为真；修建中/野外为假', () => {
    const { state, ctx } = builtWorld()
    expect(isAtHomeLike(state, ctx)).toBe(true) // 已建成副站
    state.dockedSite = null
    expect(isAtHomeLike(state, ctx)).toBe(true) // 母港
    state.dockedSite = 'site-test'
    state.stationSites['site-test'] = { stage: 1, delivered: {} } // 回退成修建中
    expect(isAtHomeLike(state, ctx)).toBe(false)
    state.awayGalaxy = 'galaxy-far'
    state.dockedSite = null
    expect(isAtHomeLike(state, ctx)).toBe(false) // 野外
  })

  it('已建成副站可开精炼炉/残骸回收/组装机/逆向研究（越过母港门，其余校验照常）', () => {
    const { state, ctx } = builtWorld()
    /**
     * ⚠ **2026-09-21 统一批**：位置门现在排在**统一判据（`activityGate`）之后**（停机本身就把舰船带回
     * 空间站 ⇒ 位置门正是被停机满足的），所以"越过母港门"这条要用**真实存在的 id** 才走得到后面
     * （与下面 `redeemFragments` 那条同款处置；探针式假 id 会先撞上"未知物品/未知蓝图"）。
     */
    const r3 = startManufacturing(state, 'bp-a', 'pilot', ctx)
    expect(r3.ok, '已建成副站 + 材料齐 ⇒ 亲自开线应当能开工（位置门确实越过了）').toBe(true)
    const r4 = redeemFragments(state, ctx, 'nope-mod')
    expect(r4.error ?? '').not.toContain(GATE_HINT)
    expect(r4.error).toContain('逆向研究蓝图') // 走到后续校验（没有对应的配方）
  })

  it('修建中工地/野外仍被基地网络门拦截', () => {
    const { state, ctx } = world()
    state.warehouse.items['ore-a'] = 200
    state.warehouse.items['min-a'] = 10 // bp-a 的料 ＋ 学配方（材料/配方校验都排在位置门之前）
    state.blueprintStock['bp-a'] = 1
    learnBlueprint(state, ctx, 'bp-a')
    state.warehouse.items[wreckItemIdOf('ano-a')] = 100 // 残骸（≥ 一批 10 m³）
    state.warehouse.items['box-a'] = 5 // 货柜（拆解探针）
    state.dockedSite = 'site-test'
    state.awayGalaxy = null
    deliverStationResources(state, ctx, 'site-test', 'ore-a', 100) // stage 1（修建中）
    expect(startManufacturing(state, 'bp-a', 'pilot', ctx).error).toContain(GATE_HINT)
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).error).toContain(GATE_HINT)
    expect(startRecycleRun(state, wreckItemIdOf('ano-a'), 'pilot', ctx).error).toContain(GATE_HINT)
    expect(startUnboxRun(state, ctx, 'box-a', 'pilot').error).toContain(GATE_HINT)
    state.awayGalaxy = 'galaxy-far' // 野外
    state.dockedSite = null
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).error).toContain(GATE_HINT)
    expect(startRecycleRun(state, wreckItemIdOf('ano-a'), 'pilot', ctx).error).toContain(GATE_HINT)
  })

  /**
   * **AI 核心驱动的站内工业不看玩家位置**（2026-09-14 船长报障修复）。
   *
   * 船长原话：「玩家正在跑长途运输，但是无法在 AI 指挥中心安排 AI 做事。」
   * 根因：`startRefineRun` / `startRecycleRun` / `startManufacturing` 的"基地网络"门对
   * **AI 核心驱动**也生效，而**长途运输**会把 `awayGalaxy` 记成出发星系（`hauling.setLeg` 单点）
   * ⇒ 跑运输期间整条站内产线都开不了；反观**采矿期间却能开**（`startMining` 会把 `awayGalaxy` 清空）
   * —— 同一类"主控在忙"两个口径。判据已收口到单点 `stationIndustryBlocked`（`location.ts`）：
   * **只有 `worker === 'pilot'`（玩家亲自）才要求在基地网络内**。
   */
  it('**AI 核心驱动的站内工业不看玩家位置**（跑长途运输/远征时照常能开炉开线）· 亲自操作照旧要求停靠', () => {
    const { state, ctx } = world()
    /**
     * ⚠ **2026-09-21 统一批**：位置门排在统一判据之后，所以这里一律用**真实 id + 备好料**
     * （假 id 会先撞"未知物品/未知蓝图"，验不出位置门）。
     */
    state.warehouse.items['ore-a'] = 200
    state.warehouse.items['min-a'] = 10
    state.warehouse.items[wreckItemIdOf('ano-a')] = 100
    state.warehouse.items['box-a'] = 5
    state.blueprintStock['bp-a'] = 1
    learnBlueprint(state, ctx, 'bp-a') // 亲自开线那条：配方校验排在位置门之前，得先学会
    // 现场 = 航行中：`hauling.setLeg` 写下的字段（dockedSite=null + awayGalaxy=出发星系）
    state.dockedSite = null
    state.awayGalaxy = 'galaxy-far'
    // ① AI 核心驱动：越过位置门 ⇒ 报的是"核心上限/库存不足"这类后续原因，不是位置错
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).error ?? '').not.toContain(GATE_HINT)
    expect(startRecycleRun(state, wreckItemIdOf('ano-a'), 'basic', ctx).error ?? '').not.toContain(GATE_HINT)
    expect(startManufacturing(state, 'bp-a', 'basic', ctx).error ?? '').not.toContain(GATE_HINT)
    expect(startUnboxRun(state, ctx, 'box-a', 'basic').error ?? '').not.toContain(GATE_HINT)
    // ② 玩家亲自（worker = 'pilot'）：照旧要求在基地网络内（这条**不能**被上面的放宽带走）
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).error).toContain(GATE_HINT)
    expect(startRecycleRun(state, wreckItemIdOf('ano-a'), 'pilot', ctx).error).toContain(GATE_HINT)
    expect(startManufacturing(state, 'bp-a', 'pilot', ctx).error).toContain(GATE_HINT)
    expect(startUnboxRun(state, ctx, 'box-a', 'pilot').error).toContain(GATE_HINT)
    // ③ 无 worker 参数的玩家动作（逆向研究）：照旧要求在基地网络内
    expect(redeemFragments(state, ctx, Object.keys(FRAGMENT_RECIPES)[0]).error).toContain(GATE_HINT)
    // ④ 修建中工地同理：AI 放行、亲自仍拦（"未建成不视为任何站点"只约束玩家自己那一档）
    state.awayGalaxy = null
    state.dockedSite = 'site-test'
    state.stationSites['site-test'] = { stage: 1, delivered: {} }
    expect(startRefineRun(state, 'ore-a', 'basic', ctx).error ?? '').not.toContain(GATE_HINT)
    expect(startRefineRun(state, 'ore-a', 'pilot', ctx).error).toContain(GATE_HINT)
  })
})

describe('建筑工程学改版（2026-09-08 船长定：建材需求直减每级 −8%）', () => {
  it('满级：两档需求 100/150 → 60/90，实交 150 单位建成（无技能需 250）', () => {
    const { state, ctx } = world()
    state.skills.trained['station-engineering'] = 5
    state.dockedSite = 'site-test'
    state.awayGalaxy = null
    state.warehouse.items['ore-a'] = 500
    expect(tierRemaining(state, ctx.stations.get('site-test')!)).toBe(60) // ceil(100×0.6)
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 60).ok).toBe(true)
    expect(siteProgress(state, 'site-test').stage).toBe(1)
    expect(state.warehouse.items['ore-a']).toBe(440)
    expect(tierRemaining(state, ctx.stations.get('site-test')!)).toBe(90) // ceil(150×0.6)
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 90).ok).toBe(true)
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(true)
    expect(state.warehouse.items['ore-a']).toBe(350) // 实耗 150
  })

  it('旧档兼容：已缴虚高（旧计件放大口径写入）≥ 新需求时，下次提交自动结算推进', () => {
    const { state, ctx } = world()
    state.skills.trained['station-engineering'] = 5
    state.dockedSite = 'site-test'
    state.awayGalaxy = null
    state.warehouse.items['ore-a'] = 500
    // 模拟旧档：第一档（新需求 60）delivered 虚高到 70（旧 ×1.4 计件放大写入），档位未推进
    state.stationSites['site-test'] = { stage: 0, delivered: { 'ore-a': 70 } }
    expect(tierRemaining(state, ctx.stations.get('site-test')!)).toBe(0)
    expect(deliverStationResources(state, ctx, 'site-test', 'ore-a', 1).ok).toBe(true)
    expect(siteProgress(state, 'site-test').stage).toBe(1) // 自动结算到第二档（虚高已缴未入新档）
    expect(siteProgress(state, 'site-test').delivered).toEqual({ 'ore-a': 1 }) // 本次 1 单位记入新档
  })
})

/* ═══════════ 2026-09-08 建站交付航线 v2（船长定稿：出发装载→到点清货仓→自动多趟循环）+ 未建成收口 ═══════════ */

describe('建站交付航线 v2（2026-09-08 船长定稿：物理载货 + 自动循环）', () => {
  /** debugQuick：星系际航程固定 1 秒；capacity 可把小船货仓压小以制造多趟 */
  function tripWorld(oreInWare: number, capacity?: number) {
    const { state, ctx } = world()
    state.debugQuick = true
    state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
    state.warehouse.items['ore-a'] = oreInWare
    if (capacity !== undefined) {
      const defId = state.fleet[state.shipId]!.defId
      const def = defId ? ctx.ships.get(defId) : undefined
      if (def) (def as { cargoM3: number }).cargoM3 = capacity
    }
    return { state, ctx }
  }

  const cargo = (state: GameState): Record<string, number> => state.fleet[state.shipId]!.cargo

  it('前置校验：野外/作业/未探明/仓库无料/货仓满载均拒发；出发即把仓库建材装入货仓', () => {
    const { state, ctx } = tripWorld(0, 60)
    state.awayGalaxy = 'galaxy-far' // 野外
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(false)
    state.awayGalaxy = null
    state.exploredGalaxies = ['galaxy-hub'] // 未探明
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(false)
    state.exploredGalaxies = ['galaxy-hub', 'galaxy-far']
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(false) // 仓库无料
    state.warehouse.items['ore-a'] = 10
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(true)
    expect(state.awayGalaxy).toBe('galaxy-hub') // 出发星系 = 出发地（航行中不视为站内）
    expect(state.dockedSite).toBeNull()
    expect(state.transit.delivery).toEqual({ siteId: 'site-test', phase: 'to-site', loaded: { 'ore-a': 10 } })
    expect(state.warehouse.items['ore-a']).toBeUndefined() // 仓库建材已随船装走
    expect(cargo(state)['ore-a']).toBe(10)
    // 货仓满载（空容积 0）→ 拒绝
    const { state: s2, ctx: c2 } = tripWorld(10, 0)
    expect(startSiteDeliverTrip(s2, c2, 'site-test').ok).toBe(false)
  })

  it('端到端：出发装货 → 到点只清空本趟装载（不碰仓库）→ 返港后仓库耗尽 → 终止并写一次性提示', () => {
    const { state, ctx } = tripWorld(120) // 首档 100 + 档 2 并入 20
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(true)
    expect(cargo(state)['ore-a']).toBe(120)
    advanceGame(state, 900, ctx) // 去程未到点：货物仍在船
    expect(state.transit.active).toBe(true)
    expect(cargo(state)['ore-a']).toBe(120)
    advanceGame(state, 200, ctx) // 到点：清货仓交付 100 → 档 1；余 20 并入档 2 → 自动返航
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(siteProgress(state, 'site-test').stage).toBe(1)
    expect(cargo(state)['ore-a']).toBeUndefined() // 货仓已清空
    expect(state.warehouse.items['ore-a']).toBeUndefined() // 全程不补扣仓库
    expect(siteProgress(state, 'site-test').delivered).toEqual({ 'ore-a': 20 })
    expect(state.transit.delivery!.phase).toBe('to-station')
    advanceGame(state, 2_000, ctx) // 返程到港：回母港；仓库无料 → 循环终止 + 一次性提示
    expect(state.transit.active).toBe(false)
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBeNull()
    expect(state.deliveryNotice ?? '').toContain('交付循环已结束')
    expect(state.deliveryNotice ?? '').toContain('还差 130')
    expect(state.logs.some((l) => l.text.includes('交付循环已结束'))).toBe(true)
  })

  it('仓库足量一次建成：装载上限 = 全站剩余需求 → 到点清仓全部档位 → 就地停靠新落成的副站', () => {
    const { state, ctx } = tripWorld(500)
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(true)
    expect(cargo(state)['ore-a']).toBe(250) // 上限 = 全站需求 100+150，不多装
    expect(state.warehouse.items['ore-a']).toBe(250)
    advanceGame(state, 1_100, ctx) // 去程到点（1000ms）+ 余量
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(true)
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBe('site-test')
    expect(state.transit.active).toBe(false)
    expect(state.warehouse.items['ore-a']).toBe(250) // 只消耗随船 250
    expect(state.logs.some((l) => l.text.includes('达成「建成」'))).toBe(true)
  })

  it('自动多趟（小货仓 60）：装 60→清 60→返航→再装…直到建成，全程无需玩家操作', () => {
    const { state, ctx } = tripWorld(250, 60) // 全站需求 250、单趟只能装 60 → 5 趟
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(true)
    let guard = 0
    while (!isSiteBuilt(state, ctx.stations.get('site-test')!) && guard++ < 40) {
      advanceGame(state, 1_500, ctx)
    }
    expect(isSiteBuilt(state, ctx.stations.get('site-test')!)).toBe(true)
    expect(state.warehouse.items['ore-a']).toBeUndefined() // 250 全部运抵
    expect(cargo(state)['ore-a']).toBeUndefined()
    const departures = state.logs.filter((l) => l.text.startsWith('⚑ 建站交付航线：舰船自')).length
    expect(departures).toBe(5)
    expect(state.transit.active).toBe(false)
  })

  it('途中取消（去程）：无惩罚、停止循环不再自动续趟、本趟装载随进港卸回仓库', () => {
    const { state, ctx } = tripWorld(200)
    expect(startSiteDeliverTrip(state, ctx, 'site-test').ok).toBe(true)
    advanceGame(state, 300, ctx) // 仍在途
    const r = cancelSiteDeliverTrip(state, ctx)
    expect(r.ok).toBe(true)
    expect(state.transit.active).toBe(false)
    expect(state.transit.delivery).toBeNull()
    expect(state.awayGalaxy).toBeNull()
    expect(state.dockedSite).toBeNull() // 出发站 = 母港
    expect(state.stationSites['site-test']).toBeUndefined() // 未交付任何建材
    expect(state.warehouse.items['ore-a']).toBe(200) // 装载随进港卸回仓库
    expect(state.logs.some((l) => l.text.includes('已停止交付循环'))).toBe(true)
    advanceGame(state, 10_000, ctx) // 不自动续趟
    expect(state.transit.active).toBe(false)
    expect(state.logs.filter((l) => l.text.startsWith('⚑ 建站交付航线：舰船自')).length).toBe(1)
  })

  it('取消前置：无在途交付航线时拒绝', () => {
    const { state, ctx } = tripWorld(200)
    expect(cancelSiteDeliverTrip(state, ctx).ok).toBe(false)
  })
})

describe('未建成副站彻底收口（2026-09-08 船长定：不视为任何站点）', () => {
  it('reconcileDockSanity：停靠未建成/未知站点 → 纠正为工地现场野外停留（幂等、只记一次日志）', () => {
    const { state, ctx } = world()
    state.awayGalaxy = null
    state.dockedSite = 'site-test' // 旧档残留（stage 0）
    advanceGame(state, 1, ctx) // 引擎逐 tick 校正
    expect(state.dockedSite).toBeNull()
    expect(state.awayGalaxy).toBe('galaxy-far')
    expect(state.logs.filter((l) => l.text.includes('尚未建成'))).toHaveLength(1)
    advanceGame(state, 1, ctx)
    expect(state.logs.filter((l) => l.text.includes('尚未建成'))).toHaveLength(1) // 幂等：不再重复
    // 未知站点 id → 回母港
    state.dockedSite = 'site-ghost'
    state.awayGalaxy = null
    advanceGame(state, 1, ctx)
    expect(state.dockedSite).toBeNull()
    expect(state.awayGalaxy).toBe('galaxy-hub')
  })

  it('维修/换驾驶在"停靠"未建成站点时被拒（即使状态残留，服务按建成收口）', () => {
    const { state, ctx } = world()
    state.dockedSite = 'site-test'
    state.awayGalaxy = null
    // 换驾驶：造第二艘同型船
    state.fleet['ship-b'] = { ...state.fleet[state.shipId]! }
    expect(changeShip(state, 'ship-b', ctx).ok).toBe(false)
    expect(changeShip(state, 'ship-b', ctx).error).toContain('尚未建成')
    // 维修（当前驾驶船，故意受损）
    state.fleet[state.shipId]!.durability = 0.4
    const r = repairShip(state, state.shipId, ctx)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('尚未建成')
    // 建成后放行到后续校验（不再报位置错；钱够则直接修好，不够则只报费用不足）
    state.stationSites['site-test'] = { stage: 2, delivered: {} } // 两档全满 = 建成
    const r2 = repairShip(state, state.shipId, ctx)
    if (!r2.ok) expect(r2.error).not.toContain('尚未建成')
  })
})
