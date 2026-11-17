import foeMountsParameters from '../static/foeMounts.json'
import { enemyParameterOf } from './enemyParameters'
import type { FoeMountDef, FoeMountId } from '../types'

export const FOE_MOUNT_IDS = {
  acidShield: 'foe-mount-c-acid-shield',
  acidCharge: 'foe-mount-c-acid-charge',
  hivebackCharge: 'foe-mount-c-hiveback-charge',
  broodmotherCharge: 'foe-mount-c-broodmother-charge',
  broodControl: 'foe-mount-c-brood-control',
  hivebackHatchery: 'foe-mount-c-hiveback-hatchery',
  broodmotherHatchery: 'foe-mount-c-broodmother-hatchery',
  chargePirate: 'foe-mount-charge-pirate',
  chargeSwarmT1: 'foe-mount-charge-swarm-t1',
  chargeSwarmT2: 'foe-mount-charge-swarm-t2',
  chargeSwarmT3: 'foe-mount-charge-swarm-t3',
  chargeSwarmT4: 'foe-mount-charge-swarm-t4',
  droneRangeX4: 'foe-mount-drone-range-x4',
  gunRangeX15: 'foe-mount-gun-range-x1-5',
  gunRangeX15Titan: 'foe-mount-titan-range-x1-5',
  captureWeb: 'foe-mount-capture-web',
  supportCall: 'foe-mount-support-call',
  gyroStabilizer: 'foe-mount-gyro-stabilizer',
  hullRepair: 'foe-mount-hull-repair',
  reviveEscort: 'foe-mount-revive-escort',
  inkRangeDebuff: 'foe-mount-ink-range-debuff',
  dRangeDebuff: 'foe-mount-d-range-debuff',
  coronaOverlayDrive: 'foe-mount-corona-overlay-drive',
  coronaFlashOverload: 'foe-mount-corona-flash-overload',
  coronaBlink: 'foe-mount-corona-blink',
  coronaStandbyShield: 'foe-mount-corona-standby-shield',
  coronaFocusArray: 'foe-mount-corona-focus-array',
  coronaOverlayBeacon: 'foe-mount-corona-overlay-beacon',
  dRebirthProtocol: 'foe-mount-d-rebirth-protocol',
  dMausoleumArmor: 'foe-mount-d-mausoleum-armor',
  dCoatingArmor: 'foe-mount-d-coating-armor',
  dShieldCapacitor: 'foe-mount-d-shield-capacitor',
  dReconstruction: 'foe-mount-d-reconstruction',
} as const

