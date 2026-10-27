/** 战斗域：model，从原引擎按职责迁移，保持结算顺序。 */
import type { DamageType, FoeFamily, ShipRole, DamageResists, FoeReinforceTrigger, FoeSupportBranch, FoeDroneSlot, FoeTactic } from '../types'
import type { Hp3 } from './combatMath'

/** 仅隔离靶场传入，不入真实状态或存档。伤害仍走实战命中与分层结算。 */
export interface BattleSimulationOptions {
  distanceM: number
  layer: 's' | 'a' | 'h'
  onShot?: (shot: { index: number; weapon: WeaponSpec; hit: boolean; damage: number }) => void
}

/** 武器来源（2026-09-10 船长批：无人机战斗动画差异化地基——纯展示字段，不参与任何数值结算） */
export type WeaponSrc = 'turret' | 'missile' | 'laser' | 'drone' | 'base'

/** 静态武器卡 */
export interface WeaponSpec {
  acidOnHit?: import('../types').ModuleDef['acidOnHit']
  foeDroneRangeBonusPct?: number
  /** 运行规格中的装配型号，仅用于逐件列表，不新增随档字段。 */
  moduleId?: string
  label: string
  /** gun = 我方炮台/导弹架（吃弹药，按 shotsByType 给单发伤害）；beam = 激光炮（必中、
   * 逐发扣能量弹药、威力随距离衰减）；fixed = 固定单发（基础舰炮/无人机/敌方） */
  kind: 'gun' | 'beam' | 'fixed'
  /** 武器来源（展示层用：无人机机群/弹道形制据此区分；缺省 = 旧口径不区分） */
  src?: WeaponSrc
  /** 无人机机型 id（src='drone' 时携带：drone-scout/assault/heavy/sentry —— UI 按机型出机体与弹点） */
  artId?: string
  /** **备用机条目**（2026-09-12 乙 · 备用机库）：`true` = 本条目属于**备用机**（开局在库、战损后补位）。
   *  只作**账目标记**：总火力/守恒类核对一律排除它（备用机是"库存深度"，不是常驻齐射的一份）。
   *  缺省 = 常备机（零行为变化）。 */
  reserve?: boolean
  /** fixed/beam 的固定伤害类型（beam = plasma 能量弹药键） */
  fixedType?: DamageType
  /** fixed/beam 单发伤害 */
  shotDmg?: number
  /** gun：弹型 → 单发伤害（构建期含 dmgMult×(1+炮术×5%)×(1+powerBonus)×伤害稳定器） */
  shotsByType?: Partial<Record<DamageType, number>>
  /**
   * **【我方】叠光同款 · 装填自加速参数**（**船长 2026-10-01 令**）—— 由 R 族势力特色激光炮
   * （`mod-lair-laser-r` 的 `ModuleDef.overlayDrive`）在建档时带来；缺省不写 ⇒ 既有各武器零行为变化。
   */
  overlayDrive?: { stepMs: number; floorMs: number }
  railCharge?: import('../types').ModuleDef['railCharge']
  /**
   * **【敌方】连发**（**船长 2026-10-02 令**：「**每次开火是三次间隔100ms的射击，目标选择随机**」）——
   * 由舰级字段 `FoeShipDef.burst` 原样带来（目前只有 R 族 T5「光环中枢」写）。
   *
   * 口径 = **一轮装填**打 `shots` 发、发间隔 `gapMs`：前 `shots − 1` 发之后装填计时**重置为
   * `gapMs`**（不是 `reloadMs`），最后一发之后才回到 `reloadMs` ⇒ 复用既有"一次装填一发"的开火环，
   * 每发都会各自 `pickTarget()`（**逐发独立选靶**）。缺省不写 ⇒ 一门一次、既有武器零行为变化。
   */
  burst?: { shots: number; gapMs: number }
  /** V18 同型合并条目代表的**武器门数**（同 id 同参炮台/激光合并为「×N 齐射」一条，缺省 1）。
   *  **2026-09-11 修复**：一轮齐射按**门数**扣弹（此前只扣 1 发 → 多门武器等于白嫖弹药；
   *  弹药预载同样按门数放大，见 `ammoLoadTotals`）。 */
  count?: number
  /** 敌方主炮门数；不改变shotDmg的武器组总伤语义。 */
  gunCount?: number
  /**
   * **全体攻击**（2026-09-13 船长：C 族「孢子导弹巢」＝「对所有敌方同时攻击」）：
   * `true` = 本武器每轮齐射**逐个结算到全部存活敌舰**（逐目标独立掷命中、各吃各自的层克制与抗性），
   * 演出层按目标数推多条弹道 ⇒「一次罩住全场」。缺省 = 单目标（既有武器零变化）。
   */
  allFoes?: boolean
  /** **附加伤害段**（2026-09-13 虫洞专属·掠袭破片炮）：主段结算之后，按**主段实收** ×该比例
   *  再打一段**固定弹种**的伤害——与主段弹种/所耗弹药无关（船长：「是附加伤害，和弹种无关」） */
  secondaryDamagePct?: number
  /** 附加段弹种（缺省 kinetic） */
  secondaryDamageType?: DamageType
  /** 每次攻击消耗的弹药发数（缺省 1；陵卫连装炮 = 2）——预载与实战扣弹都按「门数 × 本值」 */
  ammoPerShot?: number
  /** V18.1 索敌阵列（命中件）：炮台命中整体乘子（EVE 曲线合成；仅 gun 携带，缺省 1；
   * beam 必中不携带——命中件对激光无效） */
  eqHitMul?: number
  /** 敌方近盲带伤害比例；玩家舰载武器统一走playerBlindDamageMul。 */
  blindDmgMul?: number;
  /** 旧战斗基础炮的禁用占位，不开火、不展示，保留后续武器下标。 */
  disabled?: boolean
  /**
   * **防空**（属性 · 引擎侧标记）——**装备带「防空」属性**（`ModuleDef.antiDrone`）时写入本字段。
   * 只有带本标记的武器能筛到敌方无人机；不带 = 按构造看不到机群
   * （与我方'无人机是子单位、不进主目标池'的既有契约同源）。
   *
   * 口径（设计稿 `docs/design/foe-drone-system-20260911.md` §四/S4）：
   * - 玩家侧 = **真武器**（占槽、可打机群、**也可打舰**——船长 C1「玩家的炮能，敌方的不能。
   *   毕竟玩家的是真的武器」）；玩家侧首件 = **近防炮**；
   * - **我方的无人机不算防空武器**（船长 B1）⇒ 想打机群就得装防空武器；
   * - 敌侧近防炮是**抽象自动系统**（不参与对玩家的常规攻击），**不走本字段**（船长 B3/C1）。
   * ⚠ 缺省 = 打不到敌机 ⇒ **既有武器零行为变化**。
   */
  canHitDrones?: boolean
  /**
   * **防空属性**的第二半：**对无人机伤害倍率**（与 `canHitDrones` 同源，来自 `ModuleDef.antiDrone`）——
   * 船长 2026-09-12：「近防炮给予一个对无人机伤害加成」→「**那伤害倍率按2倍算**」。
   * ⚠ **只对机群生效**——对舰伤害一字不动（`tests/pd-damage-ladder.test.ts` 锁住对舰单发定值 10/16/17）。
   */
  antiDroneMul?: number
  maxRangeM: number
  minRangeM: number
  hitRate: number
  falloff: number
  reloadMs: number
}

