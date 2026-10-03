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
  /** 劫掠捕获网（船长 2026-09-16）：A 族新舰「劫掠电子舰」专属——首次开火即钉住目标；
   *  2026-09-26 起交战距离超过 4500 米同样断开（敌我通用） */
  captureWeb: 'foe-mount-capture-web',
  /** **支援呼叫装置**（船长 2026-09-19）：D 族守墓王座舰专属——开战 20 秒后按距离呼叫一支支援军 */
  supportCall: 'foe-mount-support-call',
  /** **姿态陀螺仪**（**船长 2026-09-24**）：A 族（含劫掠电子舰）——闪避 +0.10 加算，只挂洞内 A 族卡条目 */
  gyroStabilizer: 'foe-mount-gyro-stabilizer',
  /** **船体修理装置**（2026-09-24 船长令，基础值上调至 15/15）：G 族——每 5 秒回 15 装甲 / 15 结构 × 该层威胁倍率 */
  hullRepair: 'foe-mount-hull-repair',
  /** **支援舰船召唤装置**（**船长 2026-09-25**）：入侵母舰——每 60 秒把当前波已阵亡的一艘敌舰**满血复活入场** */
  reviveEscort: 'foe-mount-revive-escort',
  /**
   * **墨潮干扰阵列**（**船长 2026-09-26**：「**敌人的射程压制挂载件好像也还没有命名？**」⇒ 选甲：
   * 把墨潮干扰舰的**舰级字段** `foeRangeDebuffPct = 0.5` 迁成**具名挂载件**，数值一字不变）。
   */
  inkRangeDebuff: 'foe-mount-ink-range-debuff',
  /**
   * **叠光装置**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者闪现后，攻击间隔缩短，
   * 最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。**」）—— R 族 T3 **叠光级**专属。
   * 效果 = 装填自加速（每次攻击/闪现 −400ms，下限 500ms）＋ 该舰全部伤害 ×0.3。
   */
  coronaOverlayDrive: 'foe-mount-corona-overlay-drive',
  /**
   * **闪烁过载装置**（**船长 2026-10-01 令**：「**粼光添加闪烁过载装置，效果是每次触发闪现后，
   * 恢复所有护盾值。但是会损失最大结构值5%的结构。**」）—— R 族 T1 **粼光级**专属。
   * 效果 = 每次闪现后护盾回满，代价是结构 −结构上限的 5%（**可扣死自毁**）。
   */
  coronaFlashOverload: 'foe-mount-corona-flash-overload',
  /**
   * **瞬光跃迁仪**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）——
   * R 族「光环科技 / Corona Systems」的族级挂载件，**五档壳体逐档常挂**。
   *
   * 效果 = **本体被命中时朝它自己的期望交战距离闪一跳，单次位移不超过 2 km**（详见 `FoeMountDef.blink` 头注）。
   * ✅ **件名已获船长批准**（**2026-10-01 船长令**：「**「瞬光跃迁仪」等件名提案可用**」）——
   */
  coronaBlink: 'foe-mount-corona-blink',
  /**
   * **待机护盾阵列**（**船长 2026-10-02 令**：「**或者换个说法，闪现未处于冷却中的时候，
   * 护盾拥有全伤害50%的抗性。**」）—— R 族 T4 **垂暮级**专属。
   * 效果 = 闪现**不在冷却中**时（从未闪过也算可用）**护盾层**对全伤害类型 **50% 抗性**
   * （只护盾层；与闪现共用那条冷却 —— **2026-10-03 起 12 秒**）。
   */
  coronaStandbyShield: 'foe-mount-corona-standby-shield',
  /**
   * **聚焦阵列**（**船长 2026-10-02 令**：「**武器的远端衰减，随时间提高到1（就是无衰减）。**」
   * ＋改判「**旗舰挂载件的会随波重置**」）—— R 族 T5 **光环中枢**专属。
   * 效果 = 它自己武器的远端衰减从面板值线性爬到 1.0（无衰减），**120 秒**到满、**随波重置**。
   */
  coronaFocusArray: 'foe-mount-corona-focus-array',
} as const

