/** 功能域职责拆分，保持原计算与顺序。 */


/**
 * **敌方挂载件 id**（2026-09-16 船长：「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了**」
 * ＋「**除了C族，将D族和E族的射程增加也迁成挂载件**」）——目录表在 `core/foeMounts.ts`（`FOE_MOUNTS`）。
 * 写成字面量联合 = 数据侧写错 id 会**当场编译不过**（比字符串松类型更能防手滑）。
 */
export type FoeMountId =
  | 'foe-mount-charge-pirate'
  | 'foe-mount-charge-swarm-t1'
  | 'foe-mount-charge-swarm-t2'
  | 'foe-mount-charge-swarm-t3'
  | 'foe-mount-charge-swarm-t4'
  | 'foe-mount-drone-range-x4'
  | 'foe-mount-gun-range-x1-5'
  /**
   * **巨构齐射观瞄**（船长 2026-09-19）：E 族导弹残段专属的炮台受击增程件。
   * ⚠ 与 `foe-mount-gun-range-x1-5`（D 族「守墓远距观瞄」）**效果同档、各是一件**——
   * 船长：「只是采用类似的效果的挂载件，并不是真的是静滞卫舰的挂载件（因此名字要不同）」。
   */
  | 'foe-mount-titan-range-x1-5'
  /** 劫掠捕获网（船长 2026-09-16）：首次开火即钉住目标——减速 90% + 关推进器 + 闪避归零 + 射程 −500m；
   *  2026-09-26 追加：交战距离超过 4500 米同样断开（`combat.WEB_BREAK_DIST_M`，敌我通用） */
  | 'foe-mount-capture-web'
  /** **支援呼叫装置**（船长 2026-09-19）：开战 20 秒后按距离呼叫一支支援军（延迟到场 ⇒ 实际威胁 ×1.1） */
  | 'foe-mount-support-call'
  /**
   * **姿态陀螺仪**（**船长 2026-09-24**）：「在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避」
   * ＋「**电子舰也要挂**」⇒ A 族洞内卡条目专属：该舰战斗中 **闪避 +0.10 加算**（上限 0.9 由消费方夹）。
   */
  | 'foe-mount-gyro-stabilizer'
  /**
   * **船体修理装置**（**船长 2026-09-24**）：「给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，
   * 会吃威胁的加成」⇒ G 族洞内卡条目专属：每 5 秒自修 **15 装甲 + 15 结构** × **层威胁倍率 k**
   * （基数经船长同日二次令**由 5/5 上调至 15/15**；`k = 该层本次实际威胁 ÷ 45`；见 `FoeMountDef.repairPulse`）。
   */
  | 'foe-mount-hull-repair'
  /**
   * **支援舰船召唤装置**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，只不过改为
   * **复活被摧毁的友军**（但是**表现形式上为敌方支援舰船入场**），**增援时间是60秒**，**每次随机复活一艘**」）。
   *
   * ⇒ **通用件**（将来别的卡/族也能挂），**先只装到 H 族入侵母舰**（`ink-flagship` 的母舰条目）：
   * 每 `everyMs`（60 秒）从**当前这一波编成里已阵亡的敌舰**中随机抽一艘，以**支援舰**身份**满血入场**
   * （新 tag `supN-<原tag>` ⇒ 界面 = 新的一艘支援舰飞进来，带入场动画与装填窗口）。
   * 见 `FoeMountDef.reviveEscort`。
   */
  | 'foe-mount-revive-escort'
  /**
   * **墨潮干扰阵列**（**船长 2026-09-26**：「**敌人的射程压制挂载件好像也还没有命名？**」⇒ 选甲）：
   * H 族「墨潮干扰舰」原先写在**舰级字段**上的 `foeRangeDebuffPct = 0.5` 迁成具名件（数值不变）。
   * 与我方那件「墨潮电子舱」（`mod-lair-ecm-h`）是**敌我同源的一对**。见 `FoeMountDef.rangeDebuff`。
   */
  | 'foe-mount-ink-range-debuff'
  /** 守墓碑卫级：压制玩家武器射程 15%。 */
  | 'foe-mount-d-range-debuff'
  /**
   * **瞬光跃迁仪**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）——
   * R 族「光环科技 / Corona Systems」的族级件，**五档壳体逐档常挂**（船长选「乙：五档全带」）。
   * 效果 = **本体被命中时拉开交战距离**（参数选「甲」：2,000 m / 冷却 12 秒）。见 `FoeMountDef.blink`。
   * ✅ 件名已获船长批准（**2026-10-01 船长令**：「**「瞬光跃迁仪」等件名提案可用**」）。
   */
  | 'foe-mount-corona-blink'
  /**
   * **叠光装置**（**船长 2026-10-01 令**）：R 族 T3 **叠光级**专属 —— 装填自加速（每次攻击/闪现
   * −400ms，下限 500ms）＋ 该舰全部伤害 ×0.3。见 `FoeMountDef.overlayDrive`。
   */
  | 'foe-mount-corona-overlay-drive'
  /**
   * **闪烁过载装置**（**船长 2026-10-01 令**）：R 族 T1 **粼光级**专属 —— 每次闪现后护盾回满，
   * 但损失**结构上限的 5%**（**可扣死自毁**，船长选「乙」）。见 `FoeMountDef.flashOverload`。
   */
  | 'foe-mount-corona-flash-overload'
  /**
   * **待机护盾阵列**（**船长 2026-10-02 令**：「**或者换个说法，闪现未处于冷却中的时候，
   * 护盾拥有全伤害50%的抗性。**」）—— R 族 T4 **垂暮级**专属。
   * 2026-10-08起：冷却满1秒后至结束前，护盾层获得50%全伤害抗性。
   * 见 `FoeMountDef.standbyShield`。
   */
  | 'foe-mount-corona-standby-shield'
  /**
   * **聚焦阵列**（**船长 2026-10-02 令**：「**然后给R族的入侵旗舰添加一个挂载件，武器的远端衰减，
   * 随时间提高到1（就是无衰减）。**」＋改判「**旗舰挂载件的会随波重置**」）—— R 族 T5 **光环中枢**专属。
   * 效果 = **它自己武器**的远端衰减系数从面板值线性爬到 1.0（无衰减），**随波重置**。
   * 见 `FoeMountDef.focusArray`。
   */
  | 'foe-mount-corona-focus-array'
  | 'foe-mount-corona-overlay-beacon'
  | 'foe-mount-d-rebirth-protocol'
  | 'foe-mount-d-mausoleum-armor'
  | 'foe-mount-d-coating-armor'
  | 'foe-mount-d-shield-capacitor'
  | 'foe-mount-d-reconstruction'
  | 'foe-mount-c-acid-charge'
  | 'foe-mount-c-acid-shield'
  | 'foe-mount-c-hiveback-charge'
  | 'foe-mount-c-broodmother-charge'
  | 'foe-mount-c-brood-control'
  | 'foe-mount-c-hiveback-hatchery'
  | 'foe-mount-c-broodmother-hatchery'

