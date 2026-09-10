/**
 * 主题彩头追加表（2026-09-08 船长定稿：武器移出主题、仅增幅装备；统一"追加"语义）。
 * 规则：
 * - recycleLoot.modules = 中安主题追加件（加到"直出基础池"上；每卡 ≤1 件、非火力增幅件）；
 * - recycleLoot.mk2 = 低安主题追加件（加到"低安门槛 MK2 池"上；默认 7 件一件不少，仅 sec<0 掷）；
 * - 主题件不得含武器；唯一例外 = 关底穹顶守卫 追加三把 MK3 武器（动能/激光/导弹架）；
 * - 有追加件时引擎整池按均价反比缩放（EV 守恒），content-check 断言区划与白名单。
 */
import type { AnomalyDef } from '@whale/core'

export type RecycleFlavor = {
  recyclePool?: ReadonlyArray<readonly [string, number]>
  recycleNote?: string
  recycleLoot?: { modules?: readonly string[]; mk2?: readonly string[] }
}

/** 主题追加件（18 张 sec<0.5 悬赏；高安与母港系走默认池，无追加） */
export const RECYCLE_LOOT_PILOT: Record<string, RecycleFlavor['recycleLoot']> = {
  // ── 中安（0 ≤ sec < 0.5）：直出基础池追加 1 件非火力增幅件 ──
  'ano-lantern-saboteurs': { modules: ['mod-cargo-2'] }, // 信标猎手：长途货舱
  'ano-haze-ambush': { modules: ['mod-shield-kin-2'] }, // 灰霾伏击：动能护盾增强
  'ano-shard-bandits': { modules: ['mod-miner-2'] }, // 碎晶劫匪：掠夺采集器
  'ano-redring-raiders': { modules: ['mod-armor-plate-2'] }, // 赤潮舰队：装甲增厚
  'ano-ghost-signal': { modules: ['mod-shield-pla-2'] }, // 幽灵舰：能量护盾残影
  'ano-echo-haunt': { modules: ['mod-shield-ext-2'] }, // 回音残舰：护盾扩展
  'ano-mirage-hijackers': { modules: ['mod-gyro-2'] }, // 蜃影劫持：姿态陀螺（机动）
  // ── 低安（sec < 0）：低安门槛 MK2 池追加增幅件（默认 7 件保留）──
  'ano-auro-raiders': { mk2: ['mod-armor-exp-2', 'mod-stab-exp-2'] }, // 奥罗盗匪：高爆甲+高爆稳定
  'ano-abyss-guard': { mk2: ['mod-shield-exp-2', 'mod-armor-plate-2'] }, // 深渊卫队：高爆盾+增厚
  'ano-titan-wreck': { mk2: ['mod-shield-ext-2', 'mod-armor-plate-2'] }, // 泰坦：巨构扩展+增厚（武器清出）
  'ano-cinder-siege': { mk2: ['mod-armor-pla-2', 'mod-stab-pla-2'] }, // 烬火围攻：能量甲+等离子稳定
  'ano-chasm-aberrations': { mk2: ['mod-stab-kin-2', 'mod-armor-exp-2'] }, // 裂谷畸变：动能稳定+高爆甲
  'ano-nadir-static': { mk2: ['mod-rof-2', 'mod-track-2'] }, // 天底封锁：射速+索敌
  'ano-starcore-boss': { mk2: ['mod-drone-tac-2', 'mod-drone-rack-2'] }, // 星髓巢穴：战术导控+甲板扩展（武器清出）
  'ano-maw-hunt': { mk2: ['mod-prop-2', 'mod-gyro-2'] }, // 噬口猎杀：矢量推进+陀螺
  'ano-voidedge-warden': { mk2: ['mod-shield-pla-2', 'mod-rof-2'] }, // 虚海守望：能量盾+射速
  'ano-gravekeeper': { mk2: ['mod-shield-pla-2', 'mod-armor-plate-2'] }, // 坟场守墓：能量盾+增厚
  // 穹顶守卫（关底唯一武器直出点）：门槛池追加三把 MK3 武器（动能/激光/导弹架；不追加装甲——默认池已有）
  'ano-vault-sentinel': { mk2: ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3'] },
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
    // 2026-09-10 重校（基础密度口径变更致本卡档位 险→常：均价须回到 m×常档基数 9.8 = 10.58）
    recyclePool: [['min-tritanium', 11], ['min-pyerite', 20]], // (8×11+12×20)/31 = 10.58
    recycleNote: '碎晶带劫匪残骸：三钛结构料与类银装甲板',
  },
  'ano-redring-raiders': {
    // 2026-09-10 重校（本卡档位 险→危：均价须回到 m×危档基数 92.4 = 104.97）
    recyclePool: [['min-starcore', 6], ['min-nocxium', 56]], // (245×6+90×56)/62 = 105.0
    recycleNote: '赤潮劫掠舰队残骸：星髓晶髓材与超噬矿甲',
  },
  'ano-ghost-signal': {
    // 2026-09-10 重校（本卡档位 险→危：均价须回到 m×危档基数 92.4 = 109.40）
    recyclePool: [['min-starcore', 7], ['min-nocxium', 49]], // (245×7+90×49)/56 = 109.375
    recycleNote: '幽灵舰残骸：星髓晶含量飙升',
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
    // 2026-09-10 重校（本卡档位 危→常：均价须回到 m×常档基数 9.8 = 15.05）
    recyclePool: [['min-pyerite', 13], ['min-mexallon', 8]], // (12×13+20×8)/21 = 15.048
    recycleNote: '烬火围攻残骸：焦壳下的类银与类晶体胶体',
  },
  'ano-chasm-aberrations': {
    // 2026-09-10 重校（本卡档位 危→险：均价须回到 m×险档基数 27.6 = 43.18）
    recyclePool: [['min-isotope', 12], ['min-mexallon', 6]], // (55×12+20×6)/18 = 43.33
    recycleNote: '裂谷畸变体残骸：同位聚晶富集',
  },
  'ano-nadir-static': {
    // 2026-09-10 重校（本卡档位 危→险：均价须回到 m×险档基数 27.6 = 42.74）
    recyclePool: [['min-isotope', 13], ['min-mexallon', 7]], // (55×13+20×7)/20 = 42.75
    recycleNote: '天底封锁残骸：同位聚晶与类晶体胶体',
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

/** 合并进悬赏卡（工厂函数由 anomalies.ts 调用，避免循环依赖） */
export function withRecycleFlavor(def: AnomalyDef): AnomalyDef & RecycleFlavor {
  const f = RECYCLE_FLAVOR[def.id]
  const loot = RECYCLE_LOOT_PILOT[def.id]
  if (!f && !loot) return def
  return { ...def, ...(f ?? {}), recycleLoot: loot ?? f?.recycleLoot }
}