/** 全部挂载件（键 = id；`FoeMountId` 联合类型保证穷尽） */
export const FOE_MOUNTS: Readonly<Record<FoeMountId, FoeMountDef>> = {
  [FOE_MOUNT_IDS.chargePirate]: {
    id: FOE_MOUNT_IDS.chargePirate,
    name: '劫掠冲锋推进器',
    // 2026-09-26 三号补英文名（交接项「敌方挂载件英文译名」）：`glossary-en.md` §一 命名规则
    // 第 4 条「掠袭 → Raider」＋ 直译；效果说明本身中英齐备（`ui.foeIntro.107`），这里只给"装置叫什么"。
    en: 'Raider Charge Thruster',
    charge: { mul: 1.6, cooldownMs: 30_000 },
    note:
      '船长 2026-09-16：「给A族虫洞内的海盗添加冲锋…冲锋倍率为1.6，冷却30秒」⇒ 只挂洞内三张 A 族卡的条目' +
      '（劫掠支队 / 劫掠围猎 / 海盗战团）；三条舰级洞外（低安遭遇 / 悬赏）也在用 ⇒ 洞外不冲锋。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT1]: {
    id: FOE_MOUNT_IDS.chargeSwarmT1,
    name: '虫群冲锋器 T1',
    en: 'Hiveswarm Charger T1', // 族系前缀照译：巢群/虫群 = `Hiveswarm`；档位照抄（命名规则第 3 条）
    // **C 族族设定**（船长 2026-09-30：「给C族添加族设定，他们的冲锋不会被网子解除」；追问取甲）：
    // 网子的「关推进器」对本族无效 ⇒ 四件虫群冲锋器一律 `webImmune`（A 族那件**不带**）。
    charge: { mul: 1.5, cooldownMs: 10_000, webImmune: true },
    note: 'C 族 T1（畸变幼虫 / 星髓幼虫）：船长 2026-09-14「给小虫子添加冲锋，倍率为1.5」。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT2]: {
    id: FOE_MOUNT_IDS.chargeSwarmT2,
    name: '虫群冲锋器 T2',
    en: 'Hiveswarm Charger T2',
    charge: { mul: 2, cooldownMs: 10_000, webImmune: true },
    note: 'C 族 T2（星髓成虫）：船长 2026-09-16「C族全部添加冲锋，按照级别分别为1.5/2/2.5/3/4」。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT3]: {
    id: FOE_MOUNT_IDS.chargeSwarmT3,
    name: '虫群冲锋器 T3',
    en: 'Hiveswarm Charger T3',
    charge: { mul: 2.5, cooldownMs: 10_000, webImmune: true },
    note: 'C 族 T3（孢群异虫）：同上按档口径（2026-09-16 前它是族内唯一不具冲锋资格的舰级）。',
  },
  [FOE_MOUNT_IDS.chargeSwarmT4]: {
    id: FOE_MOUNT_IDS.chargeSwarmT4,
    name: '虫群冲锋器 T4',
    en: 'Hiveswarm Charger T4',
    charge: { mul: 3, cooldownMs: 10_000, webImmune: true },
    note: 'C 族 T4（噬口巨兽）：船长 2026-09-14「大虫子的冲锋倍率改为3」。',
  },
  [FOE_MOUNT_IDS.droneRangeX4]: {
    id: FOE_MOUNT_IDS.droneRangeX4,
    name: '机巢增程阵列',
    // 「机巢」按同族既有译法 `Hive Dock`（`mod-wh-g-hangar` 亡军蜂巢坞）取 `Drone Nest`，
    // 「增程」= `Range`、阵列 = `Array`（与 `Tracking Array` 同族写法）
    en: 'Drone Nest Range Array',
    droneRangeOnHit: { mul: 4 },
    note:
      'E 族三舰（巨构残段 / 奥罗残骸段 / 巨构核心段）：本体被命中 ⇒ 整队机群射程 ×4（迁移前 droneRangeMulOnHit: 4）。' +
      '船长 2026-09-16：作用面保持「整队标量」、零行为变化。',
  },
  [FOE_MOUNT_IDS.captureWeb]: {
    id: FOE_MOUNT_IDS.captureWeb,
    name: '劫掠捕获网',
    // 「捕获网」在英文表里没有冻结词条 ⇒ 取 `Snare Net`（机制句 `ui.foeIntro.102` 英文侧用的也是 snare net）
    en: 'Raider Snare Net',
    web: { slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 },
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
    // 「观瞄」= `Optics`；族名按 §一 第 4 条与既有表：守墓 = `Gravekeeper`
    en: 'Gravekeeper Long-range Optics',
    gunRangeOnHit: { mul: 1.5 },
    note:
      'D 族静滞卫舰：从它射程之外被命中 ⇒ 本舰炮台射程 ×1.5（迁移前 gunRangeMulOnHit: 1.5）。' +
      '「只允许静滞卫舰」的约束改由 content:check 的挂载件契约守。',
  },
  [FOE_MOUNT_IDS.gunRangeX15Titan]: {
    id: FOE_MOUNT_IDS.gunRangeX15Titan,
    name: '巨构齐射观瞄',
    // 与 D 族那件**刻意不同名**（该件 note 明写"名字要不同"）⇒ 取「齐射」= `Salvo`
    en: 'Megastructure Salvo Optics',
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
    en: 'Support Call Device',
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
      '归档落点：docs/roadmap.md 2026-09-24 条 ＋ docs/glossary.md「敌方挂载件」词条（原设计稿已随归档删除）。',
  },
  [FOE_MOUNT_IDS.hullRepair]: {
    id: FOE_MOUNT_IDS.hullRepair,
    name: '船体修理装置',
    en: 'Hull Repair Unit',
    repairPulse: { everyMs: 5_000, armor: 15, hull: 15 },
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
    /**
     * **2026-09-26 船长令**：「入侵活动中，H族入侵母舰的挂载件复活效果，**改为每60秒复活2艘船**。
     * 且必定会复活干扰舰」⇒ `count: 2`（原 1 艘/次）+ `priorityShipIds`（**优先**复活干扰舰）。
     * ⚠ **同日追答**：「**应该是优先复活干扰舰**」⇒ 语义 = **优先**：干扰舰在可补池里就先占名额，
     *   它活着 / 已补进场则名额回落到随机（不是"无条件必补"）。
     * 池子/上限/满血/入场表现四条口径不变（见 `combat.resolveFoeRevive`）。
     */
    // ⚠ `'foe-h-ink-jammer'` = 墨潮干扰舰（`data/foe-ships.ts`）；core 侧不 import data ⇒ 写字面量
    reviveEscort: { everyMs: 60_000, count: 2, priorityShipIds: ['foe-h-ink-jammer'] },
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
    rangeDebuff: { pct: 0.5 },
    note:
      '船长 2026-09-26：「敌人的射程压制挂载件好像也还没有命名？」⇒ 选甲：把 H 族「墨潮干扰舰」' +
      '原先写在舰级字段上的 `foeRangeDebuffPct = 0.5` 迁成具名挂载件（数值一字不变）——' +
      '迁移后它有了名字、进敌舰悬停/战报的挂载件清单、也进 `foe:export` 的「H 族 · 挂载件」表；' +
      '与我方那件「墨潮电子舱」（`mod-lair-ecm-h`）是敌我同源的一对。' +
      '口径 = 削减我方武器最远射程 50%，与我方电子舰的削减做加法抵消（见 `meJammerNetOf`）。',
  },
  [FOE_MOUNT_IDS.coronaBlink]: {
    id: FOE_MOUNT_IDS.coronaBlink,
    name: '瞬光跃迁仪',
    en: 'Corona Blink Drive',
    // 距离 = 船长 2026-10-01 批的参数（选「甲」）：一次闪开 2,000 m · **被命中时触发**
    // 🔴 **冷却 12 秒 → 5 秒 → 12 秒**：2026-10-01「全族闪现的间隔下调到5秒」；
    //   🔴 **2026-10-03 船长令**：「**将敌人的闪现冷却时间延长到12秒**」⇒ **回到 12 秒**（现行）。
    // 🔴 `distanceM` = **单次位移上限**（**船长同日第三句**：「**闪现之前不是设定每次闪现最多2000米吗**」）：
    //   朝"它自己的期望交战距离"走一跳、一跳最多 2 公里 ⇒ 差得远就要多闪几次（船长选「乙：可扣死自毁」
    //   ⇒ 每闪一次扣结构上限 5%，代价按次计）。
    blink: { distanceM: 2_000, cooldownMs: 12_000 },
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
    // 「叠光」按舰级译名 `Overlay`（l10n 的 `Corona Overlay`）⇒ 本件取 `Corona Overlay Drive`
    en: 'Corona Overlay Drive',
    // 船长 2026-10-03 改判：步长 400ms、初始装填 4500ms（舰级定义）、下限 500ms、伤害 ×0.3。
    overlayDrive: { stepMs: 400, floorMs: 500, dmgMul: 0.3 },
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
    // 船长 2026-10-01 定案：护盾全回、结构按上限 5% 扣（选「甲」）、可扣死自毁（选「乙」）
    flashOverload: { healShield: true, hullCostPct: 0.05 },
    note:
      '船长 2026-10-01：「粼光添加闪烁过载装置，效果是每次触发闪现后，恢复所有护盾值。但是会损失最大结构值5%的结构。」' +
      '⇒ 只挂 R 族 T1 粼光级。两条追问的裁定：5% = 结构上限的 5%（甲，粼光级结构上限 29.85 ⇒ 每次扣 1.49）；' +
      '可以扣死自毁（乙，不设保底）⇒ 反复闪现会把结构扣到 0、该舰当场自毁。' +
      '⚠ 2026-10-03 船长令已把本件移交「回响级」（自粼光级移来，见 `foe-ships.ts` 的 `FOE_R_CORONA_ECHO`）。',
  },
  [FOE_MOUNT_IDS.coronaStandbyShield]: {
    id: FOE_MOUNT_IDS.coronaStandbyShield,
    name: '待机护盾阵列',
    // 命名规则第 4 条（族系前缀照译）：R 族五件一律 `Corona …`；本件取直译 `Standby Shield Array`
    en: 'Standby Shield Array',
    // 船长 2026-10-02 定案：50% 写死在件上（与闪烁过载的 hullCostPct 同款）、只护盾层、与闪现共用冷却
    standbyShield: { resistPct: 0.5, lingerMs: 2_000 },
    note:
      '船长 2026-10-02：「垂暮级添加挂载件，触发闪现时，触发的那次齐射受到的伤害减半。」' +
      '⇒ 我追问时点后船长改口径：「或者换个说法，闪现未处于冷却中的时候，护盾拥有全伤害50%的抗性。」' +
      '⇒ 只挂 R 族 T4 垂暮级。口径 = 闪现不在冷却中（`now >= BattleState.foeBlinks[tag]`，从未闪过也算可用' +
      '⇒ 开场即生效）时，护盾层对全部伤害类型 ×0.5；装甲/结构照常；2026-10-03 改判：闪现触发后延续 2 秒，之后失效，冷却结束恢复。',
  },
  [FOE_MOUNT_IDS.coronaFocusArray]: {
    id: FOE_MOUNT_IDS.coronaFocusArray,
    name: '聚焦阵列',
    en: 'Focus Array',
    // 船长 2026-10-02 定案：120 秒爬到 1.0、随波重置（同日改判"整场计时"）
    focusArray: { rampMs: 120_000, rangeBonusPct: 2, antiDroneBonusPct: 2 },
    note:
      '船长 2026-10-02：「然后给R族的入侵旗舰添加一个挂载件，武器的远端衰减，随时间提高到1（就是无衰减）。」' +
      '⇒ 只挂 R 族 T5 光环中枢（周末入侵旗舰战的 BOSS 本体）。' +
      '我提"整场计时"时船长改判：「旗舰挂载件的会随波重置」⇒ 计时锚 = 本波起点' +
      '（`BattleState.foeWaveStartMs`，缺省回落 `startedAtGameMs`），每波从头爬。' +
      '曲线 = min(1, falloff + (1 − falloff) × t ÷ 120000)；只影响它自己。2026-10-03 改判：同进度增加射程与对无人机近防伤害，满层修正率各 +200%，加算抵消负修正。',
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
  /**
   * **本条冲锋不吃网子的「关推进器」**（＝ C 族族设定，见 `FoeMountDef.charge.webImmune`）——
   * 由带该旗标的冲锋件解析而来；消费单点 = `combat.applyFoeWebDebuff`。
   */
  foeChargeWebImmune?: true
  foeDroneRangeMulOnHit?: number
  foeGunRangeMulOnHit?: number
  /** **劫掠捕获网**参数（原样带给单位；触发/作用面见 `FoeMountDef.web`） */
  foeCaptureWeb?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  /** **支援呼叫装置**参数（原样带给单位；判定/锁存/补偿口径见 `FoeMountDef.supportCall`） */
  foeSupportCall?: { delaySec: number; threatMul: number }
  /**
   * **姿态陀螺仪的闪避加数**（原样带给单位；消费方在建档时加进 `evasion` 并夹 0.9）。
   * ⚠ **多件相撞取「加和」**（2026-09-24 与一号的定义层合并时采用的口径：两件就是 +0.20）——
   * 与其余单值效果（冲锋倍率 / 射程倍率）的"后写覆盖"不同，闪避是**可以叠加**的加数。
   */
  foeEvasionBonusAdd?: number
  /** **船体修理装置的脉冲参数**（原样带给单位；`k` 由建档侧按本层威胁现算，见 `FoeMountDef.repairPulse`） */
  foeRepairPulse?: { everyMs: number; armor: number; hull: number }
  /** **支援舰船召唤装置的节拍**（原样带给单位；池子/上限/入场口径见 `FoeMountDef.reviveEscort`） */
  foeReviveEscort?: { everyMs: number; count?: number; priorityShipIds?: readonly string[] }
  /**
   * **射程压制阵列的削减率**（原样带给单位；消费方 = `meJammerNetOf` 那条链，逐字不变）。
   * 与舰级字段 `FoeShipDef.foeRangeDebuffPct` **同源不同入口**：解析后写进**同一个运行时字段**。
   */
  foeRangeDebuffPct?: number
  /**
   * **闪现跃迁参数**（原样带给单位；触发/钳制/冷却口径见 `FoeMountDef.blink`）。
   * ⚠ 这是本仓**唯一**会改 `BattleState.distanceM` 的敌方挂载件 —— 消费单点 = `combat` 的受击钩子旁。
   */
  foeBlink?: { distanceM: number; cooldownMs: number }
  /**
   * **叠光装置的两条参数**（原样带给单位；装填自加速的触发/下限口径见 `FoeMountDef.overlayDrive`）。
   * 消费单点 = `combat` 的装填推进处（按 `BattleState.foeOverlayReload[tag]` 现算）。
   */
  foeOverlayDrive?: { stepMs: number; floorMs: number; dmgMul: number }
  /**
   * **闪烁过载装置的参数**（原样带给单位；护盾全回/结构代价口径见 `FoeMountDef.flashOverload`）。
   * 消费单点 = `combat` 的闪现触发处（与 `markFoeBlink` 同点，闪现成功才结算）。
   */
  foeFlashOverload?: { healShield: true; hullCostPct: number }
  /**
   * **待机护盾阵列的参数**（原样带给单位；条件/作用层口径见 `FoeMountDef.standbyShield`）。
   * 消费单点 = `combat.applyFoeUnitDamage`（打敌舰本体的唯一收口：按"闪现是否在冷却中"决定
   * 是否给护盾层并进那层抗性）。
   */
  foeStandbyShield?: FoeMountDef['standbyShield']
  /**
   * **聚焦阵列的参数**（原样带给单位；曲线/计时锚口径见 `FoeMountDef.focusArray`）。
   * 消费单点 = `combat` 敌方开火段（按**本波起点**现算当拍的远端衰减系数）。
   */
  foeFocusArray?: FoeMountDef['focusArray']
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
 * 多件同类相撞：**闪避加数取「加和」**（可叠加）、其余效果取**最后一件**（后写覆盖先写）；
 * **`foeChargeWebImmune` 是"沾上就生效"的旗标**（只有 true、不会被后面的件抹掉）；
 * 未知 id 不生效、只登记在 `unknown` 里。`names` 与 `namePairs` 保持挂载顺序、逐项对齐。
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
      // **C 族族设定**（2026-09-30）：四件虫群冲锋器带 `webImmune` ⇒ 本单位的冲锋不被网的「关推进器」解除
      if (def.charge.webImmune === true) out.foeChargeWebImmune = true
    }
    if (def.droneRangeOnHit) out.foeDroneRangeMulOnHit = def.droneRangeOnHit.mul
    if (def.gunRangeOnHit) out.foeGunRangeMulOnHit = def.gunRangeOnHit.mul
    if (def.web) out.foeCaptureWeb = { ...def.web }
    if (def.supportCall) out.foeSupportCall = { ...def.supportCall }
    // **加和**（与一号定义层合并后的口径）：两件陀螺仪 = +0.20，上限由建档侧夹 0.9
    if (def.evasionBonus) out.foeEvasionBonusAdd = (out.foeEvasionBonusAdd ?? 0) + def.evasionBonus.add
    if (def.repairPulse) out.foeRepairPulse = { ...def.repairPulse }
    if (def.reviveEscort) out.foeReviveEscort = { ...def.reviveEscort }
    if (def.rangeDebuff) out.foeRangeDebuffPct = def.rangeDebuff.pct
    // 闪现跃迁（2026-10-01）：多件相撞取**最后一件**（与冲锋/射程倍率同款"后写覆盖先写"）
    if (def.blink) out.foeBlink = { ...def.blink }
    // 叠光 / 闪烁过载（2026-10-01）：同款"后写覆盖先写"
    if (def.overlayDrive) out.foeOverlayDrive = { ...def.overlayDrive }
    if (def.flashOverload) out.foeFlashOverload = { ...def.flashOverload }
    // 待机护盾阵列 / 聚焦阵列（2026-10-02）：同款"后写覆盖先写"
    if (def.standbyShield) out.foeStandbyShield = { ...def.standbyShield }
    if (def.focusArray) out.foeFocusArray = { ...def.focusArray }
  }
  return out
}