export const FOE_MOUNTS: Readonly<Record<FoeMountId, FoeMountDef>> = {
  'foe-mount-c-acid-shield': { id: 'foe-mount-c-acid-shield', name: '酸液破盾腔', acidShieldDamageMul: enemyParameterOf(foeMountsParameters, 'foe-mount-c-acid-shield', 'acidShieldDamageMul') },
  'foe-mount-c-acid-charge': { id: 'foe-mount-c-acid-charge', name: '爆虫冲锋器', en: 'Acid Burster Charger', charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-c-acid-charge", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-c-acid-charge", "charge_cooldownMs"), webImmune: true } },
  'foe-mount-c-hiveback-charge': { id: 'foe-mount-c-hiveback-charge', name: '背巢缓冲锋器', en: 'Hiveback Charger', charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-c-hiveback-charge", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-c-hiveback-charge", "charge_cooldownMs"), webImmune: true } },
  'foe-mount-c-broodmother-charge': { id: 'foe-mount-c-broodmother-charge', name: '巢母缓冲锋器', en: 'Broodmother Charger', charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-c-broodmother-charge", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-c-broodmother-charge", "charge_cooldownMs"), webImmune: true } },
  'foe-mount-c-brood-control': { id: 'foe-mount-c-brood-control', name: '巢群导控腔', en: 'Brood Control Chamber', broodControl: { gunDmgMul: enemyParameterOf(foeMountsParameters, "foe-mount-c-brood-control", "broodControl_gunDmgMul"), droneDmgMul: enemyParameterOf(foeMountsParameters, "foe-mount-c-brood-control", "broodControl_droneDmgMul"), droneRangeBonusPct: enemyParameterOf(foeMountsParameters, "foe-mount-c-brood-control", "broodControl_droneRangeBonusPct") } },
  'foe-mount-c-hiveback-hatchery': { id: 'foe-mount-c-hiveback-hatchery', name: '虫群孵化巢', en: 'Brood Hatchery', hatchery: { cycleMs: enemyParameterOf(foeMountsParameters, "foe-mount-c-hiveback-hatchery", "hatchery_cycleMs"), stock: enemyParameterOf(foeMountsParameters, "foe-mount-c-hiveback-hatchery", "hatchery_stock"), fleet: true } },
  'foe-mount-c-broodmother-hatchery': {
    id: 'foe-mount-c-broodmother-hatchery', name: '巢母孵化巢', en: 'Broodmother Hatchery',
    hatchery: { cycleMs: enemyParameterOf(foeMountsParameters, "foe-mount-c-broodmother-hatchery", "hatchery_cycleMs"), stock: 'unlimited', fleet: true },
    summonEscort: { everyMs: enemyParameterOf(foeMountsParameters, "foe-mount-c-broodmother-hatchery", "summonEscort_everyMs"), count: enemyParameterOf(foeMountsParameters, "foe-mount-c-broodmother-hatchery", "summonEscort_count"), shipId: 'foe-alien-starcore-adult', activeClock: true },
    fleetSpeedRamp: { rampMs: enemyParameterOf(foeMountsParameters, "foe-mount-c-broodmother-hatchery", "fleetSpeedRamp_rampMs"), maxBonusPct: enemyParameterOf(foeMountsParameters, "foe-mount-c-broodmother-hatchery", "fleetSpeedRamp_maxBonusPct") },
  },
  [FOE_MOUNT_IDS.chargePirate]: {
    id: FOE_MOUNT_IDS.chargePirate,
    name: '劫掠冲锋推进器',
    en: 'Raider Charge Thruster',
    charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-charge-pirate", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-charge-pirate", "charge_cooldownMs") },
    note:
      '船长 2026-09-16：「给A族虫洞内的海盗添加冲锋…冲锋倍率为1.6，冷却30秒」⇒ 只挂洞内三张 A 族卡的条目' +
      '（劫掠支队 / 劫掠围猎 / 海盗战团）；三条舰级洞外（低安遭遇 / 悬赏）也在用 ⇒ 洞外不冲锋。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT1]: {
    id: FOE_MOUNT_IDS.chargeSwarmT1,
    name: '虫群冲锋器 T1',
    en: 'Hiveswarm Charger T1',
    charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t1", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t1", "charge_cooldownMs"), webImmune: true },
    note: 'C 族 T1（畸变幼虫 / 星髓幼虫）：船长 2026-09-14「给小虫子添加冲锋，倍率为1.5」。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT2]: {
    id: FOE_MOUNT_IDS.chargeSwarmT2,
    name: '虫群冲锋器 T2',
    en: 'Hiveswarm Charger T2',
    charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t2", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t2", "charge_cooldownMs"), webImmune: true },
    note: 'C 族 T2（星髓成虫）：船长 2026-09-16「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT3]: {
    id: FOE_MOUNT_IDS.chargeSwarmT3,
    name: '虫群冲锋器 T3',
    en: 'Hiveswarm Charger T3',
    charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t3", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t3", "charge_cooldownMs"), webImmune: true },
    note: 'C 族 T3（孢群异虫）：同上按档口径（2026-09-16 前它是族内唯一不具冲锋资格的舰级）。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT4]: {
    id: FOE_MOUNT_IDS.chargeSwarmT4,
    name: '虫群冲锋器 T4',
    en: 'Hiveswarm Charger T4',
    charge: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t4", "charge_mul"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-charge-swarm-t4", "charge_cooldownMs"), webImmune: true },
    note: 'C 族 T4（噬口巨兽）：船长 2026-09-14「大虫子的冲锋倍率改为3」。',
  },
  [FOE_MOUNT_IDS.droneRangeX4]: {
    id: FOE_MOUNT_IDS.droneRangeX4,
    name: '机巢增程阵列',
    en: 'Drone Nest Range Array',
    droneRangeOnHit: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-drone-range-x4", "droneRangeOnHit_mul") },
    note:
      'E 族三舰（巨构残段 / 奥罗残骸段 / 巨构核心段）：本体被命中 ⇒ 整队机群射程 ×4（迁移前 droneRangeMulOnHit: 4）。' +
      '船长 2026-09-16：作用面保持「整队标量」、零行为变化。',
  },
  [FOE_MOUNT_IDS.captureWeb]: {
    id: FOE_MOUNT_IDS.captureWeb,
    name: '劫掠捕获网',
    en: 'Raider Snare Net',
    web: { slowMul: enemyParameterOf(foeMountsParameters, "foe-mount-capture-web", "web_slowMul"), noThruster: true, noEvasion: true, rangeDownM: enemyParameterOf(foeMountsParameters, "foe-mount-capture-web", "web_rangeDownM") },
    note:
      '船长 2026-09-16：「劫掠捕获网：降低目标90%移动速度，并关闭所有类型推进器。在自身第一次开火时发动。' +
      '动画效果为一根蓝色的光速连着命中舰船」＋补充「还会让目标闪避强制为0，射程降低500米」。' +
      '只作用于被钉的那一艘；击杀发动者即解除；多艘不叠加。' +
      '船长 2026-09-26：「将断开距离提高到4500米，且这个断开对敌我都有效」⇒ 交战距离超过 4500 米同样解除' +
      '（见 combat.WEB_BREAK_DIST_M / expireFoeWebs）；本网整场只张一次 ⇒ 断开后该舰本场不再补发。',
  },
  [FOE_MOUNT_IDS.gunRangeX15]: {
    id: FOE_MOUNT_IDS.gunRangeX15,
    name: '守墓远距观瞄',
    en: 'Gravekeeper Long-range Optics',
    gunRangeOnHit: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-gun-range-x1-5", "gunRangeOnHit_mul"), noticeTextId: 'core.combat.013' },
    note:
      'D 族静滞卫舰：从它射程之外被命中 ⇒ 本舰炮台射程 ×1.5（迁移前 gunRangeMulOnHit: 1.5）。' +
      '「只允许静滞卫舰」的约束改由 content:check 的挂载件契约守。',
  },
  [FOE_MOUNT_IDS.gunRangeX15Titan]: {
    id: FOE_MOUNT_IDS.gunRangeX15Titan,
    name: '巨构齐射观瞄',
    en: 'Megastructure Salvo Optics',
    gunRangeOnHit: { mul: enemyParameterOf(foeMountsParameters, "foe-mount-titan-range-x1-5", "gunRangeOnHit_mul"), effectTextId: 'ui.foeIntro.114', noticeTextId: 'core.combat.012' },
    note:
      '船长 2026-09-19：「并挂载类似静滞卫舰的挨打后对方在射程外就增加射程的挂载件」＋同日澄清' +
      '「只是采用类似的效果的挂载件，并不是真的是静滞卫舰的挂载件（因此名字要不同）」' +
      '⇒ 只为 E 族导弹残段（foe-missile-hulk）立的独立一件：从它射程之外被命中，本舰炮台射程 ×1.5。' +
      '与 D 族的「守墓远距观瞄」（foe-mount-gun-range-x1-5）效果同档，归属与叙事各自独立，两族不共用同一件。',
  },
  [FOE_MOUNT_IDS.supportCall]: {
    id: FOE_MOUNT_IDS.supportCall,
    name: '支援呼叫装置',
    en: 'Support Call Device',
    supportCall: { delaySec: enemyParameterOf(foeMountsParameters, "foe-mount-support-call", "supportCall_delaySec"), threatMul: enemyParameterOf(foeMountsParameters, "foe-mount-support-call", "supportCall_threatMul") },
    note:
      '船长 2026-09-19：「战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程之外时，增援2艘静滞卫舰。」' +
      '＋「因为延迟到场，所以需要一定补偿。卡计算的实际威胁要*1.1」⇒ 只挂 D 族守墓王座舰' +
      '（只服务洞内深层卡「陵墓王庭」）。两支由卡的条目声明（enterAt ＋ enterBranch），' +
      '体检守恒契约要求两支账面总量相等；补偿乘在派生威胁上（血与火力各约 ×1.16）。',
  },
  [FOE_MOUNT_IDS.gyroStabilizer]: {
    id: FOE_MOUNT_IDS.gyroStabilizer,
    name: '姿态陀螺仪',
    en: 'Attitude Gyro',
    evasionBonus: { add: enemyParameterOf(foeMountsParameters, "foe-mount-gyro-stabilizer", "evasionBonus_add") },
    note:
      '船长 2026-09-24：「我调整了A族的闪避，并且希望在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避」' +
      '＋「我的改动是A给A族除电子舰外的其他敌人加10%闪避」＋「你先提高A族闪避，提高后再挂载，电子舰也要挂」；' +
      '追问裁定 = 加算 +10 个百分点（甲）、作用面 = 虫洞内带（乙：只挂洞内卡条目）。' +
      '⚠ 电子舰也要挂 ⇒ 洞内 A 族：劫掠电子舰 0.30 → 0.40、其余（2026-09-24 提档后 0.22）→ 0.32；' +
      '洞外（低安遭遇 / 悬赏）同一批舰级不挂，因为条目级挂载只影响写了 mounts 的那条编成。' +
      '归档落点：docs/roadmap.md 2026-09-24 条 ＋ docs/glossary.md「敌方挂载件」词条（原设计稿已随归档删除）。',
  },
  [FOE_MOUNT_IDS.hullRepair]: {
    id: FOE_MOUNT_IDS.hullRepair,
    name: '船体修理装置',
    en: 'Hull Repair Unit',
    repairPulse: { everyMs: enemyParameterOf(foeMountsParameters, "foe-mount-hull-repair", "repairPulse_everyMs"), armor: enemyParameterOf(foeMountsParameters, "foe-mount-hull-repair", "repairPulse_armor"), hull: enemyParameterOf(foeMountsParameters, "foe-mount-hull-repair", "repairPulse_hull") },
    note:
      '船长 2026-09-24：「给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，会吃威胁的加成。」；' +
      '追问裁定 = 修理量乘层威胁倍率（甲；归一基准「不改动」= 层 1 的 k = 1.00）⇒ 实数 = 基数 × k。' +
      '⚠ 同日再令：基础数值上调至 15 装甲 15 结构（船长：「船体修理装置（G 族）基础数值上调至15装甲15结构」）' +
      '⇒ 层 1 = 15/15（合计 30）· 层 7 ≈ 30/30 · 层 10 ≈ 42/42；夹到满值、不回超，层末守卫另吃 ×1.2。' +
      'k = 该层本次实际威胁 ÷ 45（combat.FOE_REPAIR_THREAT_REF）；' +
      '只挂 G 族洞内卡条目；与「敌方后勤舰」（FoeShipDef.repairPct：折自己 DPS 去修队友）不是一套。' +
      '归档落点：docs/roadmap.md 2026-09-24 条 ＋ docs/glossary.md「敌方挂载件」词条（原设计稿已随归档删除）。',
  },
  [FOE_MOUNT_IDS.reviveEscort]: {
    id: FOE_MOUNT_IDS.reviveEscort,
    name: '支援舰船召唤装置',
    en: 'Support Recall Beacon',
    reviveEscort: { everyMs: enemyParameterOf(foeMountsParameters, "foe-mount-revive-escort", "reviveEscort_everyMs"), count: enemyParameterOf(foeMountsParameters, "foe-mount-revive-escort", "reviveEscort_count"), priorityShipIds: ['foe-h-ink-jammer'] },
    note:
      '船长 2026-09-25：「给入侵母舰添加类似D族挂载件的独立挂载件，只不过改为复活被摧毁的友军' +
      '（但是表现形式上为敌方支援舰船入场），增援时间是60秒，每次随机复活一艘。」' +
      '追问四答：池子 = 只复活当前波已死的（丙）· 上限 = 不超本波原编成（甲）· 满血（甲）·' +
      '通用件、先只装入侵母舰（甲）。实现见 `combat.advanceBattleFor` 的"支援舰召唤"一段：' +
      '新 tag `supN-<原tag>` 入场（美术/体积/名称按原 tag 解析）⇒ 界面表现为「敌方支援舰船入场」。' +
      '2026-09-26 船长改判：「…改为每60秒复活2艘船。且必定会复活干扰舰」⇒ 每次 2 艘、' +
      '2026-09-26 船长追答：「应该是优先复活干扰舰」⇒ 语义 = 优先：干扰舰在可补池里就先占一个名额，' +
      '它活着 / 已补进场则名额回落到随机（不是无条件必补）。',
  },
  [FOE_MOUNT_IDS.inkRangeDebuff]: {
    id: FOE_MOUNT_IDS.inkRangeDebuff,
    name: '墨潮干扰阵列',
    en: 'Ink Tide Jammer Array',
    rangeDebuff: { pct: enemyParameterOf(foeMountsParameters, "foe-mount-ink-range-debuff", "rangeDebuff_pct"), strength: enemyParameterOf(foeMountsParameters, 'foe-mount-ink-range-debuff', 'rangeDebuff_strength') },
    note:
      '船长 2026-09-26：「敌人的射程压制挂载件好像也还没有命名？」⇒ 选甲：把 H 族「墨潮干扰舰」' +
      '原先写在舰级字段上的 `foeRangeDebuffPct = 0.5` 迁成具名挂载件（数值一字不变）——' +
      '迁移后它有了名字、进敌舰悬停/战报的挂载件清单、也进 `foe:export` 的「H 族 · 挂载件」表；' +
      '与我方那件「墨潮电子舱」（`mod-lair-ecm-h`）是敌我同源的一对。' +
      '口径 = 削减我方武器最远射程 50%，与我方电子舰的削减做加法抵消（见 `meJammerNetOf`）。',
  },
  [FOE_MOUNT_IDS.dRangeDebuff]: {
    id: FOE_MOUNT_IDS.dRangeDebuff,
    name: '碑卫压制阵列',
    en: 'Bastion Suppression Array',
    rangeDebuff: { pct: enemyParameterOf(foeMountsParameters, 'foe-mount-d-range-debuff', 'rangeDebuff_pct'), strength: enemyParameterOf(foeMountsParameters, 'foe-mount-d-range-debuff', 'rangeDebuff_strength') },
    note: '压制玩家武器最远射程 15%；多艘按现有射程压制合成规则叠加。',
  },
  [FOE_MOUNT_IDS.coronaBlink]: {
    id: FOE_MOUNT_IDS.coronaBlink,
    name: '瞬光跃迁仪',
    en: 'Corona Blink Drive',
    blink: { distanceM: enemyParameterOf(foeMountsParameters, "foe-mount-corona-blink", "blink_distanceM"), cooldownMs: enemyParameterOf(foeMountsParameters, "foe-mount-corona-blink", "blink_cooldownMs") },
    note:
      '船长 2026-10-01：「激光武器+闪现效果的挂载件」——R 族（光环科技 / Corona Systems）' +
      '五档壳体逐档常挂（船长选「乙：五档全带」；距离与触发选「甲：一次 2,000m / 被命中触发」）。' +
      '🔴 冷却：2026-10-01 令「全族闪现的间隔下调到5秒」，2026-10-03 船长令「将敌人的闪现冷却时间延长到12秒」⇒ 12 秒（现行）。' +
      '效果 = 本体被命中时朝期望交战距离闪一跳、单次不超过 2,000 m（本仓战斗只有 `distanceM` 一个标量 ⇒ 闪现即距离突变），' +
      '冷却期内再挨打不闪。⚠ 与族设定配套：该族是「激光（必中）+ 风筝」，闪现用来在被我方近身时重建射程优势。' +
      '⚠ 与「待机护盾阵列」共用这条冷却（闪现不在冷却中 ⇒ 护盾层 ×0.5）⇒ 冷却由 5 秒延长到 12 秒会同时'
      + '压低这两件的强度（这是船长 2026-10-03 已知的连带，读数见工作文档 §十一）。' +
      '件名与效果句经船长 2026-10-01 批准（「「瞬光跃迁仪」等件名提案可用」）。',
  },
  [FOE_MOUNT_IDS.coronaOverlayDrive]: {
    id: FOE_MOUNT_IDS.coronaOverlayDrive,
    name: '叠光装置',
    en: 'Corona Overlay Drive',
    overlayDrive: { stepMs: enemyParameterOf(foeMountsParameters, "foe-mount-corona-overlay-drive", "overlayDrive_stepMs"), floorMs: enemyParameterOf(foeMountsParameters, "foe-mount-corona-overlay-drive", "overlayDrive_floorMs"), dmgMul: enemyParameterOf(foeMountsParameters, "foe-mount-corona-overlay-drive", "overlayDrive_dmgMul") },
    note:
      '船长 2026-10-01：「添加叠光装置：效果是每次攻击或者闪现后，攻击间隔缩短，最多缩短至0.5秒攻击间隔。' +
      '伤害给予一个0.3的倍率。」⇒ 只挂 R 族 T3 叠光级。三条追问的裁定：伤害 ×0.3 = 该舰全部伤害 ×0.3（甲）；' +
      '缩短量步长 400ms，初始装填 4500ms（船长 2026-10-03 改判）；' +
      '「叠满」= 装填间隔降到下限 500ms。' +
      '具体叠满时长由真实攻击与闪现次数决定。' +
      '当前间隔记在运行时的 foeOverlayReload（与 foeBlinks 同口径，有意不入档）。',
  },
  [FOE_MOUNT_IDS.coronaFlashOverload]: {
    id: FOE_MOUNT_IDS.coronaFlashOverload,
    name: '闪烁过载装置',
    en: 'Corona Flash Overload',
    flashOverload: { healShield: true, hullCostPct: enemyParameterOf(foeMountsParameters, "foe-mount-corona-flash-overload", "flashOverload_hullCostPct") },
    note:
      '船长 2026-10-01：「粼光添加闪烁过载装置，效果是每次触发闪现后，恢复所有护盾值。但是会损失最大结构值5%的结构。」' +
      '⇒ 只挂 R 族 T1 粼光级。两条追问的裁定：5% = 结构上限的 5%（甲，粼光级结构上限 29.85 ⇒ 每次扣 1.49）；' +
      '可以扣死自毁（乙，不设保底）⇒ 反复闪现会把结构扣到 0、该舰当场自毁。' +
      '⚠ 2026-10-03 船长令已把本件移交「回响级」（自粼光级移来，见 `foe-ships.ts` 的 `FOE_R_CORONA_ECHO`）。',
  },
  [FOE_MOUNT_IDS.coronaStandbyShield]: {
    id: FOE_MOUNT_IDS.coronaStandbyShield,
    name: '待机护盾阵列',
    en: 'Standby Shield Array',
    standbyShield: { resistPct: enemyParameterOf(foeMountsParameters, "foe-mount-corona-standby-shield", "standbyShield_resistPct"), delayMs: enemyParameterOf(foeMountsParameters, "foe-mount-corona-standby-shield", "standbyShield_delayMs") },
    note:
      '船长 2026-10-02：「垂暮级添加挂载件，触发闪现时，触发的那次齐射受到的伤害减半。」' +
      '⇒ 我追问时点后船长改口径：「或者换个说法，闪现未处于冷却中的时候，护盾拥有全伤害50%的抗性。」' +
      '⇒ 只挂 R 族 T4 垂暮级；2026-10-08 改判：仅冷却满1秒至冷却结束前生效，取消旧常驻与2秒宽限。护盾层对全部伤害类型 ×0.5；装甲/结构照常。',
  },
  [FOE_MOUNT_IDS.coronaFocusArray]: {
    id: FOE_MOUNT_IDS.coronaFocusArray,
    name: '聚焦阵列',
    en: 'Focus Array',
    focusArray: { rampMs: enemyParameterOf(foeMountsParameters, "foe-mount-corona-focus-array", "focusArray_rampMs"), rangeBonusPct: enemyParameterOf(foeMountsParameters, "foe-mount-corona-focus-array", "focusArray_rangeBonusPct"), antiDroneBonusPct: enemyParameterOf(foeMountsParameters, "foe-mount-corona-focus-array", "focusArray_antiDroneBonusPct") },
    note:
      '船长 2026-10-02：「然后给R族的入侵旗舰添加一个挂载件，武器的远端衰减，随时间提高到1（就是无衰减）。」' +
      '⇒ 只挂 R 族 T5 光环中枢（周末入侵旗舰战的 BOSS 本体）。' +
      '我提"整场计时"时船长改判：「旗舰挂载件的会随波重置」⇒ 计时锚 = 本波起点' +
      '（`BattleState.foeWaveStartMs`，缺省回落 `startedAtGameMs`），每波从头爬。' +
      '曲线 = min(1, falloff + (1 − falloff) × t ÷ 120000)；2026-10-03 改判：同进度增加射程与对无人机近防伤害，满层修正率各 +200%，加算抵消负修正。2026-10-08：射程扩为全队，中枢被毁立即失效；衰减与近防增伤仍仅自己。',
  },
  [FOE_MOUNT_IDS.coronaOverlayBeacon]: {
    id: FOE_MOUNT_IDS.coronaOverlayBeacon,
    name: '叠光支援信标',
    en: 'Overlay Support Beacon',
    summonEscort: { everyMs: enemyParameterOf(foeMountsParameters, "foe-mount-corona-overlay-beacon", "summonEscort_everyMs"), count: enemyParameterOf(foeMountsParameters, "foe-mount-corona-overlay-beacon", "summonEscort_count"), shipId: 'foe-r-corona-overlay', formationSlots: true },
    note: '船长2026-10-08确认：每60秒检查当前波空位，满血召唤一艘叠光级；不超原编成，满员跳过不累计，中枢被毁后停止。',
  },
  [FOE_MOUNT_IDS.dRebirthProtocol]: {
    id: FOE_MOUNT_IDS.dRebirthProtocol,
    name: '苏生协议', en: 'Rebirth Protocol',
    rebirthProtocol: { repairMs: enemyParameterOf(foeMountsParameters, 'foe-mount-d-rebirth-protocol', 'rebirthProtocol_repairMs'), armorTotalPct: enemyParameterOf(foeMountsParameters, 'foe-mount-d-rebirth-protocol', 'rebirthProtocol_armorTotalPct'), hullTotalPct: enemyParameterOf(foeMountsParameters, 'foe-mount-d-rebirth-protocol', 'rebirthProtocol_hullTotalPct') },
    note: '首次受到致命攻击时结构保留1点；随后5秒按总量恢复最大装甲与最大结构各100%，不恢复护盾。每场每舰一次。',
  },
  [FOE_MOUNT_IDS.dMausoleumArmor]: {
    id: FOE_MOUNT_IDS.dMausoleumArmor,
    name: '陵墓装甲', en: 'Mausoleum Armor',
    mausoleumArmor: { hpMul: enemyParameterOf(foeMountsParameters, 'foe-mount-d-mausoleum-armor', 'mausoleumArmor_hpMul'), resistPct: enemyParameterOf(foeMountsParameters, 'foe-mount-d-mausoleum-armor', 'mausoleumArmor_resistPct') },
    note: '最大装甲与最大结构各乘0.5；装甲与结构获得75%全抗性。',
  },
  [FOE_MOUNT_IDS.dCoatingArmor]: {
    id: FOE_MOUNT_IDS.dCoatingArmor,
    name: '守墓镀层装甲', en: 'Gravekeeper Armor Coating',
    coatingArmor: { resistAdd: enemyParameterOf(foeMountsParameters, 'foe-mount-d-coating-armor', 'coatingArmor_resistAdd'), cap: enemyParameterOf(foeMountsParameters, 'foe-mount-d-coating-armor', 'coatingArmor_cap'), durationMs: enemyParameterOf(foeMountsParameters, 'foe-mount-d-coating-armor', 'coatingArmor_durationMs') },
    note: '实际伤害落入装甲层并造成装甲损失时，装甲全抗性提高5个百分点；每层独立计时，最高90%。',
  },
  [FOE_MOUNT_IDS.dShieldCapacitor]: {
    id: FOE_MOUNT_IDS.dShieldCapacitor,
    name: '护盾蓄能装置', en: 'Shield Capacitor',
    shieldCapacitor: { rangeMul: enemyParameterOf(foeMountsParameters, 'foe-mount-d-shield-capacitor', 'shieldCapacitor_rangeMul'), reloadMul: enemyParameterOf(foeMountsParameters, 'foe-mount-d-shield-capacitor', 'shieldCapacitor_reloadMul'), damageMul: enemyParameterOf(foeMountsParameters, 'foe-mount-d-shield-capacitor', 'shieldCapacitor_damageMul') },
    note: '船长2026-10-16确认：空盾蓄能的伤害增幅仍按乘法叠层，伤害和间隔倍率读取本件静态参数；不改射程与启动规则。',
  },
  [FOE_MOUNT_IDS.dReconstruction]: {
    id: FOE_MOUNT_IDS.dReconstruction,
    name: '陵寝重构协议', en: 'Mausoleum Reconstruction Protocol',
    reviveEscort: { everyMs: enemyParameterOf(foeMountsParameters, 'foe-mount-d-reconstruction', 'reviveEscort_everyMs'), all: true },
    note: '船长2026-10-16确认：定期重构本波全部已阵亡友舰，复用现有满血支援入场；不跨波、不复制存活舰，永陵被毁后停止。',
  },
}

