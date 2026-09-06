/**
 * B3.1 敌群特色残骸产出表（2026-09-06 船长确认方向，数值草表 docs/design/b3-flavor-content.md）。
 * 规则：保底目标乘数 m = mSec × mThreat（sec 溢价 ≤1.45 × 威胁 ≤1.3，顶格 1.89）；
 * 每卡 recyclePool = 同档 2 主矿权重，池均价 ≈ m×档基数 ±3%（content-check 断言）。
 * note = 玩家可见“残骸产出倾向”一句话；loot = 试点彩头可出件集（可选，缺省走三层默认）。
 */
import type { AnomalyDef } from '@whale/core'

/** 按悬赏卡 id 合并进悬赏卡定义（context 构建时 spread 进 ANOMALIES 条目） */
export type RecycleFlavor = {
  recyclePool?: ReadonlyArray<readonly [string, number]>
  recycleNote?: string
  recycleLoot?: { modules?: readonly string[]; mk2?: readonly string[] }
}

export const RECYCLE_FLAVOR: Record<string, RecycleFlavor> = {
  'ano-harbor-escort': {
    recyclePool: [['min-pyerite', 55], ['min-tritanium', 45]],
    recycleNote: '商路护航队残骸：类银超金属为主，夹少量三钛结构料',
  },
  'ano-pirate-post': {
    recyclePool: [['min-pyerite', 57], ['min-tritanium', 43]],
    recycleNote: '边境海盗前哨残骸：类银超金属为主',
  },
  'ano-abandoned-platform': {
    recyclePool: [['min-mexallon', 20], ['min-tritanium', 80]],
    recycleNote: '旧工业平台残骸：类晶体胶体偏多',
  },
  'ano-lantern-saboteurs': {
    recyclePool: [['min-mexallon', 22], ['min-tritanium', 78]],
    recycleNote: '信标猎手残骸：类晶体胶体与三钛结构料',
  },
  'ano-haze-ambush': {
    recyclePool: [['min-mexallon', 24], ['min-tritanium', 76]],
    recycleNote: '灰霾伏击团残骸：类晶体胶体偏多',
  },
  'ano-shard-bandits': {
    recyclePool: [['min-nocxium', 14], ['min-mexallon', 86]],
    recycleNote: '碎晶带劫匪残骸：晶体胶体中裹着超噬矿镀层',
  },
  'ano-redring-raiders': {
    recyclePool: [['min-nocxium', 16], ['min-mexallon', 84]],
    recycleNote: '赤潮劫掠舰队残骸：超噬矿与胶体合金',
  },
  'ano-ghost-signal': {
    recyclePool: [['min-nocxium', 18], ['min-mexallon', 82]],
    recycleNote: '幽灵舰残骸：超噬矿含量升高',
  },
  'ano-echo-haunt': {
    recyclePool: [['min-isotope', 38], ['min-mexallon', 62]],
    recycleNote: '回音残舰残骸：同位聚晶富集',
  },
  'ano-mirage-hijackers': {
    recyclePool: [['min-isotope', 37], ['min-mexallon', 63]],
    recycleNote: '蜃影劫持者残骸：同位聚晶富集',
  },
  'ano-auro-raiders': {
    recyclePool: [['min-nocxium', 25], ['min-mexallon', 75]],
    recycleNote: '奥罗武装残骸：超噬矿重镀层',
  },
  'ano-abyss-guard': {
    recyclePool: [['min-starcore', 34], ['min-nocxium', 66]],
    recycleNote: '深渊守卫残骸：星髓晶髓材与超噬矿甲',
  },
  'ano-titan-wreck': {
    recyclePool: [['min-starcore', 50], ['min-isotope', 50]],
    recycleNote: '泰坦残骸：星髓晶浓度极高',
  },
  'ano-cinder-siege': {
    recyclePool: [['min-starcore', 46], ['min-isotope', 54]],
    recycleNote: '烬火围攻残骸：余烬中的星髓晶',
  },
  'ano-chasm-aberrations': {
    recyclePool: [['min-starcore', 47], ['min-isotope', 53]],
    recycleNote: '裂谷畸变体残骸：星髓晶富集',
  },
  'ano-nadir-static': {
    recyclePool: [['min-starcore', 47], ['min-isotope', 53]],
    recycleNote: '天底封锁残骸：星髓晶富集',
  },
  'ano-starcore-boss': {
    recyclePool: [['min-starcore', 48], ['min-isotope', 52]],
    recycleNote: '星髓巢穴残骸：星髓晶为主——名副其实',
  },
  'ano-maw-hunt': {
    recyclePool: [['min-starcore', 60], ['min-isotope', 40]],
    recycleNote: '噬口猎杀残骸：星髓晶重富集',
  },
  'ano-voidedge-warden': {
    recyclePool: [['min-starcore', 60], ['min-isotope', 40]],
    recycleNote: '虚海守望者残骸：星髓晶重富集',
  },
  'ano-gravekeeper': {
    recyclePool: [['min-darkiron', 17], ['min-isotope', 83]],
    recycleNote: '坟场守墓舰残骸：冥铁合金残片',
  },
  'ano-vault-sentinel': {
    recyclePool: [['min-darkiron', 17], ['min-isotope', 83]],
    recycleNote: '穹顶守卫残骸：冥铁合金残片',
  },
}

/** 试点彩头可出件（6 卡：星髓巢穴/坟场/穹顶/深渊·泰坦/碎晶带/灰霾带）——件集掉率按均价自动缩放 */
export const RECYCLE_LOOT_PILOT: Record<string, RecycleFlavor['recycleLoot']> = {
  'ano-starcore-boss': { modules: ['mod-turret-kin-2', 'mod-laser-2', 'mod-drone-tac-2'], mk2: ['mod-drone-tac-2'] },
  'ano-gravekeeper': { modules: ['mod-armor-kin-2', 'mod-shield-kin-2'], mk2: ['mod-armor-kin-2'] },
  'ano-vault-sentinel': { modules: ['mod-armor-kin-2', 'mod-armor-kin-3'], mk2: ['mod-armor-kin-3'] },
  'ano-titan-wreck': { modules: ['mod-turret-kin-3', 'mod-missile-2'], mk2: ['mod-turret-kin-3'] },
  'ano-shard-bandits': { modules: ['mod-laser-2', 'mod-missile-2'], mk2: ['mod-laser-2'] },
  'ano-haze-ambush': { modules: ['mod-missile-2', 'mod-turret-kin-2'], mk2: ['mod-missile-2'] },
}

/** 合并进悬赏卡（工厂函数由 anomalies.ts 调用，避免循环依赖） */
export function withRecycleFlavor(def: AnomalyDef): AnomalyDef & RecycleFlavor {
  const f = RECYCLE_FLAVOR[def.id]
  const loot = RECYCLE_LOOT_PILOT[def.id]
  if (!f && !loot) return def
  return { ...def, ...(f ?? {}), recycleLoot: loot ?? f?.recycleLoot }
}
