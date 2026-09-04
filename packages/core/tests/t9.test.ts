/**
 * T9 副空间站：分档交付（边交边生效）、停靠/抵达挂点、通讯剧本登记、
 * 建成并入空间站清单与"最近空间站"解析。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import type { SimContext, StationSiteDef } from '../src/types'
import { createInitialState } from '../src/state'
import { serializeSaveFile, loadSaveFile, SAVE_FORMAT } from '../src/save'
import {
  deliverStationResources,
  isSiteBuilt,
  onArriveAtGalaxy,
  playDialogue,
  siteProgress,
  tierRemaining,
} from '../src/station'
import { nearestStationGalaxyId, stationGalaxyIds } from '../src/location'
import { makeTestCtx } from './helpers'

/** 迷你建站点：挂在 galaxy-far，两档（100 / 150），收 ore-a */
function siteDef(): StationSiteDef {
  return {
    id: 'site-test',
    name: '测试前哨站',
    galaxyId: 'galaxy-far',
    standingReq: 0,
    acceptItemIds: ['ore-a'],
    tiers: [
      { name: '奠基', count: 100, unlockDesc: '可停靠卸货' },
      { name: '建成', count: 150, unlockDesc: '并入空间站清单' },
    ],
    introDialogueId: 'dlg-intro',
    doneDialogueId: null,
    description: '测试站点',
  }
}

function world() {
  const ctx: SimContext = makeTestCtx({ stations: [siteDef()], quietEvents: true })
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
})

describe('T9 抵达挂点与通讯', () => {
  it('抵达未奠基站点星系：野外工地停留 + 自动挂起介绍通讯（已读后不再自动挂）', () => {
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

  it('抵达已奠基站点星系：直接停靠该站（不再野外停留）', () => {
    const { state, ctx } = world()
    state.stationSites['site-test'] = { stage: 1, delivered: {} }
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
      version: 16,
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