/**
 * **敌方挂载件定义**（船长 2026-09-16 三句合一的落点）：
 * - 「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了**」；
 * - 「**除了C族，将D族和E族的射程增加也迁成挂载件**」；
 * - 「**要：敌舰悬停/战报展示挂载件**」⇒ `name` 是**玩家可见**文案，进敌舰悬停与战报。
 *
 * 语义 = 挂在敌舰（**舰级 `FoeShipDef.mounts`** 或**卡条目 `FoeShipSlot.mounts`**，条目优先）上的装置，
 * 由 `foeMounts.resolveFoeMounts` **单点**解析成运行时字段（`UnitSpec.foeCanCharge` / `foeChargeMul` /
 * `foeChargeCooldownMs` / `foeDroneRangeMulOnHit` / `foeGunRangeMulOnHit` / `foeMountNames`）。
 * 一件**可以同时带多类效果**（如 A 族洞内的「劫掠冲锋推进器 ＋ 劫掠捕获网」同挂一件条目上；
 * 「一件一类效果」那条只约束**我方支援件** `ModuleDef`，见 §十四——此处 2026-09-24 更正旧注）。
 * 多件同类效果相撞时按 `resolveFoeMounts` 的"后写覆盖先写"聚合；`note` 写设计备注。
 */
export interface FoeMountDef {
  /** 仅爆虫自爆的护盾层独立乘区，不改变基础伤害系数或后续血层。 */
  acidShieldDamageMul?: number
  /** 仅携带者的舰炮/机群修正；机群增程保留基础值供电子压制加算。 */
  broodControl?: { gunDmgMul: number; droneDmgMul: number; droneRangeBonusPct: number }
  /** 战损后补回当前波的损失机位；无限后备采用可序列化标识。 */
  hatchery?: { cycleMs: number; stock: number | 'unlimited'; fleet?: true }
  /** 存活并实际参战期间，逐秒增加全队机动速度。 */
  fleetSpeedRamp?: { rampMs: number; maxBonusPct: number }
  id: FoeMountId
  /** 玩家可见名（敌舰悬停 / 战报里逐件列出） */
  name: string
  /**
   * **英文名**（2026-09-24 加；`l10n-overlay` 的 `overlayCardFoeMounts` 用它做英文界面的覆盖）。
   * 口径 = `docs/glossary-en.md`（术语与专名权威）：`姿态陀螺` = `Attitude Gyro`、
   * `船体维修装置` = `Hull Repair Unit`（`mod-hullrep-*` 同词）、`挂载件` = `Mount`。
   * ⚠ **缺省不写 ⇒ 英文界面回退中文名**（既有八件现状，待船长拍板译名后逐件补）。
   */
  en?: string
  /**
   * **冲锋装置**：触发后**本单位自己的机动 ×`mul`**（不外溢），解除后 `cooldownMs` 内不能再冲。
   * `triggerMarginM` 缺省 = 走全局 `BattleBalance.foeChargeTriggerMarginM`。
   */
  charge?: {
    mul: number
    cooldownMs: number
    triggerMarginM?: number
    /**
     * **网子的「关推进器」对本条冲锋无效**（**船长 2026-09-30**：「**给C族添加族设定，他们的冲锋
     * 不会被网子解除**」；口径追问取「**甲：网『关推进器』对 C 族无效**」）。
     *
     * 归属 = **C 族四件「虫群冲锋器」**（`chargeSwarmT1`~`T4`，C 族全舰常驻的那一件）；
     * A 族「劫掠冲锋推进器」**不写**。落点两处（缺一不可）：
     * ① 引擎 = `combat.applyFoeWebDebuff` **不清零**该单位的 `thrusterBoost`（我方「墨潮捕获网」那三层
     *    里的"推进器全关"对本族不生效，减速与闪避归零照旧）；
     * ② 玩家可见文案 = 件上的明文效果（`ui/foeBrief.mountEffectText` 在冲锋那句后多一句"网无法解除"）
     *    —— 战斗悬停 / 悬赏卡悬停 / 势力图鉴三处同源。
     */
    webImmune?: true
  }
  /**
   * **机群受击增程**：本体被命中一次 ⇒ **整支敌队的机群**射程 ×`mul`（整队标量 `foeDroneRangeBuff`，
   * 口径与迁移前**逐字一致**：任一挂件舰挨打即盖章、此后全队机群都吃）。
   */
  droneRangeOnHit?: { mul: number }
  /** **炮台受击增程**：**从它射程之外**被命中 ⇒ **本舰**炮台射程 ×`mul`（只对挂了本件的舰生效）。 */
  gunRangeOnHit?: { mul: number; effectTextId?: string; noticeTextId?: string }
  /**
   * **劫掠捕获网**（船长 2026-09-16：「劫掠捕获网：**降低目标90%移动速度，并关闭所有类型推进器**。
   * **在自身第一次开火时发动**。动画效果为一根蓝色的光速连着命中舰船」＋补充「**还会让目标闪避强制为0，
   * 射程降低500米**」）：本舰**第一次开火那一刻**（不看命中）钉住**它这一发的目标**。
   *
   * 四层效果（全部只作用于被钉的那一艘我方舰）：
   * - `slowMul`：战斗机动 ×本值（0.1 = 降低 90%）；
   * - `noThruster`：**关闭所有类型推进器**（点火期不再加成，微型跃迁引擎同样失效）；
   * - `noEvasion`：**闪避强制为 0**（敌方命中率 = 敌武器命中 + 加成 − 0）；
   * - `rangeDownM`：**武器射程 −本值**（两端各减，近界下限 1m）。
   *
   * **解除 = 击杀发动者，或交战距离超过 4500 米**（前者船长 2026-09-16；后者 **2026-09-26**
   * 「**将断开距离提高到4500米，且这个断开对敌我都有效**」⇒ `combat.WEB_BREAK_DIST_M`，见 `expireFoeWebs`）；
   * **多艘不叠加**（同一目标只生效一次）。⚠ 本网**整场只张一次** ⇒ 超距断开后该舰本场不再补发。
   * ⚠ 只影响**战斗**机动/射程，不影响星图航行。
   */
  web?: { slowMul: number; noThruster: true; noEvasion: true; rangeDownM: number }
  /**
   * **射程压制阵列**（**船长 2026-09-26**：「**敌人的射程压制挂载件好像也还没有命名？**」⇒ 选甲：
   * 把 H 族墨潮干扰舰的**舰级字段** `foeRangeDebuffPct = 0.5` **迁成具名挂载件**「墨潮干扰阵列」，
   * 数值一字不变）。
   *
   * 迁移的意义：① 它有了名字（玩家可见）；② 进**敌舰悬停 / 战报**的挂载件清单；
   * ③ 进 `foe:export` 的「H 族 · 挂载件」表；④ 与我方那件「墨潮电子舱」形成敌我同源的一对。
   * 解析后仍是**同一个运行时字段** `UnitSpec.foeRangeDebuffPct`（消费方 `meJammerNetOf` 一行不改）。
   */
  rangeDebuff?: { pct: number }
  /**
   * **闪现跃迁**（**船长 2026-10-01 令**：「**激光武器+闪现效果的挂载件**」）—— 给入侵第二族
   * R「光环科技 / Corona Systems」建的族级挂载件；势力图鉴那句「**拥有未知折跃能力的无人舰船**」
   * 由它兑现（文案与机制同源，见 `docs/design/weekend-faction-corona-20261001.md` §11.2）。
   *
   * 口径：**本舰本体被命中时**（与 `droneRangeOnHit` / `gunRangeOnHit` **同一个受击钩子**：
   * 打机群不算、未命中不算）触发一次**交战距离突变** —— 把 `BattleState.distanceM` **拉开
   * `distanceM` 米**，随后进入 `cooldownMs` 冷却（冷却期内再挨打也不闪）。
   *
   * ⚠ **本仓战斗不做二维坐标**：只有 `BattleState.distanceM` 这一个标量（＋ 我方 `myDesireM`）
   * ⇒「闪现」= **距离突变**，不涉及位置/寻路/表现层几何。突变后仍受既有钳制
   * （`bal.minDistanceM` 与 `battleMaxDistanceM()`）⇒ 不会闪出战场。
   * ⚠ **冷却状态记在 `BattleState.foeBlinks[tag]`**，与 `foeCharges`（冲锋循环）**同一口径**：
   * 登记为 `save.ts` 清洗器的 **`kind: 'runtime'`（有意不入档）**——落在既有的"重载即重置循环"口径内。
   * 缺省不写 ⇒ **零行为变化**（既有各件与既有族一律不受影响）。
   */
  blink?: { distanceM: number; cooldownMs: number }
  /**
   * **叠光装置**（**船长 2026-10-01 令**：「**添加叠光装置：效果是每次攻击或者闪现后，攻击间隔缩短，
   * 最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。**」）—— R 族「光环科技」T3 **叠光级**专属。
   *
   * 两条效果：
   * - **装填自加速**：每**攻击**一次或**闪现**一次 ⇒ 本舰装填间隔 `−stepMs`，**下限 `floorMs`**；
   * - **伤害折减**：`dmgMul` 乘在该舰**全部伤害**上（船长选「甲：该舰全部伤害 ×0.3」）——
   *   用来平衡"间隔越缩越短"。
   *
   * ⚠ 触发源是"每次**攻击**"，而攻击本身受当前间隔控制 ⇒ **自我加速**（间隔越短、单位时间触发越多）。
   * 船长令「**先计算叠满大概要打多久**」⇒ 读数（公式，步长 300ms 定案后；⚠ 该读数按**当时**的
   * 闪现冷却 5 秒算的"含闪现"一格——**2026-10-03 冷却延长到 12 秒后闪现那一路变稀**，
   * 叠满时长更接近"纯攻击"那一档）：
   * **纯攻击 30.3 秒 / 含闪现（每 5 秒挨打一次）18.0 秒**叠满（见工作文档 §14）。
   * ⚠ 当前间隔记在 `BattleState.foeOverlayReload[tag]`（`save.ts` 登记 `kind: 'runtime'`，
   * 与 `foeBlinks` / `foeCharges` 同一口径：**有意不入档**）。
   */
  overlayDrive?: { stepMs: number; floorMs: number; dmgMul: number }
  /**
   * **闪烁过载装置**（**船长 2026-10-01 令**：「**粼光添加闪烁过载装置，效果是每次触发闪现后，
   * 恢复所有护盾值。但是会损失最大结构值5%的结构。**」）—— R 族 T1 **粼光级**专属。
   *
   * 口径（船长同日四条追问的答复）：
   * - **5% = 结构上限的 5%**（船长选「甲」，不是总血上限）—— 粼光级结构上限 29.85 ⇒ 每次扣 **1.49**；
   * - **可以扣死（自毁）**（船长选「乙」）⇒ **不设保底**：反复闪现会把结构扣到 0、该舰当场自毁。
   */
  flashOverload?: { healShield: true; hullCostPct: number }
  /**
   * **待机护盾阵列**（**船长 2026-10-02 令**，原话两轮）：
   *
   * > ① 「**垂暮级添加挂载件，触发闪现时，触发的那次齐射受到的伤害减半。**」
   * > ② （追问减半时点后**改口径**）「**或者换个说法，闪现未处于冷却中的时候，护盾拥有全伤害50%的抗性。**」
   *
   * 口径（以第二轮为准，船长 2026-10-02 显式确认「按你的提案，开始做」）：
   * - 2026-10-08：闪现进入冷却满 `delayMs` 后生效，冷却结束失效；未闪现时不生效。
   * - **效果** = **只有护盾层**对**全部伤害类型**（动能 / 爆破 / 能量）获得 `resistPct` 抗性
   *   ⇒ 落在该层的伤害 ×(1 − `resistPct`)；**装甲 / 结构照常**；
   * - 与闪现共用冷却，取消旧的冷却外常驻抗性和触发后宽限。
   * - 数值**写死在件上**（与「闪烁过载」的 `hullCostPct` 同款），**不另开旋钮**。
   *
   * 缺省不写 ⇒ 既有各族各件**零行为变化**。
   */
  standbyShield?: { resistPct: number; delayMs: number }
  /**
   * **聚焦阵列**（**船长 2026-10-02 令**：「**武器的远端衰减，随时间提高到1（就是无衰减）。**」
   * ＋纠正"整场计时"的改判：「**旗舰挂载件的会随波重置**」）—— R 族 T5 **光环中枢**专属。
   *
   * 语义 = **它自己武器**的远端衰减系数 `falloff` 随**本波开战时间**线性爬升到 1.0：
   * `f(t) = min(1, falloff + (1 − falloff) × t ÷ rampMs)`（面板 `falloff` 0.2 ⇒ 第 60 秒 0.6）。
   * - **计时锚 = 本波起点**（`BattleState.foeWaveStartMs`，缺省回落到 `startedAtGameMs`）⇒ **每波从头爬**；
   * - 远端衰减与近防增伤只影响自己；2026-10-08起射程作用于全队，携带者被击毁即失效。
   * - 2026-10-03：射程与对玩家无人机的近防伤害修正率沿同一曲线爬升，加算抵消负修正；
   * - `rampMs` **写死在件上**。
   *
   * 缺省不写 ⇒ 既有各族各件**零行为变化**。
   */
  /** 射程与对无人机近防伤害修正率线性增长，和负修正率加算抵消。 */
  focusArray?: { rampMs: number; rangeBonusPct?: number; antiDroneBonusPct?: number }
  /** 首次致命攻击后的结构锁定与五秒分配维修。 */
  rebirthProtocol?: { repairMs: number; armorTotalPct: number; hullTotalPct: number }
  /** 装甲/结构容量与全抗性修正。 */
  mausoleumArmor?: { hpMul: number; resistPct: number }
  /** 永陵级装甲受伤叠层。 */
  coatingArmor?: { resistAdd: number; cap: number; durationMs: number }
  /** 永陵级空盾后的永久蓄能。 */
  shieldCapacitor?: { rangeMul: number; reloadMul: number; damageMul: number }
  /**
   * **支援呼叫装置**（船长 2026-09-19：「**战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程
   * 之外时，增援2艘静滞卫舰。**」＋「因为延迟到场，所以需要一定补偿。**卡计算的实际威胁要*1.1**」）。
   *
   * 口径：
   * - **呼叫者** = 挂本件的单位（本卡里 = 守墓王座舰），且必须在**开战即在**的编成里
   *   （体检会拦"挂在带 `enterAt` 的条目上"）；
   * - `delaySec`：**开战满 N 秒**判定一次——玩家在呼叫者**当时有效的炮台最远射程**内 ⇒ 到场的是
   *   `inside` 那一支；在射程外 ⇒ `outside` 那一支。**判完锁死**（另一支本场不再出现），
   *   锁存不占存档字段（由"哪一支已入场"反推，含尸体）；
   * - 两支由卡的编成条目声明（`FoeShipSlot.enterBranch` ＋ `enterAt`），**必须成对且账面总量相等**
   *   （体检守恒契约）；
   * - `threatMul`：**延迟到场的补偿**——本卡在洞内派生时的**实际威胁 ×本值**（该链上血与火力
   *   同乘约 ×1.16），卡面 `threat`（缩放锚点）不动。
   */
  supportCall?: { delaySec: number; threatMul: number }
  /**
   * **姿态陀螺仪**（**船长 2026-09-24**：「在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避」
   * ＋「**电子舰也要挂**」＋追问裁定「**陀螺仪 = 加算 +10 个百分点**（甲）」）。
   *
   * 语义 = **本舰战斗闪避 +`add`（加算的百分点，不是乘子）**，命中判定处生效
   * （我方武器对它的命中率 = `(武器命中 + 加成 − 闪避) × 距离折减`）⇒ 加了它就更难被打中。
   * `0.10` 即 22%（A 族 2026-09-24 提档后的舰级值）→ **32%**；劫掠电子舰 30% → **40%**（「电子舰也要挂」）。
   * **上限 0.9 由消费方夹紧**（与 `FoeShipDef.evasion` 同一把尺，字段只给加数）；
   * **多件相撞取加和**（见 `foeMounts.resolveFoeMounts`）。只挂**虫洞卡的条目**（星图侧不引用 ⇒ 零影响）。
   */
  evasionBonus?: { add: number }
  /**
   * **船体修理装置**（**船长 2026-09-24**：「给G族添加挂载件：船体修理装置。每5秒恢复5装甲和5结构，
   * 会吃威胁的加成」＋追问裁定「**修理量 = 乘层威胁倍率**（甲，归一基准"不改动"）」）。
   *
   * 语义 = **本舰自己**每 `everyMs`（5 秒）回 `armor` 装甲 ＋ `hull` 结构 **× k**，各层夹到自己的满值
   * （满血不回超）。**基数 = 15/15**（船长 2026-09-24 同日二次令「基础数值上调至15装甲15结构」；
   * 原令是 5/5）。`k = 该层本次实际威胁 ÷ 45`（45 = 第 1 层基准威胁 `WORMHOLE_THREAT_BASE`，
   * 层 1 的 k 恰为 1.00 = 船长说的归一基准）⇒ 层 1 = 15/15 · 层 7 ≈ 30/30 · 层 10 ≈ 42/42
   * （层末守卫另吃 ×1.2 的威胁倍率）。
   *
   * ⚠ **字段只给基数与节拍**：k 由消费方按"本场是哪张卡、哪一层、什么用途"现算
   * （`combat.createFoeSpecsFromShips` → `UnitSpec.foeRepairPulse.k`）——与「吃威胁加成」同源，
   * 且**不写进存档**（每拍按本场同一份派生重算，读档不会算出别的层）。
   * 与"敌方后勤舰"（`FoeShipDef.repairPct`：把自己的 DPS 折成修理值去修队友）是**两套机制**：
   * 本件**只修自己、不折自己的火力**，同节拍（5 秒）但各按各的计时器。只写**虫洞卡的条目**。
   */
  repairPulse?: { everyMs: number; armor: number; hull: number }
  /**
   * **支援舰船召唤装置**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，只不过改为
   * **复活被摧毁的友军**（但是**表现形式上为敌方支援舰船入场**），**增援时间是60秒**，**每次随机复活一艘**」）。
   *
   * 语义 = 挂件单位（入侵母舰）**每 `everyMs` 拍一次召唤**，把**当前波编成里已阵亡**的一艘敌舰
   * 以**支援舰**身份**满血**重新送进场：
   * - **表现** = 敌方支援舰船入场（新 tag `supN-<原tag>` ＋ `enteredAtMs` 入场窗口：动画演完才开火），
   *   与波次转场/单波增援**同一套演出与窗口口径**；
   * - **池子 = 当前波**（船长选定「只复活当前波已死的」）⇒ 母舰在第 4 波时只补第 4 波的僚舰；
   * - **上限 = 不超本波原编成**（死一个补一个；同型反复阵亡也照样能再入场 ⇒ 持续支援压力，
   *   但不会把战场堆成一团）；
   * - **母舰自己不在池内**（它死了这一场就结束）；
   * - 随机走 `state.rng`，但**只在挂了本件的战斗里消费** ⇒ 没挂件的战斗随机序列逐字不变；
   * - 受总开关 `BattleBalance.foeReviveEnabled` 约束（缺省关 ⇒ 零行为变化，与其余总开关同款形态）。
   *
   * ⚠ **2026-09-26 船长改判**：「入侵活动中，H族入侵母舰的挂载件复活效果，**改为每60秒复活2艘船**。
   * 且**必定会复活干扰舰**」；**同日追答**「**应该是优先复活干扰舰**」⇒ 加 `count`（每次几艘）与
   * `priorityShipIds`（**优先**名单）：一次到点最多补 `count` 艘（缺省 1，受"上限/可补池"双重封顶）；
   * 名单里的舰**在可补池里就先占一个名额**（按名单顺序），它活着或已补进场则名额回到随机池。
   */
  reviveEscort?: {
    everyMs: number
    /** 全部复活本波空槽中的阵亡友舰；缺省沿用count名额。 */
    all?: true
    /** 每次到点补几艘（缺省 1；2026-09-26 H 族入侵母舰 = 2） */
    count?: number
    /** 优先复活名单（舰 id；名单内且处于阵亡状态者必定占名额——2026-09-26 加：墨潮干扰舰） */
    priorityShipIds?: readonly string[]
    /** 仅允许这些舰级复活；缺省不限制，旧墨潮规则不变。 */
    allowedShipIds?: readonly string[]
    /** 使用携带者实际参战时长，避免后续波预积累。 */
    activeClock?: true
  }
  /** 主动召唤指定型号，规格取本场敌卡同型号条目，不复制召唤者的旗舰厚血。 */
  summonEscort?: {
    everyMs: number
    count: number
    shipId: string
    activeClock?: true
    /** 固定原编成空槽补位；不写时沿用巢母在场数量上限规则。 */
    formationSlots?: true
  }
  /** 设计备注（不进玩家视野） */
  note?: string
}

/** **支援呼叫装置的两支到场分支**（2026-09-19 船长批；见 `FoeMountDef.supportCall`）：
 *  `inside` = 判定时玩家**在呼叫者射程内**；`outside` = 在射程外。 */
export type FoeSupportBranch = 'inside' | 'outside'
