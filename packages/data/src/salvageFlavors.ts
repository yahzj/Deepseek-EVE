export type RecycleFlavor = {
  recyclePool?: ReadonlyArray<readonly [string, number]>
  recycleNote?: string
  recycleLoot?: { modules?: readonly string[]; mk2?: readonly string[] }
}

export const RECYCLE_LOOT_PILOT: Record<string, RecycleFlavor['recycleLoot']> = {
  'ano-lantern-saboteurs': { modules: ['mod-cargo-2'] },
  'ano-haze-ambush': { modules: ['mod-shield-kin-2'] },
  'ano-shard-bandits': { modules: ['mod-miner-2'] },
  'ano-redring-raiders': { modules: ['mod-armor-plate-2'] },
  'ano-ghost-signal': { modules: ['mod-shield-pla-2'] },
  'ano-mirage-hijackers': { mk2: ['mod-gyro-2', 'mod-armor-pla-2'] },
  'ano-echo-haunt': { mk2: ['mod-shield-ext-2'] },
  'ano-auro-raiders': { mk2: ['mod-armor-exp-2', 'mod-stab-exp-2'] },
  'ano-abyss-guard': { mk2: ['mod-shield-exp-2', 'mod-armor-plate-2'] },
  'ano-titan-wreck': { mk2: ['mod-shield-ext-2', 'mod-armor-plate-2'] },
  'ano-core-section': { mk2: ['mod-drone-tac-2', 'mod-armor-plate-2'] },
  'ano-cinder-siege': { mk2: ['mod-armor-pla-2'] },
  'ano-chasm-aberrations': { mk2: ['mod-stab-kin-2', 'mod-armor-exp-2'] },
  'ano-nadir-static': { mk2: ['mod-rof-2', 'mod-track-2'] },
  'ano-starcore-boss': { mk2: ['mod-drone-tac-2', 'mod-drone-rack-2'] },
  'ano-maw-hunt': { mk2: ['mod-prop-2', 'mod-gyro-2'] },
  'ano-voidedge-warden': { mk2: ['mod-shield-pla-2', 'mod-rof-2'] },
  'ano-gravekeeper': { mk2: ['mod-shield-pla-2', 'mod-armor-plate-2'] },
  'ano-vault-sentinel': { mk2: ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3'] },
  'ink-harass': { modules: ['mod-shield-pla-2'] },
  'ink-raid': { modules: ['mod-shield-pla-2'] },
  'ink-main': { modules: ['mod-shield-pla-2'] },
  'ink-flagship': { modules: ['mod-shield-pla-2'] },
  'corona-drift': { modules: ['mod-shield-pla-2'] },
  'corona-split': { modules: ['mod-shield-pla-2'] },
  'corona-converge': { modules: ['mod-shield-pla-2'] },
  'corona-nexus': { modules: ['mod-shield-pla-2'] },
  'gravekeeper-drift': { modules: ['mod-shield-pla-2'] },
  'gravekeeper-line': { modules: ['mod-shield-pla-2'] },
  'gravekeeper-main': { modules: ['mod-shield-pla-2'] },
  'gravekeeper-flagship': { modules: ['mod-shield-pla-2'] },
  'alien-vanguard': { modules: ['mod-armor-plate-2'] },
  'alien-escort': { modules: ['mod-armor-plate-2'] },
  'alien-main': { modules: ['mod-armor-plate-2'] },
  'alien-broodmother': { modules: ['mod-armor-plate-2'] },
}

export const RECYCLE_FLAVOR: Record<string, RecycleFlavor> = {
  'ano-harbor-escort': {
    recyclePool: [['min-pyerite', 55], ['min-tritanium', 45]],
    recycleNote: '商路护航队残骸：银纹超金属为主，夹少量钛钢结构料',
  },
  'ano-pirate-post': {
    recyclePool: [['min-pyerite', 57], ['min-tritanium', 43]],
    recycleNote: '边境海盗前哨残骸：银纹超金属为主',
  },
  'ano-abandoned-platform': {
    recyclePool: [['min-mexallon', 20], ['min-tritanium', 80]],
    recycleNote: '旧工业平台残骸：晶态胶体偏多',
  },
  'ano-lantern-saboteurs': {
    recyclePool: [['min-mexallon', 22], ['min-tritanium', 78]],
    recycleNote: '信标猎手残骸：晶态胶体与钛钢结构料',
  },
  'ano-haze-ambush': {
    recyclePool: [['min-mexallon', 24], ['min-tritanium', 76]],
    recycleNote: '灰霾伏击团残骸：晶态胶体偏多',
  },
  'ano-shard-bandits': {
    recyclePool: [['min-tritanium', 40], ['min-pyerite', 58], ['min-mexallon', 2]],
    recycleNote: '碎晶带劫匪残骸：钛钢结构料与银纹装甲板',
  },
  'ano-redring-raiders': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 31], ['min-nocxium', 29]],
    recycleNote: '赤潮劫掠舰队残骸：星髓晶髓材与重钨合金甲',
  },
  'ano-ghost-signal': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '幽灵舰残骸：星髓晶含量飙升',
  },
  'ano-echo-haunt': {
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]],
    recycleNote: '回音残舰残骸：冥铁合金与同位聚晶为主',
  },
  'ano-mirage-hijackers': {
    recyclePool: [['min-tritanium', 40], ['min-isotope', 40], ['min-nocxium', 20]],
    recycleNote: '蜃影劫持者残骸：同位聚晶富集',
  },
  'ano-auro-raiders': {
    recyclePool: [['min-tritanium', 40], ['min-mexallon', 4], ['min-isotope', 9], ['min-starcore', 47]],
    recycleNote: '奥罗武装残骸：巨构残片里的星髓晶与同位聚晶',
  },
  'ano-abyss-guard': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 56], ['min-nocxium', 4]],
    recycleNote: '深渊守卫残骸：星髓晶髓材为主，夹少量重钨合金',
  },
  'ano-titan-wreck': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 47], ['min-isotope', 13]],
    recycleNote: '泰坦残骸：星髓晶浓度极高',
  },
  'ano-core-section': {
    recyclePool: [['min-tritanium', 40], ['min-isotope', 10], ['min-starcore', 50]],
    recycleNote: '巨构核心残骸：星髓晶整块未裂，同位聚晶成脉',
  },
  'ano-cinder-siege': {
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]],
    recycleNote: '烬火围攻残骸：冥铁合金与同位聚晶为主',
  },
  'ano-chasm-aberrations': {
    recyclePool: [['min-tritanium', 40], ['min-isotope', 3], ['min-starcore', 57]],
    recycleNote: '裂谷畸变体残骸：星髓晶富集，夹少量同位聚晶',
  },
  'ano-nadir-static': {
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]],
    recycleNote: '天底封锁残骸：冥铁合金与同位聚晶为主',
  },
  'ano-starcore-boss': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 58], ['min-isotope', 2]],
    recycleNote: '星髓虫群残骸：星髓晶为主——名副其实',
  },
  'ano-maw-hunt': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 47], ['min-isotope', 7], ['min-darkiron', 6]],
    recycleNote: '噬口猎杀残骸：星髓晶重富集，夹冥铁合金',
  },
  'ano-voidedge-warden': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 47], ['min-isotope', 7], ['min-darkiron', 6]],
    recycleNote: '虚海守望者残骸：星髓晶重富集，夹冥铁合金',
  },
  'ano-gravekeeper': {
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]],
    recycleNote: '坟场守墓舰残骸：冥铁合金残片',
  },
  'ano-vault-sentinel': {
    recyclePool: [['min-tritanium', 40], ['min-darkiron', 19], ['min-isotope', 41]],
    recycleNote: '穹顶守卫残骸：冥铁合金残片',
  },
  'ink-harass': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '墨潮帮骚扰舰队残骸：星髓晶与重钨合金为主',
  },
  'ink-raid': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '墨潮帮袭击舰队残骸：星髓晶与重钨合金为主',
  },
  'ink-main': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '墨潮帮主力舰队残骸：星髓晶与重钨合金为主',
  },
  'ink-flagship': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '墨潮旗舰部队残骸：星髓晶与重钨合金为主',
  },
  'corona-drift': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '光环游弋集群残骸：星髓晶与重钨合金为主',
  },
  'corona-split': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '光环分光集群残骸：星髓晶与重钨合金为主',
  },
  'corona-converge': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '光环汇聚集群残骸：星髓晶与重钨合金为主',
  },
  'corona-nexus': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '光环中枢卫队残骸：星髓晶与重钨合金为主',
  },
  'gravekeeper-drift': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '守墓者巡哨舰队残骸：星髓晶与重钨合金为主',
  },
  'gravekeeper-line': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '守墓者碑卫舰队残骸：星髓晶与重钨合金为主',
  },
  'gravekeeper-main': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '守墓者守誓舰队残骸：星髓晶与重钨合金为主',
  },
  'gravekeeper-flagship': {
    recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]],
    recycleNote: '守墓者永陵舰队残骸：星髓晶与重钨合金为主',
  },
  'alien-vanguard': { recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]], recycleNote: '异形生物残骸：星髓晶与重钨合金为主' },
  'alien-escort': { recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]], recycleNote: '异形生物残骸：星髓晶与重钨合金为主' },
  'alien-main': { recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]], recycleNote: '异形生物残骸：星髓晶与重钨合金为主' },
  'alien-broodmother': { recyclePool: [['min-tritanium', 40], ['min-starcore', 34], ['min-nocxium', 26]], recycleNote: '异形生物残骸：星髓晶与重钨合金为主' },
}