export function foeMountOf(id: string): FoeMountDef | undefined {
  return (FOE_MOUNTS as Record<string, FoeMountDef | undefined>)[id]
}

export interface ResolvedFoeMounts {
  acidShieldDamageMul?: number
  broodControl?: FoeMountDef['broodControl']
  hatchery?: FoeMountDef['hatchery']
  fleetSpeedRamp?: FoeMountDef['fleetSpeedRamp']
  foeCanCharge?: true
  foeChargeMul?: number
  foeChargeCooldownMs?: number
  foeChargeWebImmune?: true
  foeDroneRangeMulOnHit?: number
  foeGunRangeMulOnHit?: number
  foeGunRangeNoticeId?: string
  foeCaptureWeb?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  foeSupportCall?: { delaySec: number; threatMul: number }
  foeEvasionBonusAdd?: number
  foeRepairPulse?: { everyMs: number; armor: number; hull: number }
  foeReviveEscort?: FoeMountDef['reviveEscort']
  foeSummonEscort?: FoeMountDef['summonEscort']
  foeRangeDebuffPct?: number
  rangeEwStrength?: number
  foeBlink?: { distanceM: number; cooldownMs: number }
  foeOverlayDrive?: { stepMs: number; floorMs: number; dmgMul: number }
  foeFlashOverload?: { healShield: true; hullCostPct: number }
  foeStandbyShield?: FoeMountDef['standbyShield']
  foeFocusArray?: FoeMountDef['focusArray']
  foeRebirthProtocol?: FoeMountDef['rebirthProtocol']
  foeMausoleumArmor?: FoeMountDef['mausoleumArmor']
  foeCoatingArmor?: FoeMountDef['coatingArmor']
  foeShieldCapacitor?: FoeMountDef['shieldCapacitor']
  names: string[]
  namePairs: Array<readonly [string, string]>
  unknown: string[]
}

