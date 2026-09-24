/**
 * **敌方挂载件目录**（船长 2026-09-16 三句合一的落点）：
 * - 「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了**」；
 * - 「**除了C族，将D族和E族的射程增加也迁成挂载件**」；
 * - 「**要：敌舰悬停/战报展示挂载件**」（⇒ `name` 是玩家可见文案）。
 *
 * **为什么目录表放在 core 而不是 data**：建档路径 `combat.createFoeSpecs(anomaly, bal, opts)`
 * **只拿得到敌卡与平衡表、拿不到 `ctx`**（而 `ctx.ships` / `ctx.modules` 那类 data 表要走 ctx）。
 * 放 core 就能让"解析挂载 → 写运行时字段"在**同一处**完成，数据侧只写 id（`FoeShipDef.mounts` /
 * `FoeShipSlot.mounts`）。同类先例：`core/lairs.ts` 的 `FOE_LAIR_GEAR`（敌族掉落池表）。
 *
 * **一件一类效果**（`charge` / `droneRangeOnHit` / `gunRangeOnHit` / `web` / `supportCall` /
 * `evasionBonus` / `repairPulse`）：⚠ **2026-09-24 更正** —— 这条**只约束我方支援件**
 * （`ModuleDef`，`content-check` 的"恰好一类效果字段"），**敌方挂载件可以一件带多类**
 * （实况：A 族深层战团那条「劫掠电子舰」同时挂 `chargePirate` ＋ `captureWeb`）。
 * 多件同类相撞时按下方 `resolveFoeMounts` 的"**后写覆盖先写**"聚合。
 * `content:check` 会拦"未知 id"与各件的归属面。
 * ⚠ **挂载位一律"条目级"**（2026-09-19 船长：「**海盗电子舰的冲锋也移除，只在洞内单独挂载**」）——
 * 冲锋件全部写在卡的编成条目上（三条 A 族舰级洞外也在用；电子舰也照此收口），舰级只留
 * D/E 的受击增程件。「洞外零冲锋」的守卫因此按**有效挂载**（`slot.mounts ?? ship.mounts`，
 * **替换**不是叠加）判，见 `content-check` 敌方挂载件契约 ③。
 */
import type { FoeMountDef, FoeMountId } from './types'

/** id 常量表（数据侧引用它，写错当场编译不过） */
export const FOE_MOUNT_IDS = {
  /** A 族海盗：×1.6 · 冷却 **30 秒**（船长 2026-09-16 亲定；只挂洞内三张 A 族卡的条目） */
  chargePirate: 'foe-mount-charge-pirate',
  /** C 族虫群：按档倍率 1.5 / 2 / 2.5 / 3（`ALIEN_CHARGE_MUL_BY_TIER` 是契约基准）、冷却 10 秒 */
  chargeSwarmT1: 'foe-mount-charge-swarm-t1',
  chargeSwarmT2: 'foe-mount-charge-swarm-t2',
  chargeSwarmT3: 'foe-mount-charge-swarm-t3',
  chargeSwarmT4: 'foe-mount-charge-swarm-t4',
  /** E 族巨构：本体挨打 ⇒ **整队**机群射程 ×4（迁移前 `droneRangeMulOnHit: 4`，口径逐字不变） */
  droneRangeX4: 'foe-mount-drone-range-x4',
  /** D 族静滞卫舰：**从射程外**挨打 ⇒ 本舰炮台射程 ×1.5（迁移前 `gunRangeMulOnHit: 1.5`） */
  gunRangeX15: 'foe-mount-gun-range-x1-5',
  /**
   * E 族导弹残段：**从射程外**挨打 ⇒ 本舰炮台射程 ×1.5。
   * ⚠ 与 D 族那件**效果类似但各是一件**（船长 2026-09-19：「**只是采用类似的效果的挂载件，
   * 并不是真的是静滞卫舰的挂载件（因此名字要不同）**」）⇒ id / 名 / 备注**三处都独立**，
   * 不许两族共用同一件（`content:check` 的炮台受击增程契约按"舰级 → 指定件"逐个核）。
   */
  gunRangeX15Titan: 'foe-mount-titan-range-x1-5',
  /** 劫掠捕获网（船长 2026-09-16）：A 族新舰「劫掠电子舰」专属——首次开火即钉住目标 */
  captureWeb: 'foe-mount-capture-web',
  /** **支援呼叫装置**（船长 2026-09-19）：D 族守墓王座舰专属——开战 20 秒后按距离呼叫一支支援军 */
  supportCall: 'foe-mount-support-call',
  /**
   * **姿态陀螺仪**（船长 2026-09-24：「**在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避**」）
   * ——A 族**洞内卡条目**专属（含劫掠电子舰）：本舰战斗闪避 **+0.10 加算**、上限 0.9。
   */
  gyroStabilizer: 'foe-mount-gyro-stabilizer',
  /**
   * **船体修理装置**（船长 2026-09-24：「**给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，
   * 会吃威胁的加成。**」）——G 族**洞内卡条目**专属：每 5 秒自修 5 装甲 + 5 结构 × 层威胁倍率 k。
   */
  hullRepair: 'foe-mount-hull-repair',
} as const