/** 静态单位卡（构建后不进存档） */
export interface UnitSpec {
  /** 每场重建的镀膜装甲，仅用于开场残余与跨场损伤结算。 */
  shieldArmorHp?: number
  shieldPassiveBonusPct?: number
  droneHpMul?: number
  rebirthRepair?: import('../types').ModuleDef['rebirthRepair']
  crisisOverload?: { rangeMul: number; damageMul: number; speedMul: number; droneInitialMul: number; droneCycleMul: number }
  speedBonusModules?: Array<Pick<import('../types').ModuleDef, 'speedBonusPct' | 'speedRamp'>>
  /** 玩家无人机首次出击间隔；缺省为500ms。 */
  droneLaunchGapMs?: number
  /** 复活入队的旧机库等待，不叠加首发新装备或船体特性。 */
  droneReviveGapMs?: number
  acidBurst?: import('../types').FoeShipDef['acidBurst'] & { shieldDamageMul?: number }
  foeHatchery?: import('../types').FoeMountDef['hatchery']
  foeFleetSpeedRamp?: import('../types').FoeMountDef['fleetSpeedRamp']
  corrosionAppliedPct?: number
  tag: string
  name: string
  /** **舰种档**（1 护卫舰 … 5 旗舰；2026-09-12 加）：敌方单位 = 编成条目所引舰级的档位；
   *  旧威胁推导路径不写（缺省按 1 处理）。用途 = **敌舰近防炮的档系数**（`balance.pdTierMul`）。 */
  hullClassTier?: number
  /**
   * **敌族**（**2026-09-25 船长令**：H 族近防炮单独特化）：由 `createFoeSpecs` 按舰级写。
   * 用途 = **按族的近防炮覆写**（`balance.pdFamilyOverride`）；缺省（旧路径/合成 spec）= 全局值。
   */
  family?: FoeFamily
  /**
   * **我方单位的舰种档**（虫洞 D 批 · 2026-09-13）：`createPlayerSpec` 恒按 `ShipDef.tier` 写入。
   * 用途 = 敌方选靶模式「**打最小的 / 打最大的**」（见 `pickMyUnitTarget`）。
   * ⚠ 与 `hullClassTier` 同义但**分开**：后者是敌方字段（旧路径缺省按 1），混用会让
   * "旧路径敌舰缺省档 1"污染我方选靶判据。
   */
  shipTier?: number
  /** **我方单位的舰种定位**（虫洞 D 批）：`createPlayerSpec` 恒按 `ShipDef.role` 写入。
   *  用途 = 敌方选靶模式「**打非战斗船**」——`industrial`（工业/采矿）与 `hauler`（货舰）算非战斗，
   *  `armed`（武装）/ `armored`（装甲）算战斗。 */
  shipRole?: ShipRole
  /**
   * **我方舰 id**（`createPlayerSpec` 恒写）——损伤管制装置启动时要"从本舰货仓取组件"
   * （「从母港仓库取用」开着时改走仓库），故需要它。
   */
  shipId?: string
  /**
   * **被选中权重**（**2026-09-26 船长令**）：靶标插件 ×2 / 隐匿插件 ×0.4，由 `createPlayerSpec`
   * 按插件累乘写入（多件相乘，与"不吃递减"一致）。**缺省 / 1 = 与改动前逐位等价**。
   *
   * 语义 = **敌方挑目标时这一条被抽中的相对权重**（船长明确「**增加被选中的权重**」⇒
   * 不改命中率、不改回避，只改选靶）。
   */
  targetWeightMul?: number
  /**
   * **损伤管制装置**（**2026-09-25 船长令**：「当舰船第一次结构低于 1 时，将结构恢复到 1（避免一次死亡）」
   * ＋「触发损管效果时需要消耗一份」＋改判「**1 秒内结构锁定 1**」）。
   *
   * 值 = 启动时消耗的**组件物品 id**（`'repairkit-dc'`）；不写 = 本舰没装该件 ⇒ 免死逻辑整条不生效。
   */
  hullSaveKit?: string
  /**
   * **我方「后勤舰」标记**（船长 2026-09-16：「**后勤舰添加特性，维修装置可以修理血量最少的队友**」）：
   * `createPlayerSpec` 按 `ShipDef.subClass === '后勤舰'` 写入（现在只有「亡军后勤舰」一艘）。
   * 语义 = 本舰的**船体维修装置脉冲改为修队友**（三层剩余比例最低者，含自己）；不写 ⇒ 只修自己（旧口径）。
   */
  logistics?: boolean
  /**
   * **敌方后勤舰：把自身多少比例的名义 DPS 转成修理值**（`FoeShipDef.repairPct` 下发的运行时副本；
   * 见 `types.ts` 该字段的完整口径）。缺省 ⇒ 该敌舰零行为变化。
   */
  repairPct?: number
  side: 'me' | 'foe'
  hp: Hp3
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
  /**
   * **本舰无人机结构层加成**（2026-09-13 船长：G 族「鱿蜂结构层」＝残兵结构层改名 ——
   * 「提高无人机 80% 的结构」）＝ 该舰所装模块 `droneHullHpBonusPct` 之和。
   * 只放大**机群生存池的结构层**（`DronePoolEntry.h`），与三层血 buff 同链、在建池时一次算清。
   */
  droneHullBonusPct?: number
  /**
   * **本舰无人机护盾层加成**（**2026-09-27 船长令**：无人机护盾投射仪）：该舰所装模块
   * `droneShieldHpBonusPct` 之和；只放大**机群生存池的护盾层**（`DronePoolEntry.s`），与三层血同链。
   */
  droneShieldBonusPct?: number
  /**
   * **对方对机群的命中收窄**（**2026-09-29 船长令**：巨构导控塔「对方对无人机的命中收窄 5%」）＝
   * 该舰所装模块 `droneHitGapPct` 之和（只有一件带它时与"取值"等价，与上面两条无人机旋钮同款）。
   *
   * 消费点 = `droneHitChance`：综合闪避 = 机型闪避 × (1 − 本值)，等价于**打机群的命中 ×0.95**。
   * ⚠ 只作用于"打机群"这一支，打舰与敌方近防炮两条链一字不动（见 `ModuleDef.droneHitGapPct`）。
   */
  droneHitGapPct?: number
  evasion: number
  hitBonus: number
  /** V17.1 开火失稳乘子（**点火期值**）：推进器点火期间命中整体 ×hitMul；V18.1 多件推进器只取
   * 最重（削减最大）一件；**2026-09-10 船长：代价只在点火期生效** → 冷却期不用本字段（见 stepBattle 的 meAtk） */
  hitMul?: number
  signatureM: number
  scanResMm: number
  /** 基础战斗机动速度（不含推进器）——推进器改为周期爆发（见 thrusterBoost），
   *  实际机动 = 本值 ×(1 + 爆发期内的 thrusterBoost) */
  speedMps: number
  agility: number
  weapons: WeaponSpec[]
  /** 推进器爆发倍率（2026-09-10 船长定：多件 EVE 曲线收敛后的合成值 − 1，如 MK1 = 0.4）；
   *  **只在爆发窗口内生效**（`thrusterPhase` 判定），冷却期不生效 → 缺省 0 = 无推进器 */
  thrusterBoost?: number
  /**
   * **本单位的推进器点火周期**（2026-09-14 船长新增「微型跃迁引擎」：点火 **10 秒** / 冷却 **60 秒**，
   * 而三档矢量推进器仍是 60/60）——周期自此**逐单位**判定：
   * - 装配里**没有任何覆盖件** ⇒ 这两个字段**不写** ⇒ 走 `balance.battle` 的全局值（**旧读数逐字不变**）；
   * - 有覆盖件 ⇒ 取**点火最短的那件**（同长再取冷却更短的那件），见 `createPlayerSpec`。
   * 判定单点 = `thrusterPhase(battle, bal, unitThrusterCycle(u, bal))`（引擎与界面同源）。
   */
  thrusterBoostMs?: number
  thrusterCooldownMs?: number
  /** 锁定装置（2026-09-09）：被锁定目标受本舰伤害加深等效比例（多件 EVE 曲线收敛）；
   *  >0 同时表示"本场集火模式"——全部武器打存活编队首位（替代每发随机分散） */
  lockedDmgBonus?: number;
  /**
   * **本单位的隐身窗口时长（ms）**（2026-09-15 船长：「隐秘行动装置」——高槽，**自身武器开火前
   * 隐身 20/30 秒**：不被锁定、不被攻击）。
   *
   * `createPlayerSpec` 写入：取所装隐秘装置里**最长**的一件；**装了任何推进器 ⇒ 不写**
   * （船长同日追加的禁令：「有推进器类的时候直接解除隐身」）。
   * 缺省不写 ⇒ 零行为变化（未装装置的船、敌舰、老档）。
   */
  stealthMs?: number;
  /** 敌冲锋（2026-09-10 船长定；资格 2026-09-11 扩为两条来源；**2026-09-14 改逐单位**）：本单位为 true 时，
   *  触发条件命中即**自己**加速（×`foeChargeMul`）、**自身炮台命中我方即解除** + 逐单位冷却。
   *  来源 ① **挂载件**（`FoeMountDef.charge`，2026-09-16 起）／舰级级 opt-in（`FoeShipDef.foeCanCharge`，兼容回退）
   *  ② 老路（威胁 ≥ 门槛 且 brawl）。 */
  foeCanCharge?: boolean;
  /** 本单位的冲锋倍率（**2026-09-14 船长：「大虫子的冲锋倍率改为3，给小虫子添加冲锋，倍率为1.5」**）——
   *  缺省不写 ⇒ 走全局 `BattleBalance.foeChargeMul`（**旧读数逐字不变**）。 */
  foeChargeMul?: number;
  /** **本单位的冲锋冷却覆写**（2026-09-16 船长：A 族海盗「冲锋倍率为1.6，**冷却30秒**」）——
   *  缺省不写 ⇒ 走全局 `BattleBalance.foeChargeCooldownMs`（10 秒）。 */
  foeChargeCooldownMs?: number;
  /**
   * **本单位的「闪现跃迁」参数**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）——
   * 由 R 族那件「瞬光跃迁仪」（`FoeMountDef.blink`）解析而来。
   *
   * 消费点 = **本体被命中的那一处**（与 `foeDroneRangeMulOnHit` / `foeGunRangeMulOnHit` 同一个钩子）：
   * 拉开 `BattleState.distanceM` 并盖冷却（冷却态记在 `BattleState.foeBlinks[tag]`，`kind: 'runtime'`）。
   * 缺省不写 ⇒ 既有各族各件零行为变化。
   */
  foeBlink?: { distanceM: number; cooldownMs: number };
  /**
   * **本单位的「叠光装置」参数**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者
   * 闪现后，攻击间隔缩短，最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。**」）——
   * 由 R 族 T3 叠光级那件「叠光装置」（`FoeMountDef.overlayDrive`）解析而来。
   *
   * 消费点两处：① **开火**处（用当前间隔重置装填计时、随后递减）；② **闪现**处（闪现一次也递减）。
   * 当前间隔记在 `BattleState.foeOverlayReload[tag]`（`kind: 'runtime'`）。缺省不写 ⇒ 零行为变化。
   */
  foeOverlayDrive?: { stepMs: number; floorMs: number; dmgMul: number };
  /**
   * **本单位的「闪烁过载装置」参数**（**船长 2026-10-01 令**：「**粼光添加闪烁过载装置，效果是每次
   * 触发闪现后，恢复所有护盾值。但是会损失最大结构值5%的结构。**」）——
   * 由 R 族 T1 粼光级那件「闪烁过载装置」（`FoeMountDef.flashOverload`）解析而来。
   *
   * 消费单点 = 闪现**成功**那一刻（`settleFoeBlinkExtras`）：护盾直接回满、结构 −结构上限的 `hullCostPct`
   * （**无保底 ⇒ 可扣死自毁**，船长选「乙」）。缺省不写 ⇒ 零行为变化。
   */
  foeFlashOverload?: { healShield: true; hullCostPct: number };
  /**
   * **本单位的「待机护盾阵列」参数**（**船长 2026-10-02 令**：「**闪现未处于冷却中的时候，
   * 护盾拥有全伤害50%的抗性。**」）—— 由 R 族 T4 垂暮级那件「待机护盾阵列」
   * （`FoeMountDef.standbyShield`）解析而来。
   *
   * 消费单点 = `applyFoeUnitDamage`：闪现冷却已满延迟且尚未结束时，把抗性并进护盾层。
   * （与既有层抗**乘算**：`1 − (1−a)(1−b)`；装甲/结构不并）。缺省不写 ⇒ 零行为变化。
   */
  foeStandbyShield?: import('../types').FoeMountDef['standbyShield'];
  /**
   * **本单位的「聚焦阵列」参数**（**船长 2026-10-02 令**：「**武器的远端衰减，随时间提高到1
   * （就是无衰减）。**」＋改判「**旗舰挂载件的会随波重置**」）—— 由 R 族 T5 光环中枢那件
   * 「聚焦阵列」（`FoeMountDef.focusArray`）解析而来。
   *
   * 消费单点 = 敌方开火段（本单位的**当拍**远端衰减系数按本波起点现算，见 `coronaFocusFalloffOf`）；
   * 衰减与近防只影响自己，射程通过全队聚焦来源传播。缺省不写 ⇒ 零行为变化。
   */
  foeFocusArray?: { rampMs: number; rangeBonusPct?: number; antiDroneBonusPct?: number };
  /** 守墓族「苏生协议」：一次性致命保底与五秒总量维修。 */
  foeRebirthProtocol?: import('../types').FoeMountDef['rebirthProtocol'];
  /** 守墓族「陵墓装甲」：装甲/结构容量与全抗性修正。 */
  foeMausoleumArmor?: import('../types').FoeMountDef['mausoleumArmor'];
  /** 永陵级「守墓镀层装甲」：装甲受伤叠加的全抗性。 */
  foeCoatingArmor?: import('../types').FoeMountDef['coatingArmor'];
  /** 永陵级「护盾蓄能装置」：空盾后永久启用的武器修正。 */
  foeShieldCapacitor?: import('../types').FoeMountDef['shieldCapacitor'];
  /**
   * **本条冲锋不吃网子的「关推进器」**（**2026-09-30 船长令**「给C族添加族设定，他们的冲锋不会被网子
   * 解除」；见 `FoeMountDef.charge.webImmune`）——C 族四件「虫群冲锋器」解析出来的旗标。
   *
   * 消费单点 = `applyFoeWebDebuff`：本旗标为 true 时**不清零** `thrusterBoost`
   * （我方「墨潮捕获网」三层的"推进器全关"对本族不生效；**减速与闪避归零照旧**）。
   * 缺省不写 ⇒ 旧口径（能被网关推进器）。
   */
  foeChargeWebImmune?: true;
  /**
   * **截击舰特性 · 不会被网子选为目标**（**2026-09-30 船长令**「给拦截舰添加效果，不会被网子选为目标」；
   * 数据开关 = `ShipDef.interceptorImmuneToWeb`）。
   *
   * 消费单点 = `fireFoeCaptureWeb` 的入口守卫（敌方「劫掠捕获网」在首次开火选靶时跳过本船）。
   * ⚠ 只豁免那四层减益，**普通炮火照旧会打**。缺省不写 ⇒ 旧口径（会被网钉住）。
   */
  interceptorImmuneToWeb?: boolean;
  /**
   * **【我方】闪现跃迁参数**（**船长 2026-10-01 令**：「闪现装置为中槽，和R族同款，挨打触发闪现。
   * 但是冷却时间延长到12秒。」）—— 由 R 族势力特色中槽件 `mod-lair-blink-r` 带来。
   * 消费点 = 敌方舰炮命中我方那两处（光束 / 实弹）；冷却态记在 `BattleState.meBlinks`。
   * 缺省不写 ⇒ 既有各装配零行为变化。
   */
  meBlink?: { distanceM: number; cooldownMs: number }
  /** **本单位的挂载件展示名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——建档时由 `mounts` 解析，
   *  视图与战报直接渲染；**不是 id**、也不参与任何判定。 */
  foeMountNames?: readonly string[]
  /**
   * **同序的「双语名对」**（2026-09-24 加；与 `foeMountNames` 逐项对齐）——
   * 显示层按当前语言挑一列（`BattleScreen.mountNamesTextOf`）；缺省 ⇒ 回退中文名数组。
   */
  foeMountNamePairs?: ReadonlyArray<readonly [string, string]>
  /** **单波次内增援**（2026-09-11 船长裁决：机制实现、不启用）——本单位的入场触发条件；
   *  **建档时已按总开关过滤**：开关关闭时本字段一律不写（= 开战即在）。
   *  带本字段的单位**不进开战编队**，由 `advanceBattleFor` 每拍检查、条件命中才补入。 */
  foeReinforceAt?: FoeReinforceTrigger
  /**
   * **支援呼叫分支**（2026-09-19 船长「支援呼叫装置」批）——本条目属于哪一支援军
   * （`'inside'` = 判定时玩家在呼叫者射程内 / `'outside'` = 在射程外）。
   *
   * ⚠ **建档时一律带上**（不受总开关影响）：洞内派生要用它排除"不到场的那一支"
   * （见 `wormholeSkippedBranch`）——它只是标签，**入场与否仍由 `foeReinforceAt` 决定**。
   */
  foeReinforceBranch?: FoeSupportBranch
  /**
   * **支援呼叫装置参数**（2026-09-19 船长：「**战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远
   * 射程之外时，增援2艘静滞卫舰。**」）——挂件在**呼叫者**自己身上：它决定"何时判定 + 判定基准射程"，
   * 两支的到场单位由卡的条目声明（`enterAt` ＋ `foeReinforceBranch`）。
   * **建档时按总开关过滤**（关 = 不写 = 本机制完全不参与，零行为变化）。
   */
  foeSupportCall?: { delaySec: number; threatMul: number }
  /** **本单位自己的有效射程带**（m）——**只有舰级路径会写**（`createFoeSpecsFromShips`；
   *  含条目 `rangeMul`/`rangeMinM`/`rangeMaxM` 覆写后的绝对值）。
   *  用途：`foeDesiredRange` 在**舰级路径**上以"自己的带"取代旧路径的全局战术表，
   *  让期望交距落在自己打得到的距离（2026-09-11 船长裁决②）。
   *  **旧威胁推导路径一律不写本字段** ⇒ 旧口径行为一字不动。 */
  foeRangeBand?: { min: number; max: number };
  /** **期望作战距离覆写**（米；见 `FoeShipDef.desireRangeM`）——写了的单位直接用这个值 */
  foeDesireRangeM?: number;
  /** **本单位的舰载机群**（2026-09-11 机群批）——只有舰级路径写入（`FoeShipDef.drones` 原样带到单位上）。
   *  用途：①建档时把机群展开成 `src:'drone'` 的武器条目（每架一条）；②开战与每次换波按机型
   *  `defense` 建生存池（`BattleState.foeDronePools`，按 tag 索引、与本单位 drone 条目**同序**）。
   *  **不写 = 无机群** ⇒ 既有单位一字不动。 */
  foeDrones?: readonly FoeDroneSlot[]
  /** **受击增程倍率**（见 `FoeShipDef.droneRangeMulOnHit`；2026-09-11 船长：「受到攻击后，大幅提高
   *  无人机射程（提高 400%）」）——舰级路径把该字段带到单位上；**任一此类敌舰被命中一次**即在
   *  `BattleState.foeDroneRangeBuff`（**标量**）上给**整支敌队**盖章，此后**所有敌舰**的机群射程
   *  ×本倍率（本场永久）；提示只推一条（船长二次裁定：「只触发一次，**对所有敌舰生效**」）。 */
  foeDroneRangeMulOnHit?: number
  /** **受击增程（炮台）倍率**（见 `FoeShipDef.gunRangeMulOnHit`；2026-09-12 船长：D 族静滞卫舰
   *  「挨打后射程增加 50%」，**只影响所有静滞卫舰**）——与机群那条**同款触发、不同作用面**：
   *  任一此类敌舰被命中 ⇒ `BattleState.foeGunRangeBuff` 盖章；读射程时**只对本字段存在的单位**生效。 */
  foeGunRangeMulOnHit?: number
  /** 实际挂载件的触发提示编号，仅用于显示，不入档。 */
  foeGunRangeNoticeId?: string
  /**
   * **劫掠捕获网**（船长 2026-09-16，A 族新舰「劫掠电子舰」专属；参数见 `FoeMountDef.web`）：
   * 本舰**第一次开火那一刻**（不看命中）钉住**它这一发的目标**；**击杀发动者**（2026-09-16）
   * 或**交战距离超过 4500 米**（**2026-09-26**「这个断开对敌我都有效」）即解除，整场只张一次。
   * 被钉的我方舰：战斗机动 ×`slowMul`（0.1）· 推进器全关 · 闪避归零 · 武器射程 −`rangeDownM`。
   */
  foeCaptureWeb?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  /**
   * **我方「墨潮捕获网」**（**船长 2026-09-26**，H 族势力装备之一；模块字段见 `ModuleDef.captureWebCycleMs`）：
   * 带本字段的我方舰 = 一台**周期装置**——钉一艘**未被钉住**的敌舰（**独立瞄准 · 不看命中**）；
   * ⚠ **不是"开战即钉"**：只有交战距离 ≤ `MY_WEB_RANGE_M`（3800 米）时才张网（船长 2026-09-26 令
   * 「我方网子的射程是3800米」）。
   * **一次使用进入冷却**的两种情形：目标被击沉、**与目标距离超过 4500 米断开**（`WEB_BREAK_DIST_M`，
   * 船长同日追答「断开也当使用一次」）——冷却结束再选新目标；**携带者被击沉** ⇒ 该网解除。
   * 效果三层：机动 ×0.5（**减速 50%**，船长 2026-09-26 改判；原 ×0.1）· 推进器全关 · 闪避归零（⚠ **不含射程**，船长同日明令移除）。
   * 周期账本 = `BattleState.myWebs`，被钉状态 = `BattleState.foeWebDebuffs`（见 `advanceMyCaptureWebs`）。
   *
   * ⚠ **三项读数随件上字段走**（**2026-09-29 船长令**：关键属性要"进属性里"）：
   * `rangeM`（投网射程）/ `breakM`（断开距离）/ `slowMul`（减速倍率）由 `ModuleDef.captureWeb*` 供给，
   * 缺省回落到 `MY_WEB_RANGE_M` / `WEB_BREAK_DIST_M` / 0.5 ⇒ 老档与既有件零行为变化。
   */
  myCaptureWeb?: { cycleMs: number; rangeM: number; breakM: number; slowMul: number }
  /** **单次出击上限**（见 `FoeShipDef.droneLaunch`；2026-09-12 船长「限制敌机单次出击数量」） */
  foeDroneLaunch?: { maxAloft: number; cycleMs?: number; keepDps?: boolean }
  /** **备用机库**（见 `FoeShipDef.droneReserve`；2026-09-12 船长「损坏后补充敌机」） */
  foeDroneReserve?: { count: number; respawnMs: number }
  /**
   * **敌方「射程压制」**（H 族墨潮干扰舰 · 2026-09-24 船长；见 `FoeShipDef.foeRangeDebuffPct`）：
   * 本舰压制**我方武器**的最远射程，多艘乘法合成、与我方电子舰的削减**做加法抵消**。
   * 缺省不写 ⇒ 不压制（既有全部敌舰零行为变化）。
   */
  foeRangeDebuffPct?: number
  /**
   * **姿态陀螺仪的闪避加数**（船长 2026-09-24；见 `FoeMountDef.evasionBonus`）——建档时**已经加进**
   * `evasion` 并夹到 0.9 上限；本字段只是把"这件件给了多少"留在单位上（战报/读数/用例用）。
   * 缺省不写 ⇒ 零行为变化。
   */
  foeEvasionBonusAdd?: number
  /**
   * **船体修理装置的逐单位脉冲参数**（船长 2026-09-24；见 `FoeMountDef.repairPulse`）——
   * `k` = **本层本次实际威胁 ÷ 45**（建档时按本场是哪张卡/哪一层/什么用途现算），
   * 每 `everyMs` 给**它自己**回 `round(armor × k)` 装甲与 `round(hull × k)` 结构（各层夹满值）。
   * 缺省不写 ⇒ 该单位没有这个机制（零行为变化）。
   */
  foeRepairPulse?: { everyMs: number; armor: number; hull: number; k: number }
  foePointDefenseEnabled?: boolean
  /**
   * **支援舰船召唤装置的节拍**（船长 2026-09-25；见 `FoeMountDef.reviveEscort`）——
   * 挂件单位（入侵母舰）每 `everyMs`（60 秒）把**当前波已阵亡**的敌舰满血复活入场
   * （新 tag `sup{n}-<原tag>`；上限 = 不超本波原编成）。缺省不写 ⇒ 该单位不会召唤（零行为变化）。
   *
   * ⚠ **2026-09-26 船长改判**：「入侵活动中，H族入侵母舰的挂载件复活效果，**改为每60秒复活2艘船**。
   * 且**必定会复活干扰舰**」⇒ `count`（每次艘数）与 `priorityShipIds`（优先名单）随挂载件带到单位上；
   * **同日追答**「**应该是优先复活干扰舰**」⇒ 名单是**优先**语义：名单内的舰在可补池里就先占一个名额
   * （它活着 / 已补进场则名额回落到随机）。
   */
  foeReviveEscort?: import('../types').FoeMountDef['reviveEscort']
  foeSummonEscort?: import('../types').FoeMountDef['summonEscort']
  /** 只在建档时派生；读档按本场原成虫条目重新建立，不写入存档。 */
  foeSummonTemplate?: UnitSpec
  foeTactic: FoeTactic | null
  /**
   * **舰级 id**（2026-09-24 加；只给"舰级路径"建的敌单位写）：旗舰 BOSS 的伤害台账靠它认出母舰
   * （战斗态里此前没有"我是哪条舰级"的标记）。缺省 = 旧路径 ⇒ 零行为变化。
   */
  foeShipId?: string
}

