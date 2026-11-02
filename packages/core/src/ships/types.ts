import type { DamageType, DamageResists, ShipRole, ShipSubClass, ShipSlots } from '../types'
import type { ShipCommandDef } from '../combat/command/types'

/** 舰船定义 */
export interface ShipDef extends ShipCommandDef {
  rangeEwBonus?: number
  rangeEwEquipmentBonusPct?: number
  /** 船体固有首次无人机队列等待缩短；不作用于复活入队或攻击装填。 */
  droneLaunchCutPct?: number
  id: string
  name: string
  /** 档次 1/2/3/4，仅用于展示排序 */
  tier: number
  /** 船型角色（V10：舰船细分系统的占位字段，本轮仅 UI 徽标展示） */
  role: ShipRole
  /** 纯货舰装配：只允许自身防御、航运与作业装备；旧虫洞趟由实例查询保留旧规格。 */
  civilianFittingOnly?: boolean
  /** **舰种子分类**（仅虫洞专属舰船写；见 `ShipSubClass` 注释） */
  subClass?: ShipSubClass
  /** 货舱容量（立方米） */
  cargoM3: number
  /** 单个采集循环耗时（秒），受技能缩短 */
  cycleSeconds: number
  /** 每个循环的基础产量（单位资源），受技能加成 */
  oreUnitsPerCycle: number
  /** 空间站售价（ISK），0 = 初始自带或仅可制造 */
  priceIsk: number
  /** 动力/机动性 0~1（v7）：越高越容易在交火失利时脱离，降低弃船率 */
  agility: number
  /** 基础火力加成（V10.5 契约：战斗系统启用；本轮引擎不读取） */
  powerBonus?: number
  /** 船体武器族加成（EVE 式族加成，2026-09-09 船长拍板：四族巡洋分型——只作用于对应弹型的
   *  三族武器条目单发，装别族武器无加成但仍可用；无人机/基础舰炮不受；值 = 比例，如 0.12 = +12%） */
  weaponFamilyBonus?: Partial<Record<DamageType, number>>
  /** 船体无人机专属加成（2026-09-10 船长拍板：无人机舰的加成改成"专属"——原来那笔 powerBonus
   *  只喂炮台、对机群无效，等于把母舰往炮舰方向推）。只乘入**放飞无人机单发**，与战术导控
   *  与无人机作战学**乘算**；对称于武器族加成。现挂：王鲭级 +12%、梭鱼级 +8% */
  droneDmgBonus?: number
  /* ═══ V10.5 战斗数值契约（三层血量；引擎战斗实现后启用） ═══ */
  /** 护盾层基础量（抽象战斗单位） */
  shieldHp?: number
  /** 装甲层基础量 */
  armorHp?: number
  /** 结构层基础量（V10 占位字段 hull 已由本字段取代） */
  hullHp?: number
  /** 护盾层对三系伤害的基础抗性（简化规则：每层至多一个主抗型、取值整数档 0.25/0.5，其余键省略 = 0） */
  shieldResist?: DamageResists
  /** 装甲层对三系伤害的基础抗性（同上：整数主抗制） */
  armorResist?: DamageResists
  /** 结构层对三系伤害的基础抗性（同上：整数主抗制） */
  hullResist?: DamageResists
  /* ═══ V10.5b：装配资源与间接属性（契约占位；CPU=装备与无人机共用，带宽已并入） ═══ */
  /** CPU 总量（抽象单位：装配模块与放飞无人机共同消耗；引擎战斗期校验） */
  cpu?: number
  /**
   * V18 高/中/低槽布局（每类槽的安装位数量；复数安装·数量制——缺省 {1,1,1}，
   * 正式内容全部显式标注；19 船草案表见 docs/design/v18-slots.md §四）。
   */
  slots?: ShipSlots
  /**
   * **舰船插件槽数**（**2026-09-26 船长令**：「**改为越低级的船插槽越多。T1~T5分别为5/4/3/2/1个插槽**」）。
   *
   * 插件的专用槽位：与高/中/低槽**互不相干**（不进 `FittedModules`，走 `FleetShipState.plugs`），
   * 上限 = 本值。**越低级的船越多** ⇒ T1 小船 5 格、T5 旗舰 1 格。
   * ⚠ **只有 T1~T5 有**：无档船（采矿艇 / 货舰等 `tier` 不在 1~5 的）**一律无插件槽**。
   * 缺省不写 = 0（不装插件）。
   */
  plugSlots?: number
  /** 无人机舱容量（m³，携带上限之一；0 = 无无人机舱） */
  droneBayM3?: number
  /** 无人机放飞所需的 CPU 占位资源已在 ItemDef.cpuUse；此处不重复定义 */
  /* ── 间接属性（EVE 参考；显示优先级低：仅装配界面展示；数值占位、战斗作用待战斗系统定） ── */
  /** 最大速度 m/s */
  maxSpeedMps?: number
  /** 跃迁速度 AU/s */
  warpSpeedAus?: number
  /** 质量 kg */
  massKg?: number
  /** 锁定范围 m */
  lockRangeM?: number
  /** 信号半径 m */
  signatureM?: number
  /** 扫描分辨率 mm */
  scanResMm?: number
  /* ── 已移除（V16.1 简化）：锁定目标数 maxTargets（引擎无引用，纯展示冗余）；起跳时间 alignSec（语义反直觉，
     由派生属性"跃迁充能"取代：跃迁充能速率 = 动力(agility)×200%，动力越高充能越快，仅展示挂钩） ── */
  /* ═══ V11 战斗：命中/回避（与信号/锁定挂钩，见命中公式） ═══ */
  /** 基础回避率 0~0.9（被命中减算；受自身信号半径修正：小信号更难打中） */
  evasion?: number
  /** 命中率加成 0~0.5（打敌方时加到武器命中率上；受自身扫描分辨率修正） */
  hitBonus?: number
  /* ═══ 2026-09-13 船长：虫洞族专属舰船的"船体固有新机制"（三项都由船长点名） ═══ */
  /**
   * **按系武器射程加成**（如炮艇「动能武器射程 +30%」）——与模块的 `rangeTypeBonusPct` **同链加算**：
   * 实际射程 = 基础 × (1 − 全局削减) × (1 + 本系加成)（`combat.createPlayerSpec` 的 `rangeOf`）。
   */
  weaponRangeBonusPct?: Partial<Record<DamageType, number>>
  /**
   * **全舰（编队）单发伤害光环**（如指挥舰「全舰单发伤害 +15%」）——对**全队每艘船**的每条武器统一乘
   * `(1 + 本值)`；**多艘同类**只取**最高**、不叠加（与"同项取优"惯例一致）；单舰场景 = 对自己生效。
   *
   * **落点（2026-09-17 修）**：由 `combat.applyFleetDamageAura` 施加，**每拍重建规格处
   * （`buildMyUnitSpecs`）与开战建档处（`startFleetBattleFor`）各调一次**。
   * ⚠ 修前它只在 `startFleetBattleFor` 里乘一次，而开火读的是每拍重建后的规格 ⇒ **光环从未生效**
   * （真 BUG：真引擎 A/B 每发均值 91.640 vs 91.640、比值 1.000，生效应 ≈1.15）。新加同类光环时，
   * **一律走"每拍重建处施加"这条纪律**（谜质增益 / 捕获网 / 教学战加成 / 锁定阵列全队光环同款）。
   */
  fleetDamageBonusPct?: number
  /**
   * 编队扫描半径加成（圈）：侦察舰与电子舰各取最高值、两类相加（2026-10-17船长确认）。
   */
  wormholeScanRadiusBonus?: number
  /**
   * **后勤舰：维修脉冲改为在编队里挑目标**（船长 2026-09-16：「**后勤舰添加特性，维修装置可以修理
   * 血量最少的队友。**」＋同日「**我发现之前给后勤舰的维修特性并添加到船体特性属性中？**」⇒
   * 从"`subClass === '后勤舰'` 代码硬判据"改为**本字段驱动**，从而能进界面的「船体特性」栏）。
   *
   * 口径：装了维修装置时，脉冲目标 = **全编队三层剩余比例最低的舰船（含自己）**；缺省 ⇒ 只修自己（旧口径）。
   * 落点：`combat.createPlayerSpec` 写入 `spec.logistics` ⇒ `pulseAllyRepair` 的选靶分支。
   */
  /** 后勤舰维修输出倍率；作用于船体维修装置、修理无人机与护盾恢复。 */
  repairOutputBonusPct?: number
  /** 旧存档/旧测试夹具兼容字段；新数据不再声明，运行时不再提供队友选靶。 */
  repairPulseTargetsFleet?: boolean
  /**
   * **侦察舰特性 · 隐秘行动装置 CPU 减半**（船长 2026-09-16：「**侦查舰添加特性，隐秘行动装置所需
   * CPU 降低50%**」；口径四答取「**乙：向上取整**」⇒ MK2 55 → **28**、MK3 80 → 40）。
   *
   * 值 = 倍率（`0.5`）；**只作用于带 `stealthMs` 的装置**（本船其它件的 CPU 一律不折）；
   * 引擎按 `ceil(cpuUse × 本值)` 折算 ⇒ 单点 = `equipment.cpuUseOf`（装配校验 / 面板 / 战斗建档三处同源）。
   * 缺省 = 1（非侦察舰一字不变）。**数据字段驱动**（照 2026-09-16「后勤舰」先例），界面「船体特性」栏同源。
   */
  stealthCpuMul?: number
  /**
   * **侦察舰特性 · 免推进器失效**（船长 2026-09-16：「**且移除推进器失效惩罚**」，口径四答取
   * 「甲：**完全移除**」）：本船装着推进器族（`slot: 'propulsion'`，含微型跃迁引擎那 8 件）也
   * **照常隐身**（开火立即现形、超时现形这两条照旧）。
   *
   * 缺省 / 非本船 ⇒ 旧口径（船长 2026-09-15「有推进器类的时候直接解除隐身」）＝**任一推进器在装即判 0**。
   * 落点 = `combat.createPlayerSpec` 的隐形窗口段；界面「船体特性」栏同源。
   */
  stealthIgnoresPropulsion?: boolean
  /**
   * **电子舰特性 · 压制敌舰武器射程**（船长 2026-09-18：「**电子舰新增特性，削减敌人15%的武器射程，
   * 可以乘法叠加，与敌人的射程增加效果做加法处理。（比如10000m射程，我方一艘电子舰，对方拥有射程+50%，
   * 那么对方实际射程为13500.）射程最短只能削弱到3000m（不足3000m的无法被削弱）。**」）
   *
   * **值 = 本船自己的削减比例**（电子舰 = `0.15`）。编队口径（船长裁定甲）：
   * **多艘先乘法合成** `r = 1 − Π(1 − vᵢ)`（1 艘 15% · 2 艘 27.75% · 3 艘 38.6%…），
   * **再与敌方"射程增加"做加法**：**净倍率 = `1 + 敌方加成 − r`**（不是乘法）。
   * **地板**：敌方**基础**射程 < `FOE_RANGE_DEBUFF_FLOOR_M`（3000m）⇒ **完全不削**（只吃它自己的增程）；
   * 否则削后结果**下限 3000m**。**只动最远射程**，近界不动（与既有「受击增程」口径一致）。
   *
   * **落点（两处既有单一真相源，开火门/距离衰减/界面射程标签自动跟随）**：
   * `combat.foeGunMaxRangeOf`（舰体武器）与 `combat.foeDroneRangeOf`（敌方机群放飞射程）；
   * 编队削减率每拍重算进运行态 `BattleState.meFoeRangeDebuff`（**不随档** ⇒ 读档/换编队都不陈旧）。
   * 全仓现只有两艘「电子舰」带此字段（`sh-wh-a-frigate` / `sh-wh-d-frigate`），
   * 契约见 `tools/content-check.ts`「电子舰特性契约」。**数据字段驱动**（照 2026-09-16「后勤舰」先例），
   * 界面「船体特性」栏同源。缺省 = 不削（零行为变化）。
   */
  foeRangeDebuffPct?: number
  /**
   * **截击舰特性 · 不会被网子选为目标**（**船长 2026-09-30**：「**给拦截舰添加效果，不会被网子选为目标**」）。
   *
   * 语义：敌方「劫掠捕获网」（`FoeMountDef.web`——A 族劫掠电子舰 / H 族突击舰与干扰舰）在**首次开火**
   * 选靶时**跳过本船** ⇒ 本船既不会被钉住、也不吃那四层减益（机动骤降 / 推进器熄火 / 闪避归零 / 射程缩短）。
   * ⚠ 只豁免**那四层减益**：普通炮火的选靶、命中判定与伤害**一字不改**（照旧会被打）。
   *
   * 实现口径 = **数据字段驱动**（照 2026-09-16「后勤舰」先例，**不硬判 `subClass === '截击舰'`**）：
   * `combat.createPlayerSpec` 带出 `spec.interceptorImmuneToWeb`，**消费单点** =
   * `combat.fireFoeCaptureWeb` 的入口守卫；被跳过时敌方那张网**保留待发**（与"目标已被别的网钉住"
   * 同一处置，见该函数头注第 3 条），等它这一发/下一发打到合法目标再发。
   *
   * 全仓现只有两艘截击舰写它（`sh-wh-c-frigate` / `sh-wh-c-destroyer`），
   * 契约见 `tools/content-check.ts`「截击舰特性契约」。缺省 ⇒ 旧口径（零行为变化）。
   */
  interceptorImmuneToWeb?: boolean
  description: string
  /**
   * **未上线闸门（施工期）**——语义与口径**完全同 `ItemDef.unreleased`**（2026-09-13 船长铁律
   * 「虫洞完成之前，对玩家不可见」）：标了 ⇒ 不进任何"给玩家看的全目录枚举"
   * （首例 = 手册**舰船图鉴**，它直接遍历 `SHIPS` 全目录）。
   *
   * 为什么舰船也要这一道：未上线的船一旦登记进 `SHIPS`，舰船图鉴 / 组装机舰船下拉就会
   * 连名字带描述一起露出去——与 2026-09-13 物品那次（虚空母矿挂上工业页）是同一个坑。
   * **引擎内部照用 `SHIPS` 全目录**（舰种契约、战斗建档、价格口径都不受影响）。
   * **上线动作 = 删掉这一个字段**。
   */
  unreleased?: boolean
}