/** 全部挂载件（键 = id；`FoeMountId` 联合类型保证穷尽） */
export const FOE_MOUNTS: Readonly<Record<FoeMountId, FoeMountDef>> = {
  [FOE_MOUNT_IDS.chargePirate]: {
    id: FOE_MOUNT_IDS.chargePirate,
    name: '劫掠冲锋推进器',
    charge: { mul: 1.6, cooldownMs: 30_000 },
    note:
      '船长 2026-09-16：「给A族虫洞内的海盗添加冲锋…冲锋倍率为1.6，冷却30秒」⇒ 只挂洞内三张 A 族卡的条目' +
      '（劫掠支队 / 劫掠围猎 / 海盗战团）；三条舰级洞外（低安遭遇 / 悬赏）也在用 ⇒ 洞外不冲锋。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT1]: {
    id: FOE_MOUNT_IDS.chargeSwarmT1,
    name: '虫群冲锋器 T1',
    charge: { mul: 1.5, cooldownMs: 10_000 },
    note: 'C 族 T1（畸变幼虫 / 星髓幼虫）：船长 2026-09-14「给小虫子添加冲锋，倍率为1.5」。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT2]: {
    id: FOE_MOUNT_IDS.chargeSwarmT2,
    name: '虫群冲锋器 T2',
    charge: { mul: 2, cooldownMs: 10_000 },
    note: 'C 族 T2（星髓成虫）：船长 2026-09-16「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT3]: {
    id: FOE_MOUNT_IDS.chargeSwarmT3,
    name: '虫群冲锋器 T3',
    charge: { mul: 2.5, cooldownMs: 10_000 },
    note: 'C 族 T3（孢群异虫）：同上按档口径（2026-09-16 前它是族内唯一不具冲锋资格的舰级）。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT4]: {
    id: FOE_MOUNT_IDS.chargeSwarmT4,
    name: '虫群冲锋器 T4',
    charge: { mul: 3, cooldownMs: 10_000 },
    note: 'C 族 T4（噬口巨兽）：船长 2026-09-14「大虫子的冲锋倍率改为3」。',
  },
  [FOE_MOUNT_IDS.droneRangeX4]: {
    id: FOE_MOUNT_IDS.droneRangeX4,
    name: '机巢增程阵列',
    droneRangeOnHit: { mul: 4 },
    note:
      'E 族三舰（巨构残段 / 奥罗残骸段 / 巨构核心段）：本体被命中 ⇒ 整队机群射程 ×4（迁移前 droneRangeMulOnHit: 4）。' +
      '船长 2026-09-16：作用面保持「整队标量」、零行为变化。',
  },
  [FOE_MOUNT_IDS.captureWeb]: {
    id: FOE_MOUNT_IDS.captureWeb,
    name: '劫掠捕获网',
    web: { slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 },
    note:
      '船长 2026-09-16：「劫掠捕获网：降低目标90%移动速度，并关闭所有类型推进器。在自身第一次开火时发动。' +
      '动画效果为一根蓝色的光速连着命中舰船」＋补充「还会让目标闪避强制为0，射程降低500米」。' +
      '只作用于被钉的那一艘；本场永久；击杀发动者即解除；多艘不叠加。',
  },
  [FOE_MOUNT_IDS.gunRangeX15]: {
    id: FOE_MOUNT_IDS.gunRangeX15,
    name: '守墓远距观瞄',
    gunRangeOnHit: { mul: 1.5 },
    note:
      'D 族静滞卫舰：从它射程之外被命中 ⇒ 本舰炮台射程 ×1.5（迁移前 gunRangeMulOnHit: 1.5）。' +
      '「只允许静滞卫舰」的约束改由 content:check 的挂载件契约守。',
  },
  [FOE_MOUNT_IDS.gunRangeX15Titan]: {
    id: FOE_MOUNT_IDS.gunRangeX15Titan,
    name: '巨构齐射观瞄',
    gunRangeOnHit: { mul: 1.5 },
    note:
      '船长 2026-09-19：「并挂载类似静滞卫舰的挨打后对方在射程外就增加射程的挂载件」＋同日澄清' +
      '「只是采用类似的效果的挂载件，并不是真的是静滞卫舰的挂载件（因此名字要不同）」' +
      '⇒ 只为 E 族导弹残段（foe-missile-hulk）立的独立一件：从它射程之外被命中，本舰炮台射程 ×1.5。' +
      '与 D 族的「守墓远距观瞄」（foe-mount-gun-range-x1-5）效果同档，归属与叙事各自独立，两族不共用同一件。',
  },
  [FOE_MOUNT_IDS.supportCall]: {
    id: FOE_MOUNT_IDS.supportCall,
    name: '支援呼叫装置',
    supportCall: { delaySec: 20, threatMul: 1.1 },
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
    evasionBonus: { add: 0.1 },
    note:
      '船长 2026-09-24：「我调整了A族的闪避，并且希望在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避」' +
      '＋「我的改动是A给A族除电子舰外的其他敌人加10%闪避」＋「你先提高A族闪避，提高后再挂载，电子舰也要挂」；' +
      '追问裁定 = 加算 +10 个百分点（甲）、作用面 = 虫洞内带（乙：只挂洞内卡条目）。' +
      '⚠ 电子舰也要挂 ⇒ 洞内 A 族：劫掠电子舰 0.30 → 0.40、其余（2026-09-24 提档后 0.22）→ 0.32；' +
      '洞外（低安遭遇 / 悬赏）同一批舰级不挂，因为条目级挂载只影响写了 mounts 的那条编成。' +
      '设计稿 docs/design/foe-mounts-20260924.md。',
  },
  [FOE_MOUNT_IDS.hullRepair]: {
    id: FOE_MOUNT_IDS.hullRepair,
    name: '船体修理装置',
    en: 'Hull Repair Unit',
    repairPulse: { everyMs: 5_000, armor: 5, hull: 5 },
    note:
      '船长 2026-09-24：「给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，会吃威胁的加成。」；' +
      '追问裁定 = 修理量乘层威胁倍率（甲；归一基准「不改动」= 层 1 的 k = 1.00）。' +
      'k = 该层本次实际威胁 ÷ 45（combat.FOE_REPAIR_THREAT_REF）⇒ 层 1 = 1.00 · 层 7 ≈ 1.97 · ' +
      '层 10 ≈ 2.77；层末守卫另吃 ×1.2 的威胁倍率（wormholeFoeThreat）⇒ k 随之更高。' +
      '只挂 G 族洞内卡条目；与「敌方后勤舰」（FoeShipDef.repairPct：折自己 DPS 去修队友）不是一套。' +
      '设计稿 docs/design/foe-mounts-20260924.md。',
  },
}