/**
 * **敌群强度覆写**（2026-09-23 周末入侵）：给"从卡派生敌群"的两条开战入口一个**可选覆写口**——
 * 入侵的威胁/波数是**绝对值**（旗舰 120 威胁 · 4 波 · 每波 4 艘），而卡表里的卡自带自己的强度，
 * 不覆写就只能打成"原卡强度"。**不传 = 一字不变**（既有调用方与读数不受影响）。
 */
export interface FoeOverride {
  threat?: number
  waves?: ReadonlyArray<{ units: number; hpShare: number }>
  /**
   * **保留卡自带的波表**（2026-09-24 加；船长给定 H 族入侵卡"每波各自编成"时要用）：
   * 置真 ⇒ `waves` **不覆盖**卡上的 `waves`（卡自己声明了 4 波各自的编成与波血）。
   * 缺省假 = 老行为（覆写波表，如入侵原先固定的"4 波 × 4 艘"）。
   */
  keepCardWaves?: boolean
  /**
   * **真·强度倍率**（2026-09-25 船长令「**遇袭的时候遭遇的敌人按强度 ×0.75 算**」）：
   * 把每条 `ships[]` 的 `hpMul`/`dmgMul` 同乘该倍率（血与火力同缩 ⇒ `X` 同缩），
   * `firepowerAnchor` 一并按倍率缩放（同"重定价批"的落法）。
   *
   * ⚠ **它只改属性，不改标签**：调用方若要把标签写对，必须接着用 `foeThreatOfAnomaly(缩放后的卡, 系数, bal)`
   * 反解（本函数不碰 `threat`，避免"标签 ≠ 实测价"）。
   * 缺省 / 非正 / 等于 1 ⇒ 不缩放（零行为变化）；**只对舰级路径（写了 `ships[]`）生效**
   * （旧路径卡的强度由威胁曲线表达，本倍率对它无意义）。
   */
  strengthMul?: number
  /**
   * **BOSS 血条覆写**（2026-09-25 船长令「甲：母舰血条 = 池子剩余」）：
   * 把 `ships[]` 里 `ship.id === bossShipId` 的那条目 `hpMul` 覆写成 `bossHp ÷ 舰级血`
   * ⇒ 该单位建档后的**满血 = `bossHp`**（三层按该条目的血型分摊）。缺省/非正/缺 `bossShipId` ⇒ 不动。
   *
   * ⚠ **在 `strengthMul` 之后施加且取绝对值**（BOSS 血条由池子说了算，不再吃强度倍率）；
   * 覆写会随档存进 `BattleState.foeOverride` ⇒ 逐拍重建母舰时血条恒等于池子剩余。
   */
  bossHp?: number
  /**
   * **BOSS 血条的"上限读数"**（船长 2026-09-25：「**母舰哪怕残血，在战斗中血上限依旧保持不变**」）：
   * `bossHp` 是**这一场的满值**（= 开战那一刻的池子剩余），池子被打薄之后它就变小 ⇒ 若直接拿它当
   * 血条分母，最后几仗会显示成"满血母舰"（读数与"母舰已经很残"矛盾）。
   * ⇒ 本字段写**池子总量**（恒定），只用于**界面血条的分母**（`battleArcsFor` 的 `maxHp.foe`）：
   * 战斗里那条血 = `当前 ÷ 池子总量`（残血就是残血）。
   *
   * ⚠ **只动显示**：单位自己的 `hpMax`（引擎满值）与伤害台账（`flagshipBattleLedger` =
   * `ΣhpMax − Σhp`）一个字不改——否则跨场累计会重复计伤害。
   * 缺省 / 非正 / 不大于本场满值 ⇒ 不缩放（零行为变化）。
   */
  bossHpMax?: number
  /**
   * **母舰"当前"三层血**（船长 2026-09-25 令：「**母舰当前血条不要按照三个等比扣除，应该按照
   * 护盾-装甲-结构的顺序扣除**」）——由 `weekendEvent.weekendFlagshipLayersOf` 按"池子剩余从最后一层
   * 往回灌"算好传进来（护盾先空、再装甲、最后结构）。
   *
   * 落法 = 把 `ships[]` 里 BOSS 那条目的 **`split` 覆写成 `bossHpLayers ÷ bossHp`**
   * ⇒ 建档后三层血**逐个等于**本字段（`hp = 总量 × split`）。
   * ⚠ 这**不只是显示**：`applyDamage` 逐层乘"层克制 × (1−该层该系抗性)"⇒ 分层血量决定每发实收伤害。
   * 缺省 ⇒ 仍按卡面 `split` 等比分摊（老档/其它卡零变化）。
   */
  bossHpLayers?: { s: number; a: number; h: number }
  /**
   * **母舰三层血的容量**（= 池子总量 × 卡面 `split`）：**界面血条三行的分母**（恒为池子口径，
   * 不随剩余缩水）——与"当前值"（`bossHpLayers`）分开给，界面**不许**拿当前值反推分母。
   */
  bossMaxLayers?: { s: number; a: number; h: number }
  /** 哪一条舰级当 BOSS（配 `bossHp` 用；缺省 = 不覆写） */
  bossShipId?: string
}