export function resolveFoeMounts(ids: readonly string[] | undefined): ResolvedFoeMounts {
  const out: ResolvedFoeMounts = { names: [], namePairs: [], unknown: [] }
  for (const id of ids ?? []) {
    const def = foeMountOf(id)
    if (!def) {
      out.unknown.push(id)
      continue
    }
    out.names.push(def.name)
    if (def.acidShieldDamageMul !== undefined) out.acidShieldDamageMul = def.acidShieldDamageMul
    if (def.broodControl) out.broodControl = { ...def.broodControl }
    if (def.hatchery) out.hatchery = { ...def.hatchery }
    if (def.fleetSpeedRamp) out.fleetSpeedRamp = { ...def.fleetSpeedRamp }
    out.namePairs.push([def.name, def.en ?? def.name])
    if (def.charge) {
      out.foeCanCharge = true
      out.foeChargeMul = def.charge.mul
      out.foeChargeCooldownMs = def.charge.cooldownMs
      if (def.charge.webImmune === true) out.foeChargeWebImmune = true
    }
    if (def.droneRangeOnHit) out.foeDroneRangeMulOnHit = def.droneRangeOnHit.mul
    if (def.gunRangeOnHit) {
      out.foeGunRangeMulOnHit = def.gunRangeOnHit.mul
      out.foeGunRangeNoticeId = def.gunRangeOnHit.noticeTextId
    }
    if (def.web) out.foeCaptureWeb = { ...def.web }
    if (def.supportCall) out.foeSupportCall = { ...def.supportCall }
    if (def.evasionBonus) out.foeEvasionBonusAdd = (out.foeEvasionBonusAdd ?? 0) + def.evasionBonus.add
    if (def.repairPulse) out.foeRepairPulse = { ...def.repairPulse }
    if (def.reviveEscort) out.foeReviveEscort = { ...def.reviveEscort }
    if (def.summonEscort) out.foeSummonEscort = { ...def.summonEscort }
    if (def.rangeDebuff) {
      out.foeRangeDebuffPct = def.rangeDebuff.pct
      out.rangeEwStrength = (out.rangeEwStrength ?? 0) + (def.rangeDebuff.strength ?? 0)
    }
    if (def.blink) out.foeBlink = { ...def.blink }
    if (def.overlayDrive) out.foeOverlayDrive = { ...def.overlayDrive }
    if (def.flashOverload) out.foeFlashOverload = { ...def.flashOverload }
    if (def.standbyShield) out.foeStandbyShield = { ...def.standbyShield }
    if (def.focusArray) out.foeFocusArray = { ...def.focusArray }
    if (def.rebirthProtocol) out.foeRebirthProtocol = { ...def.rebirthProtocol }
    if (def.mausoleumArmor) out.foeMausoleumArmor = { ...def.mausoleumArmor }
    if (def.coatingArmor) out.foeCoatingArmor = { ...def.coatingArmor }
    if (def.shieldCapacitor) out.foeShieldCapacitor = { ...def.shieldCapacitor }
  }
  return out
}