/** 按 id 取件（未知 id ⇒ `undefined`；体检会把它判红） */
export function foeMountOf(id: string): FoeMountDef | undefined {
  return (FOE_MOUNTS as Record<string, FoeMountDef | undefined>)[id]
}

/** 挂载件解析结果 = 运行时字段（`UnitSpec` 上那几个可选字段的同名子集）＋ 展示名 */
export interface ResolvedFoeMounts {
  foeCanCharge?: true
  foeChargeMul?: number
  foeChargeCooldownMs?: number
  foeDroneRangeMulOnHit?: number
  foeGunRangeMulOnHit?: number
  /** **劫掠捕获网**参数（原样带给单位；触发/作用面见 `FoeMountDef.web`） */
  foeCaptureWeb?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  /** **支援呼叫装置**参数（原样带给单位；判定/锁存/补偿口径见 `FoeMountDef.supportCall`） */
  foeSupportCall?: { delaySec: number; threatMul: number }
  /**
   * **姿态陀螺仪的闪避加数**（原样带给单位；消费方在建档时加进 `evasion` 并夹 0.9）。
   * 多件相撞取**最后一件**（与其余效果同款"后写覆盖"）。
   */
  foeEvasionBonusAdd?: number
  /** **船体修理装置的脉冲参数**（原样带给单位；`k` 由建档侧按本层威胁现算，见 `FoeMountDef.repairPulse`） */
  foeRepairPulse?: { everyMs: number; armor: number; hull: number }
  /** 展示名（保持挂载顺序；`foeMountNames` 直接用它） */
  names: string[]
  /**
   * **同序的展示名**（与 `names` 逐项对齐；每项 = `[中文名, 英文名]`）——
   * 供数据层的 `overlayCardFoeMounts` 按语言挑一份（2026-09-24 加）。
   * 没有 `en` 的件**两项都给中文名**（英文界面回退中文，与既有一致）。
   */
  namePairs: Array<readonly [string, string]>
  /** 未知 id（体检用；引擎侧忽略） */
  unknown: string[]
}

/**
 * **解析挂载件 → 运行时字段**（单点：建档与体检同源）。
 * 多件同类取**最后一件**（后写覆盖先写）；未知 id 不生效、只登记在 `unknown` 里。
 */
export function resolveFoeMounts(ids: readonly string[] | undefined): ResolvedFoeMounts {
  const out: ResolvedFoeMounts = { names: [], namePairs: [], unknown: [] }
  for (const id of ids ?? []) {
    const def = foeMountOf(id)
    if (!def) {
      out.unknown.push(id)
      continue
    }
    out.names.push(def.name)
    out.namePairs.push([def.name, def.en ?? def.name])
    if (def.charge) {
      out.foeCanCharge = true
      out.foeChargeMul = def.charge.mul
      out.foeChargeCooldownMs = def.charge.cooldownMs
    }
    if (def.droneRangeOnHit) out.foeDroneRangeMulOnHit = def.droneRangeOnHit.mul
    if (def.gunRangeOnHit) out.foeGunRangeMulOnHit = def.gunRangeOnHit.mul
    if (def.web) out.foeCaptureWeb = { ...def.web }
    if (def.supportCall) out.foeSupportCall = { ...def.supportCall }
    if (def.evasionBonus) out.foeEvasionBonusAdd = def.evasionBonus.add
    if (def.repairPulse) out.foeRepairPulse = { ...def.repairPulse }
  }
  return out
}
