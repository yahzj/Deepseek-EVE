/**
 * V12 实时战斗引擎（核心逻辑，无 UI 依赖）。
 *
 * 模型（中文说明，详见 docs/design/v12-combat.md）：
 * - 编队对编队：我方 = 玩家主控船 1 单位（炮台或基础舰炮 + 装载的无人机各自展开为武器条目，
 *   无人机不单独成单位、不损毁）；敌方 = 异常点按威胁卡面展开：主体 + 0~2 僚机
 *   （卡面 threat = 编队总战力：主体份额 = T/(1+0.6×escorts)，僚机 = 主体×0.6）；
 * - BattleState 只存动态量（血/装填/距离/弹药/统计）；静态卡由 ship+fleet+anomaly 每次重建；
 * - 确定性事件步进：BATTLE_STEP_MS 基本步长；随机全部走 state.rng（种子可复现）；
 * - 命中：hit = clamp((weapon.hitRate + 攻方命中加成×锁定修正) × 距离衰减 − 守方有效回避)；
 * - 伤害：我方炮台单发 = 弹 dmg × dmgMult ×(1+5%/级炮术)×(1+powerBonus)（构建期折算好
 *   每型弹的单发伤害 shotsByType）；其它武器固定值；按 类型×层克制系数 ×(1−层抗) 逐层消费；
 * - 弹药：我方炮台开火即时消耗 1 发（弹型 = 剩余最多型，平局 kin→exp→pla）；
 *   战斗结束剩余退回仓库（V18 口径取消：单档通用弹，无轻/重之分）。
 */
import type { BattleBreakReason, BattleReportRecord, BattleReportSource, GameState } from './state'
import { addLog } from './state'
import type {
  AnomalyDef,
  BattleBalance,
  DamageResists,
  DamageType,
  DefProfile,
  FoeDroneSlot,
  FoeReinforceTrigger,
  FoeShipDef,
  FoeShipSlot,
  FoeTactic,
  FoeTargetingMode,
  ModuleDef,
  ShipRole,
  SimContext,
} from './types'
import { factionAnomalyOf, lairAnomalyOf } from './lairs'
import type { LairTier } from './lairs'
// 洞内敌卡的按层派生（F 批）：**单向依赖** —— wormholeFoes 只吃类型，不反向依赖本模块
import { WORMHOLE_FOE_BASE_STRENGTH_MUL, wormholeAnomalyOf } from './wormholeFoes'
import { wormholeFoeThreat } from './wormholeFoes'
// F3c 谜质（B1）：战斗增益一律从货仓**现算**（本模块只读，不反向依赖 wormhole.ts ⇒ 无环）
import { wormholeMatterBuffs, wormholeMatterThreatMul } from './wormholeMatter'
import type { WormholeMatterBuffs } from './wormholeMatter'
import { nextInt, nextRandom, pickOne } from './rng'
import { cargoItemsOf, countWare, removeItem, removeWare, addWare } from './inventory'
import { fleetDefOf, shipDisplayName } from './instances'
import { uidDefId } from './labels'
import { quickRepairFactor } from './repair'
import { allFittedModules, cpuBudgetOf, curveMult, familyModules, fittedCpuUsed, gapCombine, stackWeight, weightedSum } from './equipment'
import { applyTutorialBuff, isTutorialBattle } from './onboarding'

/** 战斗基本步长（毫秒） */
export const BATTLE_STEP_MS = 100
/** 步数守卫上限（防失控循环） */
export const BATTLE_MAX_STEPS = 40_000
/** 船体维修装置脉冲间隔（毫秒；2026-09-09 三档统一 5 秒一跳，见 data/modules.ts mod-hullrep-*） */
export const REPAIR_PULSE_MS = 5_000

/** 三层血量形状 */
export interface Hp3 {
  s: number
  a: number
  h: number
}

/** 武器来源（2026-09-10 船长批：无人机战斗动画差异化地基——纯展示字段，不参与任何数值结算） */
export type WeaponSrc = 'turret' | 'missile' | 'laser' | 'drone' | 'base'

/** 静态武器卡 */
export interface WeaponSpec {
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
  /** V18 同型合并条目代表的**武器门数**（同 id 同参炮台/激光合并为「×N 齐射」一条，缺省 1）。
   *  **2026-09-11 修复**：一轮齐射按**门数**扣弹（此前只扣 1 发 → 多门武器等于白嫖弹药；
   *  弹药预载同样按门数放大，见 `ammoLoadTotals`）。 */
  count?: number
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
  /** V18B 敌方近盲带伤害比例（2026-09-05）：敌在近盲带内（dist < minRange）仍开火，
   * 伤害 × 本值；玩家武器不受影响（近盲带内不开火） */
  blindDmgMul?: number;
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

/**
 * **激光威力系数**（**2026-09-11 船长定：合并旧修正、不再与命中衰减挂钩**）——
 * 旧口径 = `1 − 进度 ×(1−falloff) ×0.8`（"幅度 = 命中衰减的 0.8 倍"，falloff 0.3 时远端 ×0.44）；
 * 新口径 = **近端 ×1 → 最远端 = 该武器 `falloff`（激光件现统一 0.1）**，线性内插、无任何换算系数：
 *   系数 = 1 − 进度 × (1 − falloff)   （falloff 0.1 → 最远端威力 ×0.10）
 * ⇒ "远端衰减"对能量武器就是**最远端威力倍率本身**，与动能/爆炸的"远端命中倍率"语义对齐、一眼可读。
 *
 * ⚠ **2026-09-12 审计 B1：本函数与 `distFactor` 已合并为同一实现**——两者原本是两份**逐字相同**的代码，
 * 本函数唯一多出的是 `Math.max(0, …)`，而那一层在 **`falloff ∈ [0,1]`** 时**恒不生效**
 * （`t` 已 clamp 到 `[0,1]` ⇒ `1 − t(1−falloff) ≥ 1 − (1−falloff) = falloff ≥ 0`）。
 * 该前提由 `content:check`「**远端衰减取值域契约**」守住（越界即报错）。
 * **保留本名字与语义标签**（**威力**衰减，与动能/爆炸的**命中**衰减并列），实现一律走 `distFactor`。
 */
export function beamPowerFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  return distFactor(dist, w)
}

/** 静态单位卡（构建后不进存档） */
export interface UnitSpec {
  tag: string
  name: string
  /** **舰种档**（1 护卫舰 … 5 旗舰；2026-09-12 加）：敌方单位 = 编成条目所引舰级的档位；
   *  旧威胁推导路径不写（缺省按 1 处理）。用途 = **敌舰近防炮的档系数**（`balance.pdTierMul`）。 */
  hullClassTier?: number
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
  side: 'me' | 'foe'
  hp: Hp3
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
  /**
   * **本舰无人机结构层加成**（2026-09-13 船长：G 族「鱿蜂结构层」＝残兵结构层改名 ——
   * 「提高无人机 80% 的结构」）＝ 该舰所装模块 `droneHullHpBonusPct` 之和。
   * 只放大**机群生存池的结构层**（`DronePoolEntry.h`），与三层血 buff 同链、在建池时一次算清。
   */
  droneHullBonusPct?: number
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
  /** 敌冲锋（2026-09-10 船长定；资格 2026-09-11 扩为两条来源；**2026-09-14 改逐单位**）：本单位为 true 时，
   *  触发条件命中即**自己**加速（×`foeChargeMul`）、**自身炮台命中我方即解除** + 冷却 10 秒。
   *  来源 ① **舰级级 opt-in**（`FoeShipDef.foeCanCharge`，无条件）② 老路（威胁 ≥ 门槛 且 brawl）。 */
  foeCanCharge?: boolean;
  /** 本单位的冲锋倍率（**2026-09-14 船长：「大虫子的冲锋倍率改为3，给小虫子添加冲锋，倍率为1.5」**）——
   *  缺省不写 ⇒ 走全局 `BattleBalance.foeChargeMul`（**旧读数逐字不变**）。 */
  foeChargeMul?: number;
  /** **单波次内增援**（2026-09-11 船长裁决：机制实现、不启用）——本单位的入场触发条件；
   *  **建档时已按总开关过滤**：开关关闭时本字段一律不写（= 开战即在）。
   *  带本字段的单位**不进开战编队**，由 `advanceBattleFor` 每拍检查、条件命中才补入。 */
  foeReinforceAt?: FoeReinforceTrigger
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
  /** **单次出击上限**（见 `FoeShipDef.droneLaunch`；2026-09-12 船长「限制敌机单次出击数量」） */
  foeDroneLaunch?: { maxAloft: number; cycleMs?: number; keepDps?: boolean }
  /** **备用机库**（见 `FoeShipDef.droneReserve`；2026-09-12 船长「损坏后补充敌机」） */
  foeDroneReserve?: { count: number; respawnMs: number }
  foeTactic: FoeTactic | null
}

function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * 层位克制系数（远行星号体系削弱版）。
 * 2026-09-05 船长改：能量（plasma）对护盾 0.75 → 1.25（能量弹/激光对盾更有效，
 * 三系成为"各有克制侧重"：动能拆盾 1.5、爆炸破甲 1.5、能量拆盾 1.25 且不劣于任何层）。
 * **2026-09-13 船长改（本次）**：「爆炸对护盾改为 ×0.75，动能对装甲改为 ×0.75」——
 * 两处**逆克制劣化**由 0.5 抬到 0.75（克制/劣化比 3:1 → 2:1），三系对"非擅长层"不再腰斩。
 * UI 速查文案 `layerMultText`、产物资检契约（`tools/content-check.ts` 克制表对账）与本函数同源，自动跟随。
 * ⚠ C4 复核项：此改动提升激光炮/能量弹系（含部分无人机能量弹）胜率与 PvE 时长结构，请二号复核平衡。
 */
export function typeLayerMult(t: DamageType, layer: 'shield' | 'armor' | 'hull'): number {
  if (t === 'kinetic') return layer === 'shield' ? 1.5 : layer === 'armor' ? 0.75 : 1
  if (t === 'explosive') return layer === 'shield' ? 0.75 : layer === 'armor' ? 1.5 : 1
  return layer === 'shield' ? 1.25 : 1 // plasma（能量）：拆盾 1.25，对甲/结构无劣化
}

/** 三层克制一句话（UI 悬停/手册速查用；数值与 typeLayerMult 同源） */
export function layerMultText(type: DamageType): string {
  const fmt = (layer: 'shield' | 'armor' | 'hull'): string => {
    const v = typeLayerMult(type, layer)
    return v === 1 ? '×1' : `×${v}`
  }
  return `盾 ${fmt("shield")} · 甲 ${fmt("armor")} · 结构 ${fmt("hull")}`
}

/** 距离衰减：minRange 端 1.0 → maxRange 端 falloff（线性）。
 *  ⚠ **这是全仓唯一一处"远端衰减"实现**（2026-09-12 审计 B1 合并）：`beamPowerFactor`（能量**威力**衰减）、
 *  `hitChance`（动能/爆炸**命中**衰减）、`foeGunPowerFactorOf`（敌方炮台受击增程感知版）**全部走本函数**。
 *  合并前提 = **`falloff ∈ [0,1]`**（守卫见 `content:check`「远端衰减取值域契约」）。 */
export function distFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  const { minRangeM: min, maxRangeM: max, falloff } = w
  if (max <= min) return 1
  const t = clamp(0, 1, (dist - min) / (max - min))
  return 1 - t * (1 - falloff)
}

/** 武器是否在当前距离开火 */
export function inRange(dist: number, w: { minRangeM: number; maxRangeM: number }): boolean {
  return dist >= w.minRangeM && dist <= w.maxRangeM
}

/**
 * 单发命中概率（设计文档公式；V17.1：×attacker.hitMul = 加力失稳缩放，缺省 1）。
 * 2026-09 船长拍板：信号半径/扫描分辨率等"间接属性"不参与战斗公式（纯展示副属性），
 * 命中只由 武器基础命中/攻方命中加成 / 守方回避 / 距离衰减 三者决定。
 *
 * ⚠ **2026-09-15 船长改判（现行口径）**：「**改为从初始命中中扣**」——回避**从"初始命中"里先扣，
 * 余量再一起乘距离衰减**（旧口径是"先乘衰减、再减回避"，即回避作为**不随距离缩水的固定点数**）。
 *  - 旧：`hit = (基础命中 + 攻方加成) × df − 守方回避`
 *  - 新：`hit = (基础命中 + 攻方加成 − 守方回避) × df`
 *  语义差别：**df = 1（贴到近端）时两者完全等价**；越远，回避越被衰减稀释（远距离回避收益按比例缩水）。
 *  对称地，双方远距离命中都上升；对**打机群**（`droneHitChance`，df 固定为 1）零变化。
 *  读数（敌动能炮 base 0.85 / 远端衰减 0.5）：回避 0.34 时 df 0.7 = 25.5% → **35.7%**、
 *  df 0.5 = 8.5% → **25.5%**；典型回避 0.22 时 df 0.7 = 37.5% → **44.1%**。
 *  ⚠ **连带（登记、未改值）**：`balance.battle.foeHitCompMul`（敌方单发伤害的等效补偿）是按**旧公式**
 *  折出来的锚 ⇒ 同一补偿下敌方期望承伤在中距 +17.6%、远端 +53.7%（船长 2026-09-15 选「先不动、看读数」）。
 * 参数保留 scanResMm/signatureM 可选字段仅为调用面兼容（字面量与单位对象），公式不消费。
 */
export function hitChance(
  weapon: { hitRate: number; minRangeM: number; maxRangeM: number; falloff: number; eqHitMul?: number },
  attacker: { hitBonus: number; scanResMm?: number; hitMul?: number },
  defender: { evasion: number; signatureM?: number },
  dist: number,
  bal: BattleBalance,
  /** **距离衰减覆写**（2026-09-12 加；缺省 = 原 `distFactor`，零行为变化）——
   *  供**敌方炮台受击增程**（`foeGunPowerFactorOf`）传入"延长段同斜率外推"的折减，
   *  否则射程延长到 18km 后，命中率会在 12km 处**卡在 falloff 平台上**（不是船长要的"同斜率继续衰减"）。 */
  dfOverride?: number,
): number {
  const df = dfOverride ?? distFactor(dist, weapon)
  // 2026-09-15：回避从**初始命中**里扣，扣完再乘距离衰减（见函数头注释）
  const raw = (weapon.hitRate + attacker.hitBonus - defender.evasion) * df
  // V18.1：索敌（命中件）乘子在 clamp 内与失稳分开——eqHitMul 只随炮台条目
  return clamp(bal.hitMin, bal.hitMax, raw * (weapon.eqHitMul ?? 1) * (attacker.hitMul ?? 1))
}

/**
 * **打机群的命中**（船长 2026-09-12 终裁：**闪避生效版**）：与 `hitChance` 同一套公式
 * （基础命中 × 火控 → **减机型闪避** → 乘索敌件 → clamp），**唯一差别 = 距离衰减固定为 1**。
 *
 * 依据：选靶早已按船长 2026-09-11 甲案「**打机群不看两舰间距**」办（`pickFoeDroneTarget`：
 * 出击型不受射程限制、哨戒机才要进射程），而命中却仍按**两舰间距**算 `distFactor`——
 * 近防炮射程 2,500m 短于典型交距（3,211~5,545m）⇒ 该因子恒落在下限 ×0.5
 * ⇒ 装备表写的命中 0.9 实战只剩 0.27~0.35，与"不看两舰间距"的裁定自相矛盾。
 * ⚠ **只对机群生效**：打舰仍走 `hitChance` 的原 `distFactor`（"近防炮射程短所以对舰吃亏"不动）。
 * 抽成函数一是为可测（`tests/pd-damage-ladder.test.ts` 直接锁这条口径），二是让调用点一眼看出
 * "这两条命中不是同一条公式"。
 *
 * ⚠ **口径沿革（三条，别照旧文重开）**：
 * 1. 最初：吃距离衰减（×0.5 下限）⇒ 实收 0.27~0.35；
 * 2. 2026-09-12「按丁修复」：**去掉距离**、仍减闪避 ⇒ 实收 **0.72（E 警戒机）/ 0.45（G 蜂群机）**；
 * 3. 同日一度改判「无视距离的 90」（连闪避也不减）⇒ 船长随即裁定「**哦 滚回到上一个闪避生效的版本**」
 *    ⇒ **以本实现（第 2 条）为准**：装备表的 0.9/0.92 是**基础命中**，机型闪避照常参与；
 *    报读数时须区分**基础值**与**实收值**（例如 0.9 基础 ⇒ 对 E 警戒机实收 0.72）。
 */
export function droneHitChance(
  weapon: Parameters<typeof hitChance>[0],
  attacker: Parameters<typeof hitChance>[1],
  evasion: number,
  bal: BattleBalance,
): number {
  return hitChance(weapon, attacker, { evasion }, 0, bal, 1)
}

/** 把一发伤害按层序消费（盾→甲→结构），返回更新后三层与实际扣血 */
export function applyDamage(
  hp: Hp3,
  resists: UnitSpec['resists'],
  dmg: number,
  type: DamageType,
): { hp: Hp3; dealt: number } {
  const next = { s: hp.s, a: hp.a, h: hp.h }
  let rest = Math.max(0, dmg)
  const layerKey: Array<keyof Hp3> = ['s', 'a', 'h']
  const layerName: Array<'shield' | 'armor' | 'hull'> = ['shield', 'armor', 'hull']
  const before = hp.s + hp.a + hp.h
  for (let i = 0; i < 3 && rest > 0; i++) {
    const res = resists[layerName[i]!]?.[type] ?? 0
    const layerDmg = rest * typeLayerMult(type, layerName[i]!) * (1 - clamp(0, 0.9, res))
    const absorbed = Math.min(next[layerKey[i]!], layerDmg)
    next[layerKey[i]!] -= absorbed
    rest = Math.max(0, layerDmg - absorbed) // 层破溢出进下一层
  }
  const after = next.s + next.a + next.h
  return { hp: next, dealt: Math.max(0, before - after) }
}

/**
 * **打空这一艘所需的最小原始伤害**（F3c B2 · 谜质「齐射协调仪」的溢火结转要用）。
 *
 * 为什么不用"实收伤害"算溢出：`applyDamage` 的消费是**逐层乘系数**的（层克制 × (1−该层该系抗性)），
 * 一发超出部分的"实收"与"原始"不是一个量纲；要把多余火力转给**另一艘**（它有自己的层克制与抗性），
 * 必须把溢出量换回**原始伤害**再走一遍正常结算。
 *
 * 做法 = 对单调函数 `applyDamage(...).dealt` 做二分（`dealt` 随 dmg 单调不减）：
 * 找最小 X 使三层被打空。上限取 `总血 × 12`（抗性最多削 90% ⇒ 需求最多 ×10，留余量）。
 */
export function rawDamageToKill(hp: Hp3, resists: UnitSpec['resists'], type: DamageType): number {
  const total = hp.s + hp.a + hp.h
  if (total <= 0) return 0
  let lo = 0
  let hi = total * 12 + 8
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2
    if (applyDamage(hp, resists, mid, type).dealt >= total - 1e-9) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * **谜质「齐射协调仪」：溢出火力转移**（F3c B2 · 船长 2026-09-13：
 * 「**齐射协调仪改为溢出火力会转移到其他敌舰**」）。
 *
 * 口径：目标被打死后，把 `原始伤害 − 打空它所需的原始伤害` 这一截转给**下一艘存活敌舰**，
 * 并按那一艘**自己的层克制**重算（`applyDamage` 原样走一遍）；若把第二艘也打空就继续往下转
 * （`maxChain` 封顶，防一条链子无限转）。**只在本场带了该装置时调用**（`battle.wormhole.volleyOverflow`）。
 *
 * 参数刻意收成结构化小对象（`units` + `stats`）⇒ 用例可以拿一份手搓状态直接验这条机制。
 */
export function carryVolleyOverflow(
  b: { units: Record<string, { hp: Hp3 }>; stats: { meDmg: number } },
  foes: readonly UnitSpec[],
  killedTag: string,
  type: DamageType,
  rawDamage: number,
  hpBefore: Hp3,
  maxChain = 3,
): { total: number; hits: number; lastTag: string | null } {
  let raw = rawDamage
  let prevHp = hpBefore
  let prevTag = killedTag
  let total = 0
  let hits = 0
  let lastTag: string | null = null
  for (let n = 0; n < maxChain; n++) {
    const excess = raw - rawDamageToKill(prevHp, {}, type)
    if (excess <= 0.5) break
    const next = foes.find((f) => {
      if (f.tag === prevTag) return false
      const rt = b.units[f.tag]
      return !!rt && rt.hp.s + rt.hp.a + rt.hp.h > 0
    })
    if (!next) break
    const rt = b.units[next.tag]!
    const before = { ...rt.hp }
    const r = applyDamage(rt.hp, {}, excess, type)
    rt.hp = r.hp
    b.stats.meDmg += r.dealt
    total += r.dealt
    hits += 1
    lastTag = next.tag
    raw = excess
    prevHp = before
    prevTag = next.tag
    if (rt.hp.s + rt.hp.a + rt.hp.h > 0) break
  }
  return { total, hits, lastTag }
}

/* ═══════════ 构建 ═══════════ */

/**
 * 结算敌人一发（2026-09-10 船长：窝点混伤）：
 * 武器带 `shotsByType`（混伤，主 60% / 副 40%）→ 按构成**逐系**调用 `applyDamage`
 * （各系吃各自的 `typeLayerMult` 与层抗，逐系依次消费 盾→甲→结构）；
 * 纯系武器（无 `shotsByType`）→ 与旧行为一字不差。
 * `totalDmg` 是本次开火的总伤害（含近盲/距离折扣），按构成比例分摊、**总量不变**。
 * 返回更新后的三层血量（调用方直接赋值）。导出供回归测试直接验证"混伤绕过单系抗"。
 */
export function applyFoeShot(
  hp: Hp3,
  resists: UnitSpec['resists'],
  weapon: WeaponSpec,
  totalDmg: number,
  mainType: DamageType,
): Hp3 {
  const shots = weapon.shotsByType
  const entries = shots ? Object.entries(shots).filter(([, v]) => (v ?? 0) > 0) : []
  if (entries.length <= 1) return applyDamage(hp, resists, totalDmg, mainType).hp
  const sum = entries.reduce((s, [, v]) => s + (v ?? 0), 0)
  if (sum <= 0) return applyDamage(hp, resists, totalDmg, mainType).hp
  // 主系在前（与构成降序一致：shotsByType 由 splitShotByComposition 生成 → 主系份额最大）
  let next = hp
  let left = totalDmg
  entries.forEach(([t, v], i) => {
    const dmg = i === entries.length - 1 ? left : Math.max(1, Math.round((totalDmg * (v ?? 0)) / sum))
    const take = Math.max(0, Math.min(left, dmg))
    if (take <= 0) return
    next = applyDamage(next, resists, take, t as DamageType).hp
    left -= take
  })
  return next
}

const AMMO_IDS: Record<DamageType, string> = {
  kinetic: 'ammo-kinetic-l',
  explosive: 'ammo-explosive-l',
  plasma: 'ammo-plasma-l',
}

/** 本船弹药 id 解析（弹药 MK2，2026-09-09）：
 * battle 覆盖（开战实装/缺货回退，见 BattleState.ammoIds）> 船装配档位偏好（ammoPref）> 基础弹 */
function ammoIdFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  battleIds?: Partial<Record<DamageType, string>> | null,
): string {
  const override = battleIds?.[type]
  if (override && ctx.items.has(override)) return override
  const pref = state.fleet[shipId]?.ammoPref?.[type]
  if (pref && ctx.items.has(pref)) return pref
  return AMMO_IDS[type]
}

function combatSpeed(maxSpeedMps: number, agility: number, bal: BattleBalance): number {
  return Math.max(20, maxSpeedMps * bal.speedFactor * (1 + (agility - 0.5) * 2 * bal.agilitySpeedBonus))
}

/**
 * 开火失稳乘子的**当前有效值**（2026-09-10 船长：推进器失稳代价只在**点火期**生效）：
 * 点火期 = 装配值（`1 − 最重一件 hitPenalty`）；冷却期 = 1（没点火就不失稳）。
 */
export function effectiveHitMul(spec: Pick<UnitSpec, 'hitMul'>, boosting: boolean): number {
  return boosting ? (spec.hitMul ?? 1) : 1
}

/**
 * 推进器周期状态（2026-09-10 船长定：**爆发 60 秒 → 冷却 60 秒，开场即启动**）。
 * **由战斗时钟推导**（`lastTickGameMs - startedAtGameMs`）→ 不占任何存档字段、战中重载不丢。
 * 引擎（距离步进取我方机动）与界面（战斗界面底部推进器冷却格）**同源读这一个函数**。
 *
 * **2026-09-14 船长（新增「微型跃迁引擎」）**：周期改为**逐单位**——第三参 `cycle` 给该单位自己的
 * 点火/冷却毫秒（缺省仍是 `balance.battle` 的全局值）。同一个函数、同一个时钟锚（**开场即点火**），
 * 只是窗口长短各算各的 ⇒ 装微型跃迁引擎那条船 10 秒爆发、其余船仍 60 秒。
 */
export function thrusterPhase(
  battle: Pick<import('./state').BattleState, 'lastTickGameMs' | 'startedAtGameMs'>,
  bal: BattleBalance,
  cycle?: { boostMs?: number; cooldownMs?: number },
): { boosting: boolean; remainMs: number; cycleMs: number; posMs: number } {
  const boostMs = cycle?.boostMs ?? bal.thrusterBoostMs
  const cooldownMs = cycle?.cooldownMs ?? bal.thrusterCooldownMs
  const cycleMs = Math.max(1, boostMs + cooldownMs)
  const elapsed = Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs)
  const posMs = elapsed % cycleMs
  const boosting = posMs < boostMs
  return { boosting, posMs, cycleMs, remainMs: boosting ? boostMs - posMs : cycleMs - posMs }
}

/** 某单位的推进器周期（没写覆盖 = 全局 `balance.battle`）——引擎与界面取周期的**单点** */
export function unitThrusterCycle(
  u: Pick<UnitSpec, 'thrusterBoostMs' | 'thrusterCooldownMs'>,
  bal: BattleBalance,
): { boostMs: number; cooldownMs: number } {
  return {
    boostMs: u.thrusterBoostMs ?? bal.thrusterBoostMs,
    cooldownMs: u.thrusterCooldownMs ?? bal.thrusterCooldownMs,
  }
}

/**
 * 敌冲锋状态机（2026-09-10 定；结束条件 2026-09-11 改判；触发条件 2026-09-14 加"乙"；
 * **2026-09-14 同日晚些时候船长再改判：逐单位 + 自身命中解除 + 冷却 10 秒**）。
 *
 * **触发两条取或**：① 够不着（距离在**自己武器射程之外**）② **距离 > 期望交距 + 1,000**
 * （船长「冲锋按乙方案来」）→ 该单位**自己**加速（机动 ×倍率，仍走拔河公式）。
 * **解除两条取或**：① **自身炮台命中我方**（船长：「冲锋解除机制为自身攻击命中后解除冲锋状态，
 * 并进入 10 秒冷却」）② 压到期望交距 `arrived`（2026-09-11 口径，**留作兜底**）。
 * 解除后该单位进 `foeChargeCooldownMs`（**本批由 20 秒改判为 10 秒**）冷却，期满且再次满足触发条件才重启。
 *
 * ⚠ **逐单位**（2026-09-14 船长：「现在多单位的战斗速度难道不是取速度全队平均值吗？那么**各自触发
 * 冲锋的提速**应该没什么问题吧？」＋「给小虫子添加冲锋，倍率为 1.5」）：每个挂资格的单位各持一份
 * 「在冲 / 冷却到某时刻」（`b.foeCharges[tag]`），互不顶替——原编队级单标志下，先命中那条会把
 * 别的冲锋者的状态一并清掉。
 * ⚠ **倍率不外溢**（2026-09-11 船长：「冲锋还是按照**巨兽自己的速度**算…**哪怕是冲锋也是按照巨兽速度**」）：
 * 加速只乘进**该单位自己**那一项（见 `stepBattle` 的"逐单位乘各自倍率 → 取平均"）。
 * 只对挂了 `foeCanCharge` 的敌人生效——资格有**两条互相独立**的来源（见 `createFoeSpecsFromShips`）：
 * **舰级级 opt-in**（`FoeShipDef.foeCanCharge`，无条件）与**老路**（威胁 ≥ `foeChargeThreatFloor`
 * 且战术 = brawl，受总开关 `foeChargeEnabled` 约束）；无总时长上限。
 *
 * 历史 BUG（2026-09-14 船长报障「冲锋到达目标距离后并不会解除」）：当时解除条件**只有** `arrived`，
 * 而"我方更快、且期望交距更远"时距离会**停在期望交距之上**（拔河平衡点：我方外拉 = 敌方内推），
 * `arrived` 永不可达 ⇒ 冲锋永不解除、冷却永不启动。本批加的**命中解除**就是这条 BUG 的出口
 * （在冲的单位既然已经进射程，炮台迟早打中）；`arrived` 仍留作兜底。
 */
function updateFoeCharge(
  b: import('./state').BattleState,
  foes: UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
  desireM: number,
): void {
  const margin = bal.foeChargeTriggerMarginM ?? 1_000
  const arrived = b.distanceM <= desireM
  for (const f of foes) {
    if (f.foeCanCharge !== true) continue
    const rt = b.foeCharges?.[f.tag]
    if (!isAlive(b, f.tag)) {
      if (rt && b.foeCharges) delete b.foeCharges[f.tag]
      continue
    }
    const w = f.weapons[0]
    const inOwnRange = w ? inRange(b.distanceM, w) : false
    const wantCharge = !inOwnRange || b.distanceM > desireM + margin
    if (rt?.on === true) {
      if (arrived) {
        rt.on = false
        rt.cdUntilMs = nowMs + bal.foeChargeCooldownMs
      }
      continue
    }
    if (nowMs >= (rt?.cdUntilMs ?? 0) && wantCharge) {
      if (!b.foeCharges) b.foeCharges = {}
      b.foeCharges[f.tag] = { ...(rt ?? {}), on: true }
    }
  }
}

/**
 * **冲锋解除：自身炮台命中我方**（船长 2026-09-14：「冲锋解除机制为自身攻击命中后解除冲锋状态，
 * 并进入 10 秒冷却」）。
 * ⚠ **只算炮台主武器**（`weapons[0]`）：机群（`src:'drone'`）命中**不算**——那是舰载机打的，
 * 不是"自身炮台"；近防炮同理（防御武器，不在这里结算）。
 */
function releaseFoeChargeOnHit(
  b: import('./state').BattleState,
  tag: string,
  bal: BattleBalance,
): void {
  const rt = b.foeCharges?.[tag]
  if (rt?.on !== true) return
  rt.on = false
  rt.cdUntilMs = b.lastTickGameMs + bal.foeChargeCooldownMs
}

/**
 * **单位机动倍率（单点）**——两侧"周期/状态 ⇒ 机动乘子"都从这里取，免得同一段判断散在多处：
 * - **我方**：推进器**周期爆发**（`thrusterPhase`，周期逐单位；点火窗口内 ×(1+`thrusterBoost`)，冷却期 ×1）；
 * - **敌方**：**冲锋**（`b.foeCharges[tag].on` ⇒ ×(舰级 `foeChargeMul` ?? 全局 `bal.foeChargeMul`)）。
 *
 * 两侧都只乘进**自己那一项**：编队速度 = "逐单位乘各自倍率 → 取平均"（见 `stepBattle`），
 * 故倍率**不外溢**到队里别的船。
 * ⚠ 只合并这一层：**冲锋的状态机**（事件驱动：命中解除 / 到达解除 / 冷却）与**推进器的相位**
 * （时钟推导：`elapsed % 周期`）不是一回事，各自的"何时开、何时关"留在原处，不硬并成一个函数。
 */
function unitSpeedMulOf(
  u: UnitSpec,
  b: import('./state').BattleState,
  bal: BattleBalance,
  side: 'me' | 'foe',
): number {
  if (side === 'me') {
    const boosting = thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
    return 1 + (boosting ? (u.thrusterBoost ?? 0) : 0)
  }
  if (b.foeCharges?.[u.tag]?.on !== true) return 1
  return u.foeChargeMul ?? bal.foeChargeMul
}

/** 正在冲锋的敌单位条数（界面标记用）。⚠ 只数**存活**：阵亡单位的状态在同一拍已清掉，这里再兜一层 */
export function foeChargeCount(
  b: Pick<import('./state').BattleState, 'foeCharges' | 'units'>,
): number {
  let n = 0
  for (const [tag, rt] of Object.entries(b.foeCharges ?? {})) {
    if (rt?.on !== true) continue
    const u = b.units[tag]
    if (!u || !(u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)) continue
    n += 1
  }
  return n
}

/** 逐件缺口乘入（对 out 原位改：每系 res = 1−(1−res)(1−add)） */
function applyAdds(out: DamageResists, add: DamageResists | undefined): void {
  if (!add) return
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const a = add[t] ?? 0
    if (a <= 0) continue
    const cur = out[t] ?? 0
    out[t] = clamp(0, 0.9, 1 - (1 - cur) * (1 - a))
  }
}

/**
 * EVE 式抗性合成（V17）：模块按"缺口削减"乘入——实际抗性 = 1 − (1−基础) × (1−模块值)，
 * 上限 0.9。基础已有高抗的层位装同系模块收益递减（与旧"绝对加算百分点"的分水岭；
 * 对无基础层 = 模块值直接成面板）。
 */
export function mergeResist(base: DamageResists | undefined, add: DamageResists | undefined): DamageResists {
  const out: DamageResists = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    out[t] = clamp(0, 0.9, 1 - (1 - (base?.[t] ?? 0)) * (1 - (add?.[t] ?? 0)))
  }
  return out
}

/** 敌方编队主伤害类型（V17 导出；卡面 dmgMix 取最高权重，缺省 = 动能）——悬赏卡展示/玩家配抗参考 */
export function foeMainDamageType(anomaly: AnomalyDef): DamageType {
  return pickTopType(anomaly.dmgMix)
}

/**
 * 敌方**火力构成**（2026-09-10 船长：混伤）——战斗、胜率预估与界面**同源单点**：
 * 返回按份额降序的 `[{ type, share }]`（份额归一化、和 = 1）。
 * - 写了两系及以上（常驻悬赏/低安遇袭 8:2、窝点派生 6:4）→ 逐系份额；
 * - 只写一系 / 未写（教学卡）→ 单条 `{ 主系, 1 }`（纯系）。
 */
/**
 * 火力构成（按 **mix 对象**计算）——2026-09-11 舰级表试点抽出：舰级/编成条目的 mix 可能与
 * 卡面声明不同（如"同一艘船缴获改装了不同弹药"），故把口径与"读哪份 mix"解耦。
 */
export function compositionOfMix(
  mix: Partial<Record<DamageType, number>> | undefined,
): Array<{ type: DamageType; share: number }> {
  const rows = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ type: t, w: mix?.[t] ?? 0 }))
    .filter((r) => r.w > 0)
  if (rows.length <= 1) return [{ type: rows[0]?.type ?? 'kinetic', share: 1 }]
  const total = rows.reduce((s, r) => s + r.w, 0)
  return rows
    .map((r) => ({ type: r.type, share: r.w / total }))
    .sort((a, b) => b.share - a.share || a.type.localeCompare(b.type))
}

export function foeDamageComposition(anomaly: AnomalyDef): Array<{ type: DamageType; share: number }> {
  return compositionOfMix(anomaly.dmgMix)
}

/**
 * 把一次开火的总伤害按火力构成**拆成逐系单发**（2026-09-10：窝点混伤）。
 * 取整口径：先按份额分配、**最后一条吃余数**，保证 Σ = 总单发（敌总伤不变，只改构成）。
 * 返回空数组 = 总伤为 0（调用方跳过）。
 */
export function splitShotByComposition(
  shotDmg: number,
  comp: ReadonlyArray<{ type: DamageType; share: number }>,
): Array<{ type: DamageType; dmg: number }> {
  if (shotDmg <= 0) return []
  if (comp.length <= 1) return [{ type: comp[0]?.type ?? 'kinetic', dmg: shotDmg }]
  const out: Array<{ type: DamageType; dmg: number }> = []
  let left = shotDmg
  comp.forEach((c, i) => {
    const dmg = i === comp.length - 1 ? left : Math.max(1, Math.round(shotDmg * c.share))
    const take = Math.min(left, dmg)
    out.push({ type: c.type, dmg: take })
    left -= take
  })
  return out.filter((r) => r.dmg > 0)
}

/** 敌方血型层占比（V17.2 导出；悬赏卡"敌型"展示——与 createFoeSpecs 同源）：
 * 盾型 50/25/25 · 甲型 20/55/25 · 均衡 33/33/33（盾/甲/结构） */
export function foeLayerSplit(profile: DefProfile | undefined): { s: number; a: number; h: number } {
  return PROFILE_SPLIT[profile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
}

/** 构建我方单位静态卡（V18 多件语义：全位装配生效——多炮/多矿枪/盾甲多件/无人机装置；null = 船记录缺失） */
/** 我方规格快照（手动/AI/MC/预估同源）。
 * ammoIds（弹药 MK2，2026-09-09）：战斗内实装弹 id 覆盖（缺货回退等）——
 * 推进/视图重建传 battle.ammoIds 使伤害与实装弹种一致；缺省 = 船装配 ammoPref，再缺省 = 基础弹。 */
export function createPlayerSpec(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  ammoIds?: Partial<Record<DamageType, string>> | null,
): UnitSpec | null {
  const ship = fleetDefOf(state, ctx, shipId)
  const fleet = state.fleet[shipId]
  if (!ship || !fleet) return null
  const bal = ctx.balance.battle
  const fitted = fleet.fitted

  // V18：家族件列表（全位；V18.1 起无同类唯一——多件按收敛组合成）
  const shieldDefs = familyModules(state, ctx, shipId, 'shield')
  const armorDefs = familyModules(state, ctx, shipId, 'armor')
  const propDefs = familyModules(state, ctx, shipId, 'propulsion')
  const targetLockDefs = familyModules(state, ctx, shipId, 'target-lock') // 2026-09-09 锁定装置（高槽）
  // V18B：武器形态分家——turret（动能炮）与 missile（导弹架）与 laser（激光炮）都进武器池
  const turretDefs = [
    ...familyModules(state, ctx, shipId, 'turret'),
    ...familyModules(state, ctx, shipId, 'missile'),
    ...familyModules(state, ctx, shipId, 'laser'),
  ]
  // V18.1 支援件（中/低槽：伤害/射速/命中/闪避，效果字段判别）
  const supportDefs = allFittedModules(fitted, ctx).filter((d) => d.slot === 'support')
  // 无人机装置（高槽 rack 件；甲板扩展/战术导控/中继天线按字段判别）
  const droneGear = allFittedModules(fitted, ctx).filter(
    (d) => d.droneBayBonusM3 !== undefined || d.droneDmgBonus !== undefined || d.droneRangeBonusPct !== undefined,
  )

  // 盾/甲：容量加成加算求和；抗性按系逐件缺口乘入（mergeResist 链；V18.1 同系可多件）
  let shieldHpMult = 1
  for (const m of shieldDefs) shieldHpMult += m.shieldHpBonus ?? 0
  let armorHpMult = 1
  for (const m of armorDefs) armorHpMult += m.armorHpBonus ?? 0
  // 结构层容量（2026-09-10 船长：E 族巨构骨架引出）——任何槽位都可能带，按件加算求和，
  // 与甲容同口径；技能（船体加固理论/重装舰操作）再乘于其上
  let hullHpMult = 1
  for (const m of allFittedModules(fitted, ctx)) hullHpMult += m.hullHpBonus ?? 0
  // 批次三技能（2026-09-05）：护盾操作学（盾容量 +4%/级）/ 船体加固理论（甲+结构 +4%/级）——乘于装备件之上
  const shOpLv = Math.min(5, state.skills.trained['shield-operation'] ?? 0)
  const hullLv = Math.min(5, state.skills.trained['hull-upgrades'] ?? 0)
  // 批次五：重装舰操作（armored 族驾驶）——装甲+结构容量 +4%/级，与船体加固理论乘算
  const armoredOpsLv = ship.role === 'armored' ? Math.min(5, state.skills.trained['armored-ops'] ?? 0) : 0
  const hullSkillMult = (1 + 0.04 * hullLv) * (1 + 0.04 * armoredOpsLv)
  const hp: Hp3 = {
    s: (ship.shieldHp ?? 0) * Math.max(1, shieldHpMult) * (1 + 0.04 * shOpLv),
    a: (ship.armorHp ?? 0) * Math.max(1, armorHpMult) * hullSkillMult,
    h: (ship.hullHp ?? 0) * Math.max(1, hullHpMult) * hullSkillMult,
  }
  const shieldRes = mergeResist(ship.shieldResist, undefined)
  for (const m of shieldDefs) applyAdds(shieldRes, m.shieldResistAdd)
  const armorRes = mergeResist(ship.armorResist, undefined)
  for (const m of armorDefs) applyAdds(armorRes, m.armorResistAdd)
  // 批次五：护盾调谐学/装甲调谐学——减伤缺口每级收窄 2%（等效抗性 +~2 百分点/级，上限 90% 不变）
  const tune = (res: DamageResists, lv: number): void => {
    if (lv <= 0) return
    const f = 1 - 0.02 * lv
    for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
      const v = res[t] ?? 0
      res[t] = Math.min(0.9, Math.max(0, 1 - (1 - v) * f))
    }
  }
  tune(shieldRes, Math.min(5, state.skills.trained['shield-tuning'] ?? 0))
  tune(armorRes, Math.min(5, state.skills.trained['armor-tuning'] ?? 0))
  // 结构层抗性（2026-09-10 船长：模块首次可加壳抗——hullResistAdd，按系缺口复合，上限 0.9）
  const hullRes = mergeResist(ship.hullResist, undefined)
  for (const m of allFittedModules(fitted, ctx)) if (m.hullResistAdd) applyAdds(hullRes, m.hullResistAdd)
  const resists = { shield: shieldRes, armor: armorRes, hull: hullRes }

  // V18.1 支援件合成：
  // - 伤害稳定器（按系加算）+ 射速计算机（装填缩短加算）只进炮台条目；
  // - 索敌阵列 = EVE 曲线命中乘子（只进炮台条目 eqHitMul）；
  // - 姿态陀螺 = 缺口复合回避（全船，含船体基础）。
  const dmgBonus: Record<DamageType, number> = { kinetic: 0, explosive: 0, plasma: 0 }
  let rofCut = 0
  const hitEqs: number[] = []
  const evadeGaps: number[] = []
  for (const m of supportDefs) {
    for (const [t, v] of Object.entries(m.damageTypeBonusPct ?? {})) dmgBonus[t as DamageType] += v ?? 0
    rofCut += m.reloadCutPct ?? 0
    if (m.hitBonusPct !== undefined) hitEqs.push(m.hitBonusPct)
    if (m.evasionGapPct !== undefined) evadeGaps.push(m.evasionGapPct)
  }
  const hitEq = curveMult(hitEqs)
  // 2026-09-05 一号按盘点补：规避机动学——舰船被命中缺口每级收窄 5%（与姿态陀螺缺口复合）
  const evLv = Math.min(5, state.skills.trained[bal.evasionSkillId] ?? 0)
  if (evLv > 0) evadeGaps.push(bal.evasionPerLevel * evLv)
  const evasion = gapCombine(evadeGaps, ship.evasion ?? 0.12)
  const reloadDiv = 1 + Math.min(0.9, rofCut)
  /* ═══ 2026-09-13 虫洞专属装备引出的新旋钮（船长逐条给定；设计稿 §3.6/§3.8）═══
   * 全部走"全件扫描"口径；四项缺省 0 ⇒ 既有装备零行为变化。 */
  const allDefs = allFittedModules(fitted, ctx)
  /** 装填惩罚（巨构协处理器 +12%）：多件只取最重一件 */
  const reloadPen = Math.max(0, ...allDefs.map((m) => m.reloadPenaltyPct ?? 0))
  /** 全层抗性削减（掠袭折射涂层 −15）：多件只取最重一件，下限 0 */
  const resistPen = Math.max(0, ...allDefs.map((m) => m.allResistPenaltyPct ?? 0))
  /** 全武器射程削减（掠袭者护盾笼 −25% / 赃物扫描阵 −15%）：多件只取最重一件 */
  const rangeCut = Math.max(0, ...allDefs.map((m) => m.rangeCutPct ?? 0))
  /** 按系射程加成（幽灵弹道校正器「动能武器射程 +22%」）：按系加算 */
  const rangeBonus: Record<DamageType, number> = { kinetic: 0, explosive: 0, plasma: 0 }
  for (const m of allDefs) {
    for (const [rt, v] of Object.entries(m.rangeTypeBonusPct ?? {})) rangeBonus[rt as DamageType] += v ?? 0
  }
  // **船体固有按系射程加成**（2026-09-13 船长：炮艇「动能武器射程 +30%」）——与模块同链加算
  for (const [rt, v] of Object.entries(ship.weaponRangeBonusPct ?? {})) rangeBonus[rt as DamageType] += v ?? 0
  /** 武器实际射程 = 基础 × (1−削减) × (1+该系加成)；下限 500 m（不许被压成 0） */
  const rangeOf = (base: number, type: DamageType): number =>
    Math.max(500, Math.round(base * (1 - Math.min(0.9, rangeCut)) * (1 + rangeBonus[type])))
  /** 通用单发伤害加成（亡军火控「伤害 +6%」）：与按系稳定器同链、加算、只进炮台/光束 */
  const dmgFlat = allDefs.reduce((s, m) => s + (m.damageBonusPct ?? 0), 0)
  // 全层抗性削减：三层同时扣、下限 0——放在抗性合成与调谐之后 ⇒ 作用于最终值
  if (resistPen > 0) {
    for (const layer of ['shield', 'armor', 'hull'] as const) {
      for (const rt of ['kinetic', 'explosive', 'plasma'] as const) {
        resists[layer][rt] = Math.max(0, (resists[layer][rt] ?? 0) - resistPen)
      }
    }
  }

  // 推进器（V18.1 多件）：速度加成 EVE 曲线收敛；开火失稳只取最重一件
  // 2026-09-13 虫洞专属（生体脉搏加速器）：速度加成**不再只认推进器槽**——任意槽位携带
  // `speedBonusPct` 都计入（与 speedPenaltyPct / hitPenalty 的"全件扫描"同口径）；
  // 既有装备只有推进器带本字段 ⇒ 行为零变化。
  const propSpeeds = allFittedModules(fitted, ctx)
    .map((m) => m.speedBonusPct ?? 0)
    .filter((v) => v > 0)
  const speedEq = curveMult(propSpeeds)
  const worstPen = Math.max(0, ...propDefs.map((p) => p.hitPenalty ?? 0))
  /**
   * **本单位推进器的点火周期**（2026-09-14 船长新增「微型跃迁引擎」：点火 10 秒 / 冷却 60 秒）。
   * 取**装配里点火最短的那件**（同长再取冷却更短的那件）——没有覆盖件的装配 ⇒ `cycle` 与全局值相同
   * ⇒ 下面**不写这两个字段**，走 `balance.battle`（**旧读数逐字不变**）。
   */
  const propCycle = propDefs
    .map((p) => ({
      boostMs: p.thrusterBoostMs ?? bal.thrusterBoostMs,
      cooldownMs: p.thrusterCooldownMs ?? bal.thrusterCooldownMs,
    }))
    .sort((a, b) => a.boostMs - b.boostMs || a.cooldownMs - b.cooldownMs)[0]
  const cycleOverridden =
    propCycle !== undefined &&
    (propCycle.boostMs !== bal.thrusterBoostMs || propCycle.cooldownMs !== bal.thrusterCooldownMs)
  // 装甲件常驻速度代价（2026-09-10 船长：陵寝装甲层 −25%）——多件取最重一件（与上面的失稳同口径）
  const worstSpeedPen = Math.max(0, ...allFittedModules(fitted, ctx).map((m) => m.speedPenaltyPct ?? 0))
  // 锁定装置（2026-09-09 船长拍板：集火 + 被锁目标受击加深 8/12/20% 档；多件 EVE 曲线收敛）
  const lockEq = curveMult(targetLockDefs.map((m) => m.lockDmgBonus ?? 0))

  const weapons: WeaponSpec[] = []
  const gunneryLv = state.skills.trained[ctx.balance.combat.gunnerySkillId] ?? 0
  // 批次五：武装舰操作（armed 族驾驶 +3%/级 全武器单发，乘于炮术学之外）
  const arOpsLv = ship.role === 'armed' ? Math.min(5, state.skills.trained['armed-ops'] ?? 0) : 0
  const dmgScale = (1 + bal.gunneryDmgPerLevel * gunneryLv) * (1 + (ship.powerBonus ?? 0)) * (1 + 0.03 * arOpsLv)

  // 兜底武器：基础舰炮恒在（弱；无炮/无弹仍可还击）
  weapons.push({
    label: '基础舰炮',
    kind: 'fixed',
    src: 'base',
    fixedType: 'kinetic',
    shotDmg: Math.round(8 * dmgScale),
    maxRangeM: 2500,
    minRangeM: 0,
    hitRate: 0.5,
    falloff: 0.3,
    reloadMs: 3500,
  })
  // V18 多炮：同 id 同参合并为 ×N 齐射条目（避免 UI 弧线爆炸），异型各自成条目
  const gunGroups = new Map<string, ModuleDef[]>()
  for (const t of turretDefs) {
    if (t.maxRangeM === undefined || t.reloadMs === undefined) continue
    const g = gunGroups.get(t.id)
    if (g) g.push(t)
    else gunGroups.set(t.id, [t])
  }
  for (const group of gunGroups.values()) {
    const turret = group[0]!
    if (turret.maxRangeM === undefined || turret.reloadMs === undefined) continue
    const count = group.length
    const type = turret.damageType ?? 'kinetic'
    const mult = turret.dmgMult ?? 1
    const ammoDef = ctx.items.get(ammoIdFor(state, ctx, shipId, type, ammoIds))
    // V18B 武器族专精技能：按模块槽族取专精技能（turret→动能炮术 / missile→导弹发射学 /
    // laser→激光炮学），乘算于 dmgScale（炮术学）之上——族与族互不串乘
    const famKey = turret.slot === 'missile' || turret.slot === 'laser' || turret.slot === 'turret' ? turret.slot : null
    const famLv =
      famKey !== null ? Math.min(5, state.skills.trained[ctx.balance.battle.familySkillIds[famKey]] ?? 0) : 0
    let famMult = famLv > 0 ? 1 + ctx.balance.battle.familySkillPerLevel * famLv : 1
    // 批次三：能量管理学（energy-management）——激光供能调谐 +3%/级（与激光炮学乘算）
    if (turret.slot === 'laser') {
      const engLv = Math.min(5, state.skills.trained['energy-management'] ?? 0)
      if (engLv > 0) famMult *= 1 + 0.03 * engLv
    }
    // V18.1：伤害稳定器（该系加算）乘入单发；射速计算机缩短装填
    // 船体武器族加成（2026-09-09 船长拍板：四族巡洋分型 EVE 式族加成）——按本武器固定弹型乘入，
    // 装别族武器 = 无加成（仍可用）；无人机与基础舰炮不在此链上，天然豁免
    const shipFam = ship.weaponFamilyBonus?.[type] ?? 0
    const perShot = Math.round(
      (ammoDef?.dmg ?? 0) * mult * dmgScale * famMult * (1 + dmgBonus[type]) * (1 + shipFam) * (1 + dmgFlat),
    )
    // 第二批技能（2026-09-05）：火控阵列学 命中 +3%/级（仅非必中 gun）；武器装填技术 −4%/级（≥60%，gun/beam 共用装填）
    const fireLv = Math.min(5, state.skills.trained['fire-control'] ?? 0)
    const fireMult = fireLv > 0 ? 1 + 0.03 * fireLv : 1
    /**
     * **索敌统合（命中技能）· 2026-09-14 船长改判**（原话：「**索敌统合也改为炮台命中，缩减为 2% 每级**」）：
     * 与「火控阵列学」**同口径**（乘在武器基础命中上、两者**乘算叠加**），每级 `bal.hitPerLevel`（现 2%）。
     * 旧口径是"舰船命中加成 ×(1+5%/级)"——乘在 `ship.hitBonus` 那个小基数上、且进括号后还要被距离
     * 衰减再乘一次 ⇒ 满级实测只值 **+3.3pp**（探针实测）；改到这里后它才真正是"炮台命中"。
     */
    const targetMult = 1 + bal.hitPerLevel * Math.min(5, state.skills.trained[bal.hitSkillId] ?? 0)
    // 2026-09-13 虫洞专属：装填惩罚 ×(1+reloadPen)（与射速计算机的"÷(1+x)"是两件事）
    const reload = Math.max(
      100,
      Math.round(
        (turret.reloadMs / reloadDiv) *
          (1 - 0.04 * Math.min(5, state.skills.trained['reload-drills'] ?? 0)) *
          (1 + reloadPen),
      ),
    )
    if (turret.slot === 'laser') {
      // V18B-2 激光炮：beam 条目——必中（开火不掷命中）、逐发扣能量弹药、
      // 距离衰减作用于威力（幅度 = 命中衰减的 50%，开火时按当前距离计算）
      weapons.push({
        label: count > 1 ? `${turret.name}×${count}` : turret.name,
        kind: 'beam',
        src: 'laser',
        fixedType: 'plasma',
        count,
        shotDmg: perShot * count,
        maxRangeM: rangeOf(turret.maxRangeM, 'plasma'),
        minRangeM: turret.minRangeM ?? 0,
        hitRate: 1,
        falloff: turret.falloff ?? 0.3,
        reloadMs: reload,
      })
      continue
    }
    const shotsByType: Partial<Record<DamageType, number>> = {}
    shotsByType[type] = perShot * count
    weapons.push({
      label: count > 1 ? `${turret.name}×${count}` : turret.name,
      kind: 'gun',
      src: turret.slot === 'missile' ? 'missile' : 'turret',
      shotsByType,
      count,
      eqHitMul: hitEq > 1 ? hitEq : undefined,
      maxRangeM: rangeOf(turret.maxRangeM, type),
      minRangeM: turret.minRangeM ?? 0,
      hitRate: (turret.hitRate ?? 0.5) * fireMult * targetMult,
      // 2026-09-13 虫洞专属（掠袭破片炮）：附加伤害段 + 每次耗弹数——缺省不写 ⇒ 既有武器零变化
      ...(turret.secondaryDamagePct !== undefined && turret.secondaryDamagePct > 0
        ? {
            secondaryDamagePct: turret.secondaryDamagePct,
            secondaryDamageType: turret.secondaryDamageType ?? 'kinetic',
          }
        : {}),
      ...(turret.ammoPerShot !== undefined && turret.ammoPerShot > 1 ? { ammoPerShot: turret.ammoPerShot } : {}),
      // 2026-09-13 虫洞专属（C 孢子导弹巢）：「对所有敌方同时攻击」——缺省不写 ⇒ 既有武器零变化
      ...(turret.hitsAllFoes === true ? { allFoes: true } : {}),
      falloff: turret.falloff ?? 0.3,
      reloadMs: reload,
      // **防空（属性）**（2026-09-11 机群批 S4 + 2026-09-12 船长「给近防炮系列添加一个属性'防空'」）：
      // 装备带 `antiDrone` ⇒ 一条属性带两件事——①能筛到敌方机群（`canHitDrones`）
      // ②打机群伤害 ×该值（`antiDroneMul`）。缺省不写 ⇒ 看不到机群（既有装备零行为变化）。
      ...(turret.antiDrone !== undefined
        ? { canHitDrones: true, antiDroneMul: turret.antiDrone }
        : {}),
    })
  }

  // 无人机装载（2026-09-08 无人机舱大改：只放飞该船 droneLoad 清单——不再从仓库/货仓自动贪心；
  // 甲板扩展 +bay、战术导控 +dmg 不变。装入时 CPU 已在装配预算内预占（UI 钳制），此处为防御：
  // 装配变化导致舱容/CPU 不足时按清单顺序整型裁到装得下，装不下的类型跳过）
  let bayLimit = ship.droneBayM3 ?? 0
  let droneDmgBonus = 0
  /**
   * 无人机中继天线（2026-09-10 船长：百分比制乘入机型基础射程）。
   *
   * ⚠ **2026-09-14 船长「对无人机的射程插件添加叠加惩罚」→「按推荐折算」**：由"全额线性相加"改为
   * **折权加算**（`weightedSum`）——四件同池（制式 MK1/2/3 + G 族「流亡中继桅」）按**加成从强到弱**排位，
   * 第 2 件起乘 `stackWeight` 的 87% / 57% / 28% / 11% 后相加 ⇒ 件件递减（读数：3×MK1 由 +60% → +48.8%、
   * 3×MK3 由 +240% → +195.2%）。判据单点 = `equipment.weightedSum`，收敛分组 = `stackingOf` 的 `weighted`。
   */
  const droneRangePcts: number[] = []
  for (const g of droneGear) {
    bayLimit += g.droneBayBonusM3 ?? 0
    droneDmgBonus += g.droneDmgBonus ?? 0
    if ((g.droneRangeBonusPct ?? 0) > 0) droneRangePcts.push(g.droneRangeBonusPct!)
  }
  const droneRangeMult = 1 + weightedSum(droneRangePcts)


  let bayUsed = 0
  // CPU 余量 = 预算总额（船体 CPU + 已装协处理器加成；2026-09-11 新增件）− 已装模块占用
  let cpuLeft = cpuBudgetOf(state, ctx, shipId) - fittedCpuUsed(fitted, ctx)
  const droneLoad = fleet.droneLoad ?? {}
  // 批次五更正（船长 2026-09-05）：无人机整备学改折装填（CPU 不打折）——每级 −4%
  //（与武器装填技术同口径，均为乘算；武器装填技术不含无人机，两者独立乘算）
  // 2026-09-10 船长（配合出击-返航动画节奏）：装填基准 2200→**4400ms**、单发同步 ×2
  // ——每轮更重、节奏更舒缓，**净 DPS 不变**（故既有校准矩阵口径不变，无需复跑）。
  // 机型级装填（2026-09-11 船长「哨卫将攻击周期翻倍」）：`def.reloadMs` 优先，缺省 = 基准 4400ms；
  // 整备学折减口径不变（每级 −4%）。
  // 2026-09-13 虫洞专属（掠袭机库「无人机攻击间隔 −8%」）：船长澄清 = **无人机出击周期**——
  // 与整备学（每级 −4%）同口径乘算；多件加算，合计上限 0.9（避免周期被压到 0）。
  const droneCycleCut = Math.min(
    0.9,
    droneGear.reduce((s, g) => s + (g.droneCycleCutPct ?? 0), 0),
  )
  const droneReloadOf = (def: { reloadMs?: number }): number =>
    Math.round(
      (def.reloadMs ?? 4400) *
        (1 - 0.04 * Math.min(5, state.skills.trained['drone-servicing'] ?? 0)) *
        (1 - droneCycleCut),
    )
  if (bayLimit > 0 && cpuLeft > 0) {
    for (const [droneId, want] of Object.entries(droneLoad)) {
      if (!want || want <= 0) continue
      const def = ctx.items.get(droneId)
      if (!def || def.kind !== 'drone') continue
      const perCpu = def.cpuUse ?? 0
      const perM3 = def.unitM3 ?? 0
      if (perCpu <= 0 || perM3 <= 0) continue
      const byCpu = Math.floor(cpuLeft / perCpu)
      const byBay = Math.floor((bayLimit - bayUsed) / perM3)
      const n = Math.max(0, Math.min(want, byCpu, byBay))
      if (n <= 0) continue
      bayUsed += perM3 * n
      cpuLeft -= perCpu * n
      // V18 战术导控阵列 ×(1+Σ导控)（乘算）；无人机作战学（drone-warfare）+5%/级 +
      // **无人机打击学（drone-strike）+4%/级**（2026-09-10 船长：高阶伤害技能）；三者乘算；
      // 2026-09-10 船长：再加船体无人机专属加成（ship.droneDmgBonus，王鲭 +12%/梭鱼 +8%）
      // 2026-09-10 船长：单发 ×2 与装填 ×2 同步（每轮更重、节奏更舒缓，净 DPS 不变）
      const shot = Math.round(
        (def.dmg ?? 0) *
          2 *
          (1 + droneDmgBonus) *
          (1 + (ship.droneDmgBonus ?? 0)) *
          (1 + DRONE_SKILL.warfarePerLevel * droneSkillLv(state, 'drone-warfare')) *
          (1 + DRONE_SKILL.strikePerLevel * droneSkillLv(state, 'drone-strike')),
      )
      for (let i = 0; i < n; i++) {
        weapons.push({
          label: def.name,
          kind: 'fixed',
          // 2026-09-10 船长批：无人机 = 独立来源 + 机型 id（每架一条条目；UI 按其放飞机群/出弹）
          src: 'drone',
          artId: droneId,
          fixedType: def.damageType ?? 'kinetic',
          shotDmg: shot,
          // 射程 = 机型基础 × 中继乘数（2026-09-10 船长：蜂鸟 2500/赤鸢 3000/猎鹰 3500/
          // 雷鸥哨戒 5000；旧值 2600 兜底；中继天线百分比乘入）
          maxRangeM: Math.round((def.maxRangeM ?? 2600) * droneRangeMult),
          minRangeM: 200,
          // 命中（2026-09-10 船长：下放到机型本体，不再硬编码 0.6/0.35）——
          // 侦察/战斗/攻坚三型 0.75 且**命中不随距离衰减**（falloff 1）；哨戒 1.10 保留正常衰减 0.35
          hitRate: def.hitRate ?? 0.6,
          falloff: def.falloff ?? 0.35,
          reloadMs: droneReloadOf(def),
        })
      }
    }
  }

  return {
    tag: 'player',
    name: ship.name,
    side: 'me',
    // 虫洞 D 批（2026-09-13）：我方单位的**档位/定位**——供敌方选靶模式「打最小/最大/打非战斗船」判定。
    // 单船路径不读这两项 ⇒ 只多两个字段，零行为变化。
    shipTier: ship.tier,
    shipRole: ship.role,
    hp,
    resists,
    // 本舰无人机结构层加成（模块求和；2026-09-13 船长：鱿蜂结构层「提高无人机 80% 的结构」）
    droneHullBonusPct: allDefs.reduce((s, m) => s + (m.droneHullHpBonusPct ?? 0), 0),
    // V18.1：回避 = 船体基础 + 姿态陀螺缺口复合（1−(1−基础)Π(1−x)）
    evasion,
    // ⚠ 2026-09-14 船长改判：**索敌统合不再放大舰船命中加成**（改去乘炮台基础命中，见上 `targetMult`）
    // ⇒ 这里恢复成**纯静态舰船值**（装配台那一行「命中加成 +N%」自此与实际完全一致）。
    hitBonus: ship.hitBonus ?? 0,
    // V17.1 失稳（多件只取最重一件；V18.1 索敌命中乘子走炮台条目 eqHitMul，不在此）
    // 2026-09-10 船长：本值 = **点火期**的命中乘子；冷却期不开火失稳（stepBattle 用 meAtk 置 1）
    hitMul: 1 - worstPen,
    signatureM: ship.signatureM ?? 80,
    scanResMm: ship.scanResMm ?? 500,
    // V17 矢量推进器 = 加力推进；V18.1 多件速度加成 EVE 曲线收敛；矢量机动操作（舰船）再乘 +5%/级
    // 2026-09-10 船长：装甲件的**常驻速度代价**（如陵寝装甲层 −25%）——多件只取最重一件
    // （与推进器失稳 hitPenalty 同口径：重甲不会叠成静止），钳制到 [0.1, 1]
    // 2026-09-10 船长（推进器周期化）：**基础速度不含推进器**——推进器改走 thrusterBoost，
    // 只在爆发窗口内生效（见 thrusterPhase），冷却期回到本值。
    speedMps:
      (ship.maxSpeedMps ?? 200) *
      (1 + bal.speedPerLevel * Math.min(5, state.skills.trained[bal.speedSkillId] ?? 0)) *
      Math.max(0.1, 1 - worstSpeedPen),
    // 推进器爆发倍率（多件 EVE 曲线收敛后的合成值 − 1）：0 = 未装；爆发窗口内才乘上去
    ...(speedEq > 1 ? { thrusterBoost: speedEq - 1 } : {}),
    // 本单位自己的点火周期（只在有覆盖件时写；没写 = 全局 60/60，见 `unitThrusterCycle`）
    ...(cycleOverridden ? { thrusterBoostMs: propCycle!.boostMs, thrusterCooldownMs: propCycle!.cooldownMs } : {}),
    agility: ship.agility,
    weapons,
    // 锁定装置（2026-09-09）：被锁目标受击加深等效比例（>0 同时开启集火模式）
    ...(lockEq > 1 ? { lockedDmgBonus: lockEq - 1 } : {}),
    foeTactic: null,
  }
}

/** 我方主武器固定弹种（V18 多炮：取高槽第一门武器（炮台/导弹架）的 damageType；无武器
 * 也返回 kinetic——基础舰炮实际不消耗弹药）。多门异弹型武器的装载/消耗在出发预载时按
 * 主武器型装载（battle.ammo 单型；异型武器在主弹种耗尽后停火，见 E 台阶 per-gun 完整化）。 */
export function playerAmmoType(state: GameState, ctx: SimContext, shipId: string): DamageType {
  const weapons = [
    ...familyModules(state, ctx, shipId, 'turret'),
    ...familyModules(state, ctx, shipId, 'missile'),
    ...familyModules(state, ctx, shipId, 'laser'),
  ]
  return (weapons[0]?.damageType as DamageType | undefined) ?? 'kinetic'
}

/* ═══════════ 敌方编队 ═══════════ */

const PROFILE_SPLIT: Record<string, Hp3> = {
  shield: { s: 0.5, a: 0.25, h: 0.25 },
  armor: { s: 0.2, a: 0.55, h: 0.25 },
  balanced: { s: 0.34, a: 0.33, h: 0.33 },
}

/** 敌方战术 → 武器射程带（贴合作战风格）：
 * brawl 贴脸肉搏 = 无最小射程的近身喷子；orbit 环绕 = 中距小炮；kite 放风筝 = 高最小射程的远距炮。
 * C4-#3（2026-09-05）：射程/速度由"虚拟装配模板"推导——射程 = 基础带 ×
 * (1 + 侧重系数×(threat−10)/90) 后封顶；速度 = 参考船速段 × m_base × tactic 系数
 * （平衡常量 battle 段 foe* 模板）。射程语义保持 tactic 身份（brawl 近战靠速度贴脸）。
 *
 * ⚠ **2026-09-11 起本表只服务旧威胁推导路径**：舰级路径（写了 `ships` 的卡）的期望交距
 * 改用**单位自己的射程带**（`UnitSpec.foeRangeBand`，见 `foeDesiredRange`）。旧路径行为一字不变。 */
const TACTIC_RANGE: Record<FoeTactic, { max: number; min: number }> = {
  brawl: { max: 2200, min: 0 },
  orbit: { max: 4600, min: 350 },
  kite: { max: 9200, min: 1200 },
}

/** 参考船速分段查询（threat → 等效船体 maxSpeed；与玩家 maxSpeedMps 同池） */
export function foeRefSpeedMps(threat: number, bal: BattleBalance): number {
  const table = bal.foeRefSpeedTable
  for (let i = 0; i < table.length; i++) {
    if (threat <= table[i]!.upToThreat) return table[i]!.maxSpeedMps
  }
  const last = table[table.length - 1]
  return last ? last.maxSpeedMps : 200
}

/** 敌速基数（无 tactic 系数）：m_base = 0.80 + (0.95−0.80)×(threat−10)/90，clamp [0.7, 1.15] */
function foeSpeedBase(threat: number, bal: BattleBalance): number {
  const lo = bal.foeSpeedAtThreat10 ?? 0.8
  const hi = bal.foeSpeedAtThreat100 ?? 0.95
  const t = Math.min(1, Math.max(0, (threat - 10) / 90))
  return Math.min(1.15, Math.max(0.7, lo + (hi - lo) * t))
}

/**
 * 敌编队总血（C4 时长预期曲线反推，2026-09-05）：参考段火力 × D(T)。
 *
 * ⚠ **2026-09-12 船长裁定「解除血量钳制，改为火力限制」**：
 * 旧式是 `t = min(1, (T − floor) / span)` ⇒ **威胁 ≥ 96 血量一律冻结在 1152**（威胁 100/150/300 全同），
 * 而敌火力 `威胁 × foeDpsPerThreat` 却线性不封顶 ⇒ 抬威胁只会得到"更脆更毒"的敌人。
 * 故此处**去掉 `min(1, …)`**：血量随威胁继续增长；火力改由 `BattleBalance.foeDpsCap`（**150 DPS**，
 * 见 `foeDpsCapScaleOf`）封顶；**速度与射程成长的钳制保留**（`foeRefSpeedMps` / `growT`，避免敌人"又快又远又硬"）。
 *
 * **对现有内容的影响（实测）**：全表 27 张卡威胁 ≤ 96 ⇒ `t ≤ 1` ⇒ **逐字零变化**；
 * 受影响的是**窝点派生档**（`LAIR_THREAT_MUL` 1.3/1.6/2.0 会把高威胁卡的派生威胁推到 96 以上）
 * ——那正是本裁定要修的：派生档"威胁涨了、血量被钳住"的失配。
 */
export function foeHpOfThreat(threat: number, bal: BattleBalance): number {
  const floor = bal.foeHpCurveFloorThreat ?? 6
  const span = bal.foeHpCurveSpanThreat ?? 90
  const t = Math.max(0, (threat - floor) / span) // ← 2026-09-12：去掉 min(1, …) 的封顶
  const d = (bal.foeHpCurveDMin ?? 5) + (bal.foeHpCurveDSpan ?? 85) * Math.pow(t, bal.foeHpCurveExp ?? 1.6)
  const table = bal.foeRefFire
  let f = table[0]?.dps ?? 5
  for (let i = 0; i < table.length; i++) {
    if (threat <= table[i]!.upToThreat) {
      f = table[i]!.dps
      break
    }
    f = table[i]!.dps
  }
  return Math.max(1, Math.round(f * d))
}

/** 展开敌方编队（threat 卡面 = 总战力；血/火力威胁线性，射程/速度走虚拟装配模板） */
/** createFoeSpecs 波次参数（2026-09-09 多波；缺省 = 单波现状） */
export interface FoeSpecOpts {
  /** 本波"主舰+僚机"小队数（escorts 随卡不变） */
  units?: number
  /** 本波分得的敌总血比例（0~1；缺省 1 = 全量） */
  hpShare?: number
  /** tag 前缀（第 2 波起用，避免与首波/旧档 tag 冲突；首波 = '' 保持 foe-0/foe-1 旧命名） */
  tagPrefix?: string
}

/* ═══════════ 敌舰显示名（2026-09-09 船长拍板：同一悬赏内规格/属性不同的敌舰名字不同；
   名字只由"异常属性 × 单位规格"推导，引擎建档与界面显示同源，存档字符串仅作兜底） ═══════════ */

/** 敌舰"舰种名"按 战术 × 血型（9 类；满规格主体用本名，弱规格单位加词缀） */
const FOE_CLASS: Record<string, Record<string, string>> = {
  brawl: { shield: '突击护卫舰', armor: '攻坚重甲舰', balanced: '突击炮艇' },
  orbit: { shield: '巡逻护卫舰', armor: '装甲巡逻舰', balanced: '环绕护航舰' },
  kite: { shield: '狙击护卫舰', armor: '远程装甲舰', balanced: '狙击炮艇' },
}

/** 规格词缀（前缀）：轻装 = 单舰规格 ≤ 本场最强档 ×FOE_LIGHT_FRAC（现覆盖僚机 ×0.6 份额与
 *  明显低血波，见 foeUnitNameOf）；"精锐"档预留——若将来出现相对规格 >1 的头目单位，
 *  在此增加精锐前缀分支即可（词缀判定与血量数值解耦，纯命名）。 */
export const FOE_LIGHT_WORD = '轻装'
/** 头目档词缀（2026-09-11 船长裁决实装；对应 `FoeShipDef.elite`）——与「轻装」同为纯命名、与数值解耦 */
export const FOE_ELITE_WORD = '精锐'
const FOE_LIGHT_FRAC = 0.6
const FOE_CLASS_FALLBACK = '敌方舰艇'

/** 舰种名（战术 × 血型；与卡面"敌型/战术"口径一致） */
export function foeClassName(tactic: string | undefined, profile: string | undefined): string {
  return FOE_CLASS[tactic ?? 'orbit']?.[profile ?? 'balanced'] ?? FOE_CLASS_FALLBACK
}

/** 主/僚判定（按 tag 结构，2026-09-09 多波）：主舰 = foe-0 或 w{n}-foe-{k}；
 *  僚机 = legacy foe-N（N≥1，旧单波 escorts）或 *-e{i}（各小队 escort）。 */
export function foeMainTagOf(tag: string): boolean {
  if (tag === 'foe-0') return true
  if (/^foe-\d+$/.test(tag)) return false
  return tag.includes('-foe-') && !tag.includes('-e')
}

/** 单位所在波的血档（tag 前缀 w{n}- 反查波表；首波/无波表 = 1） */
function waveHpShareOf(tag: string, anomaly: AnomalyDef): number {
  const waves = anomaly.waves
  if (!waves || waves.length === 0) return 1
  const m = /^w(\d+)-/.exec(tag)
  const idx = m ? Math.min(waves.length - 1, parseInt(m[1]!, 10)) : 0
  return Math.max(0.001, waves[idx]!.hpShare ?? 1)
}

/* ═══════ 舰级路径（2026-09-11 船长定案：敌舰配置表 · A 族试点）═══════
 * 写了 `anomaly.ships` 的卡走这条路：单位一律按**舰级绝对值 × 本条倍率**建档，
 * 不吃威胁份额均分、不吃 hpShare；允许同波混编（一张卡引用多个舰级）。
 * 未写的卡走下面的旧"威胁推导"路径，行为逐字不变。 */

/** 波序号从 tag 前缀反查（首波 = ''；第 n 波 = 'w{n}-'），与旧多波 tag 口径一致 */
function shipWaveIndexOf(prefix: string): number {
  const m = /^w(\d+)-$/.exec(prefix)
  return m ? parseInt(m[1]!, 10) : 0
}

/**
 * 按 tag 命名规则枚举某波的舰级单位（**建档与反查共用同一顺序**，保证 tag 与舰级一一对应）。
 * tag 规则与旧口径一致：首队 = `foe-0`（主体）/ `foe-{i}`（僚机）；其余小队 = `{prefix}foe-{k}` /
 * `{prefix}foe-{k}-e{i}`（首波非首队用 `w0-` 前缀）。
 */
function enumerateShipUnits(
  anomaly: AnomalyDef,
  waveIdx: number,
): Array<{ tag: string; slot: FoeShipSlot; escort: boolean }> {
  const prefix = waveIdx === 0 ? '' : `w${waveIdx}-`
  const out: Array<{ tag: string; slot: FoeShipSlot; escort: boolean }> = []
  let mainIdx = 0
  let lastMain = 0
  for (const slot of anomaly.ships ?? []) {
    if ((slot.wave ?? 0) !== waveIdx) continue
    const count = Math.max(1, Math.floor(slot.count ?? 1))
    const isEscort = slot.escort === true
    for (let i = 0; i < count; i++) {
      const k = isEscort ? lastMain : mainIdx + i
      const legacySquad = prefix === '' && k === 0
      const squadPrefix = legacySquad ? '' : prefix === '' ? 'w0-' : prefix
      const tag = isEscort
        ? legacySquad
          ? `foe-${i + 1}`
          : `${squadPrefix}foe-${k}-e${i + 1}`
        : legacySquad
          ? 'foe-0'
          : `${squadPrefix}foe-${k}`
      out.push({ tag, slot, escort: isEscort })
    }
    if (!isEscort) {
      lastMain = mainIdx + count - 1
      mainIdx += count
    }
  }
  return out
}

/** 舰级路径的 tag → 舰级反查（界面 `foeUnitNameOf` 沿用同一入口，读档/实时推导都不迁移） */
function foeShipAtTag(anomaly: AnomalyDef, tag: string): { ship: FoeShipDef; escort: boolean } | null {
  if (!anomaly.ships || anomaly.ships.length === 0) return null
  const m = /^w(\d+)-/.exec(tag)
  const waveIdx = m ? parseInt(m[1]!, 10) : 0
  for (const u of enumerateShipUnits(anomaly, waveIdx)) {
    if (u.tag === tag) return { ship: u.slot.ship, escort: u.escort }
  }
  return null
}

/** 敌舰单位显示名（船长 2026-09-09 拍板：舰种名 + 规格词缀）：
 * - **舰级路径**（有 `anomaly.ships`）：舰级自带玩家可见舰种名；头目档 → 「精锐」前缀，
 *   僚机 → 「轻装」前缀（2026-09-11 船长裁决实装精锐档）。
 * - **旧路径**：满规格主体 = 舰种名（9 类原样）；僚机（份额 ×0.6）或 明显低血波主舰
 *   （hpShare ≤ 同卡最强波 ×0.6）→ 轻装 + 舰种名；单卡单波/波间差异小（如穹顶 .857 比值）不触发。 */
export function foeUnitNameOf(anomaly: AnomalyDef, tag: string): string {
  const hit = foeShipAtTag(anomaly, tag)
  if (hit) {
    if (hit.ship.elite) return `${FOE_ELITE_WORD}${hit.ship.name}`
    return hit.escort ? `${FOE_LIGHT_WORD}${hit.ship.name}` : hit.ship.name
  }
  const base = foeClassName(anomaly.tactic, anomaly.defProfile)
  if (!foeMainTagOf(tag)) return `${FOE_LIGHT_WORD}${base}`
  const waves = anomaly.waves
  if (waves && waves.length > 0) {
    let maxShare = 0.001
    for (const w of waves) maxShare = Math.max(maxShare, w.hpShare ?? 0)
    if (waveHpShareOf(tag, anomaly) / maxShare <= FOE_LIGHT_FRAC) return `${FOE_LIGHT_WORD}${base}`
  }
  return base
}

/**
 * **敌舰单位的舰种档**（2026-09-11 船长：战斗动画的舰身体积与舰种挂钩）——界面的**只读查询**，
 * 与 `foeUnitNameOf` 同源（同一份 tag → 舰级反查）。
 *
 * - **舰级路径**（写了 `anomaly.ships` 的卡）：返回该编成条目所引舰级的 `hullClassTier`（1~5）；
 * - **旧威胁推导路径**（未写 `ships` 的卡）：返回 **`null`**——这些卡**没有舰种档**
 *   （旧路径的"舰种名"由战术×血型推导，不是质量分级）⇒ 界面按**回落尺寸**绘制。
 *   ⚠ 2026-09-11 船长裁定：旧路径卡的体积口径**延后**（等各族舰级在二号处补完再生效）。
 *
 * 用途：战斗画面按舰种给舰身尺寸（`TIER_SIZE`，见 `ui/battleViewCore`）——引擎**不消费**本值。
 */
export function foeShipTierOf(anomaly: AnomalyDef, tag: string): 1 | 2 | 3 | 4 | 5 | null {
  const hit = foeShipAtTag(anomaly, tag)
  return hit ? hit.ship.hullClassTier : null
}

/**
 * **敌舰单位是否「头目档」（`FoeShipDef.elite`）**（2026-09-11 船长：敌列错列雁阵"主舰在前、僚机与杂鱼在后"）——
 * 界面的**只读查询**，与 `foeUnitNameOf`/`foeShipTierOf` 同源（同一份 tag → 舰级反查）。
 *
 * ⚠ 界面**不能用 `foeMainTagOf` 当"主舰"**：那条规则把多波/多小队的 `w{n}-foe-{k}`（k≥1）也当主舰
 * （2026-09-09 为"第 2 艘主舰不再当僚机"而放宽）⇒ A 族卡的 3 艘杂鱼会被判成主舰。阵形用
 * 「**tag 是本波首舰（`(w{n}-)?foe-0`）或该舰级为头目档**」作"前排"，故需要本查询。
 *
 * 旧威胁推导路径（无舰级）→ `false`（这些卡靠 tag 首舰判前排）。
 */
export function foeShipEliteOf(anomaly: AnomalyDef, tag: string): boolean {
  const hit = foeShipAtTag(anomaly, tag)
  return hit ? hit.ship.elite === true : false
}

/**
 * **多舰船补偿系数** `2N/(N+1)`（2026-09-11 船长确认「先按照你的提议实现」；N = 本卡编成单位总数）。
 *
 * 动机（数学）：N 个单位**逐个被击毁**时，敌人整场的累计输出 = 单舰基准 × `(N+1)/(2N)`
 * （单位 1 全场输出、单位 2 输出 (N−1)/N 场 …单位 N 输出 1/N 场，均值 = (N+1)/(2N)），
 * **N=4 时只有 62.5%**；本系数正好抵消这层阶梯衰减（N=4 → ×1.6）。
 *
 * 适用范围（本批口径）：**只在舰级路径**（写了 `anomaly.ships` 的卡）施加；
 * **旧威胁推导路径一律不动**——那里 `N=1`，系数天然为 1、无影响。
 * ⚠ 已知口径不一致：旧路径（未写 `ships` 的卡）**暂未启用**该补偿，待旧卡迁入舰级路径时统一。
 */
function foeMultiShipCompMul(anomaly: AnomalyDef): number {
  const n = (anomaly.ships ?? []).reduce((s, x) => s + Math.max(1, Math.floor(x.count ?? 1)), 0)
  return n <= 1 ? 1 : (2 * n) / (n + 1)
}

/**
 * **舰级路径建档**：单位属性 = 舰级绝对值 × 本条倍率。
 * - 血：`ship.hp × hpMul`（**不吃威胁份额、不吃 hpShare**）；三层比例 = **有效 split = 条目覆写 ?? 舰级**
 *   （2026-09-11 船长裁决①「头目血型随卡片走」）
 * - 单发：`round(ship.shotDmg × dmgMul × 多舰船补偿)`；
 *   **多舰船补偿 `2N/(N+1)`**（2026-09-11 船长确认）在建档时按"本卡编成单位总数 N"缩放单发，
 *   见 `foeMultiShipCompMul`；卡上 `dmgMul` 写的是**设计单发 ÷（舰级单发 × 补偿）**，
 *   故引擎实建档值即船长确认的设计单发。
 *   速度（2026-09-11 追加裁决「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」）：
 *   `round(HULL_CLASS_BASE_SPEED[舰种档] × speedRatio × speedMul)` ——
 *   **舰种基准 × 倍率**（基准 = `bal.hullClassBaseSpeedMps`，倍率 = `ship.speedRatio` 与条目 `speedMul`）。
 * - 射程带：两端同乘 `rangeMul` 后取整（保持 min < max）
 * - 主系/命中：可逐条覆写（缺省走舰级）；**能量主系形态**由 `energyForm` 决定——
 *   缺省/`'beam'` = 光束必中（不消费命中）；`'spit'` = **掷命中**（消费 `hitRate`、命中随距离衰减）。
 *   2026-09-11 船长裁决⑤「立「能量·掷命中」档」。
 */
/**
 * **机群/炮台火力占比的守恒拆分**（2026-09-11 船长：「**允许调整敌舰的无人机/炮台火力比例。
 * 这个要根据每个悬赏卡制定**」；七项细节由船长逐条点选）。
 *
 * 口径 = **守恒拆分**（与 A5「机群火力计入卡的总火力、母船单发让位」同源）：
 * 1. **基准 T** = 该**条目**按旧口径的**实收总单发**（该条目所有单位的炮台 ＋ 该条目所有架次机群；
 *    含 `dmgMul`、含多舰补偿 `2N/(N+1)`、含逐条取整）——即"今天玩家会吃到的量"；
 * 2. **机群先取** `D = round(T × s)`、**炮台余额** `G = T − D`；**两侧各保底**：机群 `D ≥ 架数`、
 *    炮台 `G ≥ 单位数`（⇒ **不会出现 0 伤害条目**）；
 * 3. **机群摊分**：D 均摊到逐架（顺序 = 条目内单位顺序 × 该舰 `drones` 展开顺序，与
 *    `foeDronePools` **同序**），**余数补给前面的架次**，保证 Σ = D；
 * 4. **炮台摊分**：G 按各单位「旧口径炮台单发」权重摊（同一条目内各单位的 `dmgMul` 相同 ⇒ 权重相等，
 *    故等价于均分；**余数补给前面的单位**），保证 Σ = G。
 *
 * 生效范围 = **只拆「机群 vs 母舰武器组」两类**（敌侧近防炮照 B3 裁定不动）；
 * 命中 / 射程 / 装填 / 血型 / 期望交距**一律不受影响**（本旋钮只改火力构成）。
 * **未写 `droneFireShare`（条目 ?? 舰级）的条目返回 `null`** ⇒ 建档走旧算法、**零行为变化**。
 */
function droneFireSplitOf(
  units: ReadonlyArray<{ slot: FoeShipSlot }>,
  comp: number,
): Array<{ gun: number; drones: number[] } | null> {
  const out: Array<{ gun: number; drones: number[] } | null> = units.map(() => null)
  /** 同一 `slot` 对象（`count > 1` 时被枚举多次）归成一组——比例与摊分都按**条目**算 */
  const groups = new Map<FoeShipSlot, number[]>()
  for (let i = 0; i < units.length; i++) {
    const slot = units[i]!.slot
    const list = groups.get(slot)
    if (list) list.push(i)
    else groups.set(slot, [i])
  }
  for (const [slot, idxs] of groups) {
    const share = slot.droneFireShare ?? slot.ship.droneFireShare
    if (share === undefined) continue
    const droneSlots = slot.ship.drones ?? []
    const perUnitDrones = droneSlots.reduce((n, ds) => n + Math.max(0, Math.round(ds.count)), 0)
    if (perUnitDrones === 0) continue // 无机群 ⇒ 比例无意义（契约另拦）；这里按未写处理
    const unitCount = idxs.length
    const nDrones = unitCount * perUnitDrones
    const mul = slot.dmgMul ?? 1
    const gunOld = Math.max(1, Math.round(slot.ship.shotDmg * mul * comp))
    const droneOld = droneSlots.flatMap((ds) =>
      Array.from({ length: Math.max(0, Math.round(ds.count)) }, () =>
        Math.max(1, Math.round(ds.drone.dmg * mul)),
      ),
    )
    const droneOldSum = droneOld.reduce((a, b) => a + b, 0)
    // ① 基准 T（该条目实收总单发）：
    //    **写了 `firepowerAnchor` ⇒ 以锚点为准**（船长 2026-09-12「架数变多、总火力不动」）——
    //    否则沿用旧公式（`单位数 ×（炮台旧单发 + Σ机群旧单发）`，零行为变化）。
    const T =
      slot.firepowerAnchor !== undefined && slot.firepowerAnchor > 0
        ? Math.max(nDrones + unitCount, Math.round(slot.firepowerAnchor))
        : unitCount * (gunOld + droneOldSum)
    const D = Math.max(nDrones, Math.min(Math.round(T * clamp(0, 1, share)), Math.max(nDrones, T - unitCount)))
    const G = T - D
    // ④ 机群摊分：逐架均分、余数补给前面的架次
    const dBase = Math.floor(D / nDrones)
    let dRem = D - dBase * nDrones
    // ⑤ 炮台摊分：按旧口径单发权重（同条目内每单位相同 ⇒ 权重相等），余数补给前几个单位
    const gBase = Math.floor(G / unitCount)
    let gRem = G - gBase * unitCount
    for (const i of idxs) {
      const drones: number[] = []
      for (let k = 0; k < perUnitDrones; k++) {
        drones.push(dBase + (dRem > 0 ? 1 : 0))
        if (dRem > 0) dRem -= 1
      }
      out[i] = { gun: gBase + (gRem > 0 ? 1 : 0), drones }
      if (gRem > 0) gRem -= 1
    }
  }
  return out
}

/**
 * **敌舰体火力上限**（2026-09-12 船长：「按照 DPS 上限 150 算」）——舰级路径按**整卡舰体总 DPS** 封顶。
 *
 * 口径（全部经实测确认）：
 * - **只算舰体武器组**（每条目 `ship.shotDmg × dmgMul × 多舰补偿` ÷ `ship.reloadMs` 秒）；
 *   **不含机群**（机群另有受击增程 / 备用机库 / A5 守恒三套机制，且船长已裁定不吃多舰补偿）；
 * - **不含被 `droneFireShare` / `firepowerAnchor` 拆分的条目**——那条链自带总火力锚定，
 *   再钳制会让锚点失准（`droneFireSplitOf` 内部已含补偿，钳制与外层缩放会打架）；
 * - 单发是整数 ⇒ 逐条取整后再求和，越线时**全卡舰体单发等比例缩放**（保持各条目相对权重）。
 *
 * 现值 150 与现有卡的关系（实测）：27 张卡**全部未越线**（最高 = 虚海守望者 131.25 DPS）
 * ⇒ **零行为变化**。每单位威胁触顶值 = `150 ÷ 0.8 ÷ 补偿` ⇒ N=1 **187.5** · N=3 **125** ·
 * N=4 **117.2** · N=11 **102.3** ——将来的多单位高威胁卡会先撞上它。
 *
 * `foeDpsCap` 未写或非正 ⇒ 返回 1（不钳制，零行为变化）。
 */
function foeHullDpsOf(ship: FoeShipDef, dmgMul: number, comp: number, bal: BattleBalance): number {
  const per = Math.max(1, Math.round(ship.shotDmg * dmgMul * comp))
  return (per * 1000) / Math.max(1, ship.reloadMs)
}

/** 逐 `slot` 缓存缩放系数（同一条目的多个单位共用，避免重复计算） */
function foeDpsCapScaleOf(
  units: ReadonlyArray<{ slot: FoeShipSlot }>,
  comp: number,
  bal: BattleBalance,
  splitIdx: ReadonlyArray<{ gun: number; drones: number[] } | null>,
): Map<FoeShipSlot, number> {
  const out = new Map<FoeShipSlot, number>()
  const cap = bal.foeDpsCap
  if (cap === undefined || !(cap > 0)) return out
  const seen = new Set<FoeShipSlot>()
  const bySlot = new Map<FoeShipSlot, number[]>()
  for (let i = 0; i < units.length; i++) {
    const slot = units[i]!.slot
    const list = bySlot.get(slot)
    if (list) list.push(i)
    else bySlot.set(slot, [i])
  }
  let total = 0
  for (const [slot, idxs] of bySlot) {
    // 被占比/锚点拆分的条目跳过（自带总火力锚定；钳制会让锚点失准）
    if (idxs.some((i) => splitIdx[i] !== null)) continue
    seen.add(slot)
    total += idxs.length * foeHullDpsOf(slot.ship, slot.dmgMul ?? 1, comp, bal)
  }
  if (total <= cap) return out
  const scale = cap / total
  for (const slot of seen) out.set(slot, scale)
  return out
}

function createFoeSpecsFromShips(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts): UnitSpec[] {
  const prefix = opts.tagPrefix ?? ''
  const waveIdx = shipWaveIndexOf(prefix)
  const comp = foeMultiShipCompMul(anomaly)
  const units = enumerateShipUnits(anomaly, waveIdx)
  // **机群/炮台火力占比**（2026-09-11 船长：「允许调整敌舰的无人机/炮台火力比例。这个要根据每个
  // 悬赏卡制定」）——**条目级**旋钮，守恒拆分：先按旧口径算出该条目的实收总单发 T（含多舰补偿、
  // 逐条取整），再拆成「机群 D = round(T×s)」与「炮台 G = T−D」（两侧各保底 1/架、1/单位）。
  // 未写 s 的条目一律 `null` ⇒ 下面走旧算法（**零行为变化**）。
  const fireSplit = droneFireSplitOf(units, comp)
  // **敌舰体火力上限**（2026-09-12 船长「按照 DPS 上限 150 算」）：整卡舰体总 DPS 越线时，
  // 全卡舰体单发等比例缩放（机群与"被占比拆分的条目"不参与，见 `foeDpsCapScaleOf`）。
  const dpsCapScale = foeDpsCapScaleOf(units, comp, bal, fireSplit)
  return units.map((u, ui) => {
    const sp = fireSplit[ui]
    const ship = u.slot.ship
    const mix = u.slot.dmgMix ?? ship.dmgMix
    const type = pickTopType(mix)
    const totalHp = ship.hp * (u.slot.hpMul ?? 1)
    // 血型（三层比例）：**有效 split = 条目覆写 ?? 舰级**（2026-09-11 船长裁决①「头目血型随卡片走」）——
    // 同一条舰级在不同卡上可按卡面 `defProfile` 建档（A 族鱼龙混杂 ⇒ 什么血型都有，无族级约束）。
    const split = u.slot.split ?? ship.split
    const hp: Hp3 = { s: totalHp * split.s, a: totalHp * split.a, h: totalHp * split.h }
    // 炮台单发：写了比例 ⇒ 取拆分后的 G 摊分结果（Σ 与旧口径守恒），否则逐字沿用旧算法；
    // 之后再乘**舰体火力上限缩放**（越线才 <1；`fireSplit` 非空的条目缩放 = 1，见 `foeDpsCapScaleOf`）
    const shotDmg = sp
      ? sp.gun
      : Math.max(1, Math.round(ship.shotDmg * (u.slot.dmgMul ?? 1) * comp * (dpsCapScale.get(u.slot) ?? 1)))
    const shotSplit = splitShotByComposition(shotDmg, compositionOfMix(mix))
    const multiShots: Partial<Record<DamageType, number>> | undefined =
      shotSplit.length > 1
        ? shotSplit.reduce<Partial<Record<DamageType, number>>>((acc, r) => {
            acc[r.type] = (acc[r.type] ?? 0) + r.dmg
            return acc
          }, {})
        : undefined
    const rangeMul = u.slot.rangeMul ?? 1
    const rangeMax = Math.max(2, u.slot.rangeMaxM ?? Math.round(ship.rangeMaxM * rangeMul))
    const rangeMin = Math.max(1, Math.min(rangeMax - 1, u.slot.rangeMinM ?? Math.round(ship.rangeMinM * rangeMul)))
    // 战术：卡上覆写优先（2026-09-11 船长「头目建议允许多个战术」）——同一条头目舰可配多种打法
    const tactic = u.slot.tactic ?? ship.tactic
    // 能量武器形态（2026-09-11 船长裁决⑤「立「能量·掷命中」档」）：条目覆写 > 舰级，缺省 = 光束必中。
    // **只对能量主系生效**：动能/爆炸主系本来就是 fixed 掷命中，本字段不参与。
    const energyForm = (u.slot.energyForm ?? ship.energyForm) === 'spit' ? ('spit' as const) : ('beam' as const)
    const isBeam = type === 'plasma' && energyForm === 'beam' // 光束必中（缺省口径，零行为变化）
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**条目写了 `enterAt` 且总开关打开**时
    // 才给单位挂 `foeReinforceAt`——开关关闭时本字段一律不写（与 `foeCanCharge` 同款总开关形态，
    // 这保证"关了就是零行为变化"）。触发条件全无效 = 视为未写 = 开战即在（见 `FoeReinforceTrigger` 注释）。
    const reinforceAt =
      bal.foeReinforceEnabled === true
        ? normReinforceTrigger(u.slot.enterAt)
        : null
    const name = foeUnitNameOf(anomaly, u.tag);
    /** 本条目内**逐架机群单发**的游标（与 `ship.drones` 展开顺序一致，仅写了比例时消费） */
    let dIdx = 0
    // **舰载机群**（2026-09-11 机群批 · 设计稿 `foe-drone-system-20260911.md` §三/§五）：
    // 每架展开成**一条** `src:'drone'` 武器条目（与我方"每架一条"同构 ⇒ 演出层按机型合并、按架击落）。
    // **A5 火力守恒**：机群吃**同一条 `dmgMul`**（⇒ 卡上挂机群时把 `dmgMul` 调低，**母舰单发自动让位**）；
    // **不吃多舰补偿**（船长 2026-09-11 裁定「不吃」——`foeMultiShipCompMul` 只数舰级编成单位，本就不含机群）。
    const droneWeapons: WeaponSpec[] = (ship.drones ?? []).flatMap((ds) =>
      Array.from({ length: Math.max(0, Math.round(ds.count)) }, () => ({
        label: `${ds.drone.name} ×1`,
        kind: 'fixed' as const,
        src: 'drone' as const,
        artId: ds.drone.id,
        fixedType: ds.drone.damageType,
        // 机群单发：写了比例 ⇒ 取拆分后的 D 摊分结果（逐架、余数补前面的架次），否则沿用旧算法
        shotDmg: sp
          ? sp.drones[dIdx++]!
          : Math.max(1, Math.round(ds.drone.dmg * (u.slot.dmgMul ?? 1))),
        maxRangeM: Math.max(2, ds.drone.maxRangeM),
        minRangeM: 1, // 机群无近盲带（贴脸也打）
        hitRate: ds.drone.hitRate,
        falloff: ds.drone.falloff,
        reloadMs: ds.drone.reloadMs,
      })),
    )
    // **备用机库**（2026-09-12 船长「损坏后补充敌机」）：备用机与 `drones` **同机型**，
    // 建档时展开成**额外的待命条目**（`initFoeDronePools` 把它们标成 `inHangar`：不出战、不开火、
    // 不计存活架数；前线战损后按 `respawnMs` 满血放出）。⚠ 不写 = 无备用（零行为变化）。
    const reserve = ship.droneReserve
    const reserveModel = (ship.drones ?? [])[0]?.drone
    if (reserve && reserveModel && reserve.count > 0) {
      for (let k = 0; k < Math.round(reserve.count); k++) {
        droneWeapons.push({
          label: `${reserveModel.name} ×1`,
          kind: 'fixed' as const,
          src: 'drone' as const,
          artId: reserveModel.id,
          reserve: true, // **账目标记**：备用机（库存深度）——总火力/守恒核对排除它
          fixedType: reserveModel.damageType,
          shotDmg: sp ? sp.drones[sp.drones.length - 1]! : Math.max(1, Math.round(reserveModel.dmg * (u.slot.dmgMul ?? 1))),
          maxRangeM: Math.max(2, reserveModel.maxRangeM),
          minRangeM: 1,
          hitRate: reserveModel.hitRate,
          falloff: reserveModel.falloff,
          reloadMs: reserveModel.reloadMs,
        })
      }
    }
    return {
      tag: u.tag,
      name,
      side: 'foe' as const,
      hp,
      /**
       * **层位抗性**（2026-09-15 船长：「我现暂时只打给 **C 族**添加**全血条 25% 爆炸抗性**」）：
       * 从**舰级**读（`FoeShipDef.shieldResist / armorResist / hullResist`；三条都缺省 ⇒ `{}`，
       * 既有舰级零行为变化）。与敌机群那条装配口径一致（同 `FoeDroneDef.defense` 的展开写法）。
       * ⚠ 抗性只减不减：`applyDamage` 夹 `0~0.9`，所以传进来的负数**不会**变成"易伤"。
       */
      resists: {
        ...(ship.shieldResist ? { shield: ship.shieldResist } : {}),
        ...(ship.armorResist ? { armor: ship.armorResist } : {}),
        ...(ship.hullResist ? { hull: ship.hullResist } : {}),
      },
      evasion: 0.12,
      hitBonus: 0,
      signatureM: Math.max(45, Math.round(60 + totalHp * 0.5)),
      scanResMm: 450,
      // 速度 = 舰种基准速度 × 舰级倍率 × 本条 speedMul（后取整）——2026-09-11 追加裁决：
      // 「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」；基准表在 BattleBalance
      // （core 不能 import data 包的 hullClass.ts，故基准随 bal 传入），零行为变化。
      speedMps: Math.round(bal.hullClassBaseSpeedMps[ship.hullClassTier] * ship.speedRatio * (u.slot.speedMul ?? 1)),
      agility: 0.3,
      // 敌突进（冲锋）资格，两条**互相独立**的来源（2026-09-11 船长「给巨兽开启之前做过的冲锋能力」）：
      //   ① **舰级级 opt-in**（`ship.foeCanCharge`）——无条件放行，**不看**总开关与威胁门槛，
      //      用于"慢而硬、追不上"的重型单位（C 族噬口巨兽，实速 297）与 2026-09-14 起同样开启的三种小虫；
      //   ② 老路：威胁 ≥ 门槛 且 **有效战术** = brawl（卡上覆写优先；总开关默认 false）。
      ...(ship.foeCanCharge === true ||
      (bal.foeChargeEnabled === true &&
        anomaly.threat >= bal.foeChargeThreatFloor &&
        tactic === 'brawl')
        ? { foeCanCharge: true }
        : {}),
      // **逐单位冲锋倍率**（2026-09-14 船长：「大虫子的冲锋倍率改为3，给小虫子添加冲锋，倍率为1.5」）——
      // 缺省**不写** ⇒ 走全局 `bal.foeChargeMul`（旧读数逐字不变）；缺省不写也是"关着就是零变化"的同款形态。
      ...(ship.foeChargeMul !== undefined ? { foeChargeMul: ship.foeChargeMul } : {}),
      // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）——带本字段的单位**不进开战编队**
      ...(reinforceAt ? { foeReinforceAt: reinforceAt } : {}),
      weapons: [
        {
          label: `${name} 武器组`,
          // 形态（2026-09-11 船长裁决⑤）：能量主系 = 光束必中（缺省）/ 掷命中（`energyForm: 'spit'`）；
          // 动能/爆炸主系一律 fixed 掷命中，不受本字段影响。
          kind: isBeam ? ('beam' as const) : ('fixed' as const),
          fixedType: type,
          shotDmg,
          ...(multiShots ? { shotsByType: multiShots } : {}),
          maxRangeM: rangeMax,
          minRangeM: rangeMin,
          blindDmgMul: ship.blindDmgMul ?? 0.3,
          // 必中光束不消费命中（恒 1）；掷命中（动能/爆炸 + 能量 spit）走命中率
          hitRate: isBeam ? 1 : (u.slot.hitRate ?? ship.hitRate),
          // 远端威力衰减：条目覆写 ?? 舰级（2026-09-12 加，与 `hitRate` 同款；**缺省 = 舰级值 ⇒ 零行为变化**）
          falloff: u.slot.falloff ?? ship.falloff,
          reloadMs: ship.reloadMs,
        },
        ...droneWeapons, // 机群：每架一条（同序 ⇒ 与 `foeDronePools[tag]` 逐架对齐）
      ],
      ...(droneWeapons.length > 0 ? { foeDrones: ship.drones } : {}),
      // **单次出击上限 / 备用机库**（2026-09-12 船长两条裁定）：只在挂了机群时下发；缺省不写 ⇒ 零变化
      ...(ship.droneLaunch && droneWeapons.length > 0
        ? { foeDroneLaunch: ship.droneLaunch }
        : {}),
      ...(ship.droneReserve && droneWeapons.length > 0
        ? { foeDroneReserve: ship.droneReserve }
        : {}),
      // **受击增程**（2026-09-11 船长）：只有挂了机群的舰级才可能写；缺省不写 ⇒ 零行为变化
      ...(ship.droneRangeMulOnHit !== undefined && droneWeapons.length > 0
        ? { foeDroneRangeMulOnHit: ship.droneRangeMulOnHit }
        : {}),
      // **受击增程（炮台）**（2026-09-12 船长：D 族静滞卫舰「挨打后射程增加 50%」，仅该型舰）：
      // 与机群那条无关（不需要机群），缺省不写 ⇒ 零行为变化
      ...(ship.gunRangeMulOnHit !== undefined ? { foeGunRangeMulOnHit: ship.gunRangeMulOnHit } : {}),
      // **舰种档**（2026-09-12 加）：敌舰近防炮的档系数用（`balance.pdTierMul`，越大的船防空越强）
      hullClassTier: ship.hullClassTier,
      foeTactic: tactic,
      // **自己的有效射程带**（含覆写）——供 `foeDesiredRange` 在舰级路径上替代全局战术表
      // （2026-09-11 船长裁决②「期望交距改取该单位自己的射程带」）。旧路径不写本字段。
      foeRangeBand: { min: rangeMin, max: rangeMax },
      // **期望距离覆写**（条目 > 舰级）：写了的卡/舰级直接钉住作战距离
      ...((u.slot.desireRangeM ?? ship.desireRangeM) !== undefined
        ? { foeDesireRangeM: u.slot.desireRangeM ?? ship.desireRangeM }
        : {}),
    }
  })
}

/* ═══════ 单波次内增援（2026-09-11 船长裁决：「先完成相应的系统机制，不使用。用作后续机制。」）═══════
 * **机制**：编成条目的 `enterAt` 给三种入场触发（第几秒 / 击毁几个 / 残血到多少）；
 * 带触发的单位**开战不进战场**，由 `advanceBattleFor` **每拍**检查、条件命中才 `seedUnit` 补入。
 *
 * **与「敌突进」同款形态**（船长 2026-09-10「暂时先取消实装，仅实现功能」的先例）：
 * 机制 / 参数 / 总开关 / 契约 / 用例全部就位，但**任何战斗都不触发**——总开关
 * `BattleBalance.foeReinforceEnabled` 默认 `false`，且契约在关闭期间**禁止任何卡写 `enterAt`**。
 *
 * **存档零迁移**：不新增任何存档字段——"某个单位是否已入场"**由 `battle.units` 里有没有它的 tag 反推**
 * （`seedUnit` 对已存在的 tag 不覆盖，尸体也留着，故"在场过"永远是"存在"）。
 * 读档续战时 `advanceBattleFor` 用同一份 `curFoes` 重新推导，未入场者继续等条件命中。
 *
 * **仅舰级路径**：`enterAt` 长在 `FoeShipSlot` 上，旧威胁推导路径（未写 `ships` 的卡）天然不涉及。
 *
 * ⚠ **与多舰补偿系数 `2N/(N+1)` 不可叠加**（两条路：结构解法 vs 数值补偿）——见设计稿
 * `docs/design/foe-reinforce-20260911.md`。
 */

/** 规范化增援触发条件：只保留**有效**条件（`sec > 0` / `afterKills > 0` / `0 ≤ hpBelow ≤ 1`）；
 *  **一个有效条件都没有 → 返回 null = 按"未写"处理 = 开战即在**（刻意不产生"永不入场"的沉默副作用）。 */
function normReinforceTrigger(at?: FoeReinforceTrigger): FoeReinforceTrigger | null {
  if (!at) return null
  const out: FoeReinforceTrigger = {}
  if (typeof at.sec === 'number' && Number.isFinite(at.sec) && at.sec > 0) out.sec = at.sec
  if (typeof at.afterKills === 'number' && Number.isFinite(at.afterKills) && at.afterKills > 0) {
    out.afterKills = Math.floor(at.afterKills)
  }
  if (typeof at.hpBelow === 'number' && at.hpBelow >= 0 && at.hpBelow <= 1) out.hpBelow = at.hpBelow
  return Object.keys(out).length > 0 ? out : null
}

/** 本波编成（`curFoes` 全部条目）的**存活剩余总血比例**：分子 = 在场且未全灭的单位的剩余三层血之和，
 *  分母 = 本波编成的**满血总量**（含尚未入场的增援——"残部呼救"要按编制总量看，不是按在场量看）。 */
function foeResidualHpFrac(b: import('./state').BattleState, curFoes: readonly UnitSpec[]): number {
  let max = 0
  let cur = 0
  for (const f of curFoes) {
    max += f.hp.s + f.hp.a + f.hp.h
    const u = b.units[f.tag]
    if (u) cur += u.hp.s + u.hp.a + u.hp.h
  }
  return max > 0 ? Math.max(0, cur) / max : 0
}

/** 本场**已击毁的敌方单位数**（三层血全归零即计；尸体留在 `battle.units` 里，故可直接数）。 */
function foeKillCount(b: import('./state').BattleState): number {
  let n = 0
  for (const tag of Object.keys(b.units)) {
    const u = b.units[tag]!
    if (u.side !== 'foe') continue
    if (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0) n += 1
  }
  return n
}

/** 入场触发判定：**任一条件满足即入场**（未写/无效的条件不参与）。
 *  `sec` 走**战斗时钟**（`lastTickGameMs − startedAtGameMs`，与推进器相位同口径、波次演出窗口不计时）。 */
function reinforceTriggered(
  at: FoeReinforceTrigger,
  b: import('./state').BattleState,
  curFoes: readonly UnitSpec[],
): boolean {
  if (at.sec !== undefined && b.lastTickGameMs - b.startedAtGameMs >= at.sec * 1000) return true
  if (at.afterKills !== undefined && foeKillCount(b) >= at.afterKills) return true
  if (at.hpBelow !== undefined && foeResidualHpFrac(b, curFoes) <= at.hpBelow) return true
  return false
}

/**
 * **每拍结算增援入场**（`advanceBattleFor` 主循环内、`stepBattle` **之前**调用——保证"上一拍刚打死的
 * 单位"本拍就能触发援军，且判胜检查看到的是补入后的编队）。
 * - 总开关关闭 → 直接返回（**零行为变化**：此时建档期也根本没写过 `foeReinforceAt`）；
 * - 已入场判定 = `battle.units` 里已有该 tag（含尸体）→ 不重复补入、不需要任何存档字段；
 * - 入场单位走 `enterReload` —— 与波次转场同款"一段自然哑火窗口"（≈一次装填时长）；
 * - 距离重开：`bal.foeReinforceReopenFrac`（语义同 `waveReopenFrac`；缺省 0 = 原地入场）。
 */
function resolveReinforcements(
  state: GameState,
  ctx: SimContext,
  b: import('./state').BattleState,
  anomaly: AnomalyDef,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  openM: number,
): void {
  if (bal.foeReinforceEnabled !== true) return
  const arrived: UnitSpec[] = []
  let arriveIdx = 0
  for (const spec of curFoes) {
    if (b.units[spec.tag]) continue // 已入场（含已阵亡的尸体）
    const at = spec.foeReinforceAt
    if (!at) continue // 开战即在的常规单位（未写 enterAt）
    if (!reinforceTriggered(at, b, curFoes)) continue
    // 入场窗口与界面动画同源（船长 2026-09-14「动画没结束不开火」）：逐舰错峰；
    // 时刻取**全局时钟**（`state.gameMs`）——与转场那一处同理由（战斗时钟可能落后于全局时钟）
    seedUnit(b, spec, {
      enterReload: true,
      arrivedAtMs: state.gameMs + arriveIdx * BATTLE_ARRIVAL_STAGGER_MS,
    })
    arriveIdx += 1
    arrived.push(spec)
  }
  if (arrived.length === 0) return
  // 距离重开（2026-09-11 船长口径：沿用 waveReopenFrac 语义，缺省 0 = 不重开）
  const reopen = bal.foeReinforceReopenFrac ?? 0
  if (reopen > 0 && Number.isFinite(openM)) {
    b.distanceM = Math.round(openM * reopen + b.distanceM * (1 - reopen))
  }
  // 近防炮调度补位（与波次转场同款：pdCd 与敌编队同序——增援本身就占着 curFoes 里的位置，
  // 故只需要把它的倒计时置成"下一拍判定"，不必重排整个数组）
  if (b.pdCd && b.dronePools) {
    for (const spec of arrived) {
      const i = curFoes.indexOf(spec)
      if (i >= 0 && i < b.pdCd.length) b.pdCd[i] = Math.max(100, Math.round(bal.pdJudgementMs))
    }
  }
  const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
  const names = [...new Set(arrived.map((s) => s.name))].join('、')
  addLog(
    state,
    'warn',
    `⚔ 敌方增援自远处入场（${waveName ? waveName + "·" : ""}${anomaly.name}）：${names} ×${arrived.length} 加入战斗` +
      `${reopen > 0 ? "，重新接近中。" : "。"}`,
  )
}

export function createFoeSpecs(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts = {}): UnitSpec[] {
  // 2026-09-11 舰级路径（船长定案「敌舰配置表」）：写了 ships 的卡按**舰级绝对值**建档；
  // 未写的卡走下面的旧"威胁推导"路径，行为逐字不变（试点只转 A 族 6 张）。
  if (anomaly.ships && anomaly.ships.length > 0) return createFoeSpecsFromShips(anomaly, bal, opts)
  const tactic = anomaly.tactic ?? 'orbit'
  const split = PROFILE_SPLIT[anomaly.defProfile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
  const escorts = Math.max(0, Math.min(2, anomaly.escorts ?? 0))
  const waveUnits = Math.max(1, Math.floor(opts.units ?? 1))
  const hpShare = opts.hpShare ?? 1
  const prefix = opts.tagPrefix ?? ''
  const mainThreat = anomaly.threat / (1 + 0.6 * escorts)
  const mainType = pickTopType(anomaly.dmgMix)
  // C4-#3：射程 = 基础带 ×(1 + 侧重×((T−10)/90)) → 封顶（clamp 保持 min < max）
  const rangeBase = TACTIC_RANGE[tactic]!
  const growMul = bal.foeRangeGrowMul[tactic] ?? 0.7
  const growT = Math.min(1, Math.max(0, (anomaly.threat - 10) / 90))
  const cap = bal.foeRangeCapM ?? 15_000
  const rangeMax = Math.min(cap, Math.round(rangeBase.max * (1 + growMul * growT)))
  const rangeMin = Math.max(1, Math.min(rangeMax - 1, Math.round(rangeBase.min * (1 + growMul * growT))))
  // C4-#3：速度 = 参考船速(段) × m_base(threat) × tactic 系数 → cap（≤参考 ×foeSpeedCapMul）
  const refSpeed = foeRefSpeedMps(anomaly.threat, bal)
  const spdCap = Math.round(refSpeed * (bal.foeSpeedCapMul ?? 1.2))
  const tacticSpd = bal.foeSpeedTacticMul[tactic] ?? 1
  const foeSpeed = anomaly.foeSpeedMps ?? Math.min(spdCap, Math.round(refSpeed * foeSpeedBase(anomaly.threat, bal) * tacticSpd))

  const make = (tag: string, name: string, uThreat: number, type: DamageType): UnitSpec => {
    // C4：总血 = 时长曲线反推表值（P1：单卡 foeHpOverride 优先 = 独立标定，脱离曲线）；
    // 多波（2026-09-09）：本波分得 总血 × hpShare，波内按威胁份额分配（主体/僚机 = uThreat/T × 波血）
    const baseHp = (anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)) * hpShare
    const unitHp = (baseHp * uThreat) / Math.max(1, anomaly.threat)
    const totalHp = unitHp
    const hp: Hp3 = { s: totalHp * split.s, a: totalHp * split.a, h: totalHp * split.h }
    const dps = uThreat * bal.foeDpsPerThreat
    // 2026-09-08（船长定：能量=光束必中；动能/爆炸普遍高命中 0.85 + 逐卡低命中特例）：
    // 非能量单发 = DPS×装填 ÷ 有效命中 × foeHitCompMul（回避>0 期望上升的等效补偿，方案 A）；
    // 能量 effHit=1 不消费补偿。
    // ⚠ 2026-09-11 船长裁决「先移除所有逐卡伤害倍率，按照实际算」：原"逐卡等效回退倍率口"
    // （2026-09-08 为能量光束必中化引入）**已退休、字段已从类型上删除**——单发一律按本链
    // **实际推导值**算，不再有等效回退旋钮；要逐卡点名伤害走下面的 `foeShotDmg` 直写。
    const effHit = type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate
    // 2026-09-10 船长：**基础单发可直接写死**（`foeShotDmg`）——短路"威胁份额 × foeDpsPerThreat × 装填 × 补偿"
    // 这条推导链，用于需要逐卡点名基础伤害的卡（首例 = 深渊之门卫队：推得 90 → 直接定 45）。
    const shotDmg =
      anomaly.foeShotDmg ??
      Math.max(
        1,
        Math.round(((dps * bal.foeReloadMs) / 1000) * (effHit < 1 ? bal.foeHitCompMul / effHit : 1)),
      )
    // 2026-09-10 船长（窝点混伤）：按火力构成拆成逐系单发（Σ = 总单发，敌总伤不变）。
    // 纯系卡只有一条 → 与旧行为完全一致；混伤卡 = 主 60% / 副 40% 两键。
    const shotSplit = splitShotByComposition(shotDmg, foeDamageComposition(anomaly))
    const multiShots: Partial<Record<DamageType, number>> | undefined =
      shotSplit.length > 1
        ? shotSplit.reduce<Partial<Record<DamageType, number>>>((acc, r) => {
            acc[r.type] = (acc[r.type] ?? 0) + r.dmg
            return acc
          }, {})
        : undefined
    return {
      tag,
      name,
      side: 'foe',
      hp,
      resists: {},
      evasion: 0.12,
      hitBonus: 0,
      signatureM: Math.max(45, Math.round(60 + totalHp * 0.5)),
      scanResMm: 450,
      speedMps: foeSpeed, // C4-#3 虚拟装配推导（整编队同速；anomaly.foeSpeedMps 覆盖优先）
      agility: 0.3,
      // 高威胁近战敌突进（2026-09-10 船长定）：威胁 ≥ 门槛 且 战术 = brawl 才有资格；
      // ⚠ 船长同日追加：**暂时先取消实装，仅实现功能** → 受 foeChargeEnabled 总开关（默认 false）约束，
      //   开关关闭时不会有任何敌人拿到资格，机制整套保留待启用。
      ...(bal.foeChargeEnabled === true &&
      anomaly.threat >= bal.foeChargeThreatFloor &&
      (anomaly.tactic ?? 'orbit') === 'brawl'
        ? { foeCanCharge: true }
        : {}),
      weapons: [
        {
          label: `${name} 武器组`,
          // 2026-09-08（船长定）：能量（plasma）= 光束必中（开火即中、无视回避），
          // **近盲带保留**（带内威力 ×blindDmgMul）；动能/爆炸 = fixed 命中模型 + 逐卡命中率
          kind: type === 'plasma' ? 'beam' : 'fixed',
          fixedType: type, // 形态/命中/近盲/表现层配色一律按**主系**（混伤只改伤害构成）
          shotDmg,
          // 混伤：逐系单发（真实结算与胜率预估都读它；纯系卡为 undefined）
          ...(multiShots ? { shotsByType: multiShots } : {}),
          maxRangeM: rangeMax,
          minRangeM: rangeMin,
          // V18B：敌人近盲带伤害比例（船长 2026-09-05：与玩家区分——近盲带内不停火、伤害打折）
          blindDmgMul: anomaly.blindDmgMul ?? 0.3,
          hitRate: type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate,
          falloff: anomaly.foeFalloff ?? bal.foeFalloff,
          reloadMs: bal.foeReloadMs,
        },
      ],
      foeTactic: tactic,
    }
  }
  const specs: UnitSpec[] = []
  for (let k = 0; k < waveUnits; k++) {
    // tag 唯一性（2026-09-09 多波修复）：仅首波第一小队沿用旧命名（foe-0 主 / foe-1.. 僚，
    // 兼容旧 UI/测试的"主+僚"假想）；其余小队（同波第 2 队起）与后续波统一 w{波}-foe-{队} 前缀，
    // 避免与 legacy 僚机 tag（foe-1..n）撞名造成单位覆盖/血条参照错位。
    const legacySquad = prefix === '' && k === 0
    const squadPrefix = legacySquad ? '' : `${prefix === "" ? "w0-" : prefix}`
    const mainTag = legacySquad ? 'foe-0' : `${squadPrefix}foe-${k}`
    specs.push(make(mainTag, foeUnitNameOf(anomaly, mainTag), mainThreat, mainType))
    for (let i = 1; i <= escorts; i++) {
      const escortTag = legacySquad ? `foe-${i}` : `${squadPrefix}foe-${k}-e${i}`
      specs.push(make(escortTag, foeUnitNameOf(anomaly, escortTag), mainThreat * 0.6, mainType))
    }
  }
  return specs
}

/** 主系（权重最高；未写/空 = 动能）——**正权重键才参战**（2026-09-10 语义变更：旧"缺省键权重 1"作废） */
function pickTopType(mix: Partial<Record<DamageType, number>> | undefined): DamageType {
  let best: DamageType = 'kinetic'
  let bestW = 0
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const w = mix?.[t] ?? 0
    if (w > bestW) {
      bestW = w
      best = t
    }
  }
  return best
}

/** 开战距离 = 双方最大射程 ×factor + 缓冲；缓冲 = max(固定 100m, 最大射程×10%)（船长 2026-09-05：
 * 远程武器不再 100m 即接战，按射程比例拉开，保证开场有可见的接近窗口） */
export function battleOpenM(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) for (const w of f.weapons) top = Math.max(top, w.maxRangeM)
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.round(top * bal.openRangeFactor + pad)
}

/** **玩家主武器（战术距离口径；船长 2026-09-12 裁定「甲」）** = **射程最远的武器**；
 *  并列射程时取**名义火力大的**（再并列保持武器表顺序）。**三按钮（贴脸/中距/风筝）、出发前战术、
 *  战斗界面「我方射程带」共用这一处**。
 *
 *  为什么改（玩家报障「战斗界面下方的快速选择贴脸/中距/风筝，现在的距离不正确」）：
 *  旧口径 `weapons.find(w => w.kind === 'gun') ?? weapons[0]` 有两处系统性取错——
 *  **激光是 `beam`、基础舰炮是 `fixed`，都不算 `gun`** ⇒ 纯激光/无人机船回落到恒在的「基础舰炮」(2,500m)；
 *  **近防炮是 `gun`（2,500m）** ⇒ 装了它的船一律被 PD 抢位。实测（真数据真引擎）：
 *  激光船（主武器 4,600m）三按钮 **200/1250/2375 → 200/2300/4370**、
 *  近防炮 + 导弹架 MK2（11,760m）**200/1251/2375 → 540/6330/11172**；
 *  炮台船与纯导弹船一字不变（旧口径恰好取对）；战斗界面「我方射程带」随之从
 *  「基础舰炮 0~2500」/「近防炮 1~2500」修正为真实主武器射程带。 */
export function mainWeaponOf(me: UnitSpec): WeaponSpec | undefined {
  let best: WeaponSpec | undefined
  let bestDps = -1
  for (const w of me.weapons) {
    if (best === undefined || w.maxRangeM > best.maxRangeM) {
      best = w
      bestDps = nominalWeaponDps(w)
    } else if (w.maxRangeM === best.maxRangeM) {
      const d = nominalWeaponDps(w)
      if (d > bestDps) {
        best = w
        bestDps = d
      }
    }
  }
  return best
}

/** 名义单发/秒（并列射程时的取舍依据；与装配页 `rawDpsOf` 同口径）：
 *  炮台取首弹种单发、其余取 `shotDmg`，乘门数除以装填秒。 */
function nominalWeaponDps(w: WeaponSpec): number {
  const per = w.kind === 'gun' ? (Object.values(w.shotsByType ?? {})[0] ?? 0) : (w.shotDmg ?? 0)
  return (per * (w.count ?? 1)) / Math.max(0.1, w.reloadMs / 1000)
}

/** 玩家战术期望距离（贴脸/中距/风筝）。
 * "主武器" = **射程最远的武器**（见 `mainWeaponOf`）。
 *
 * ⚠ **中距档 = 射程带内可传参的位置**（2026-09-15 船长裁定）：`midPos` 缺省 = **洞内口径 0.5（中点）**，
 * **星图战斗在调用处显式传 `bal.desireBandStarMap`（0.8 = 射程带高位）**——起因＝玩家报
 * 「赏金任务一开始就在近距离、对远程武器不利」：开战那一瞬其实是最远的（16,368 m），
 * 真正"近"的是稳态期望（中点 = 射程的 54%），战斗 ~30 秒后必然收拢到那里。
 * 贴脸 / 风筝两档是固定位置，不受 `midPos` 影响。 */
export function desiredRangeFor(
  me: UnitSpec,
  tactic: 'assault' | 'mid' | 'kite',
  bal: BattleBalance,
  midPos = bal.desireBandWormhole,
): number {
  const main = mainWeaponOf(me) ?? me.weapons[0]
  const mainMin = main ? main.minRangeM : 0
  const mainMax = main ? main.maxRangeM : 0
  if (tactic === 'assault') return Math.max(bal.minDistanceM, Math.round(mainMin * 0.6))
  if (tactic === 'kite') return Math.max(bal.minDistanceM + 1, Math.round(mainMax * 0.95))
  // mid：有效射程带内的位置（缺省中点；钳到 0~1 免得数据写坏时飞出射程带）
  const pos = Math.min(1, Math.max(0, midPos))
  return Math.max(bal.minDistanceM, Math.round(mainMin + (mainMax - mainMin) * pos))
}

/**
 * 敌方编队期望交战距离。
 *
 * **2026-09-11 船长裁决②（本函数的口径修正）**：**战术只决定"带内的偏好位置"，带由单位自己决定**。
 * - **舰级路径**（写了 `AnomalyDef.ships` 的卡）：带 = **该单位自己的有效射程带**
 *   （`foeRangeBand`，含条目 `rangeMul`/`rangeMinM`/`rangeMaxM` 覆写后的绝对值）。
 * - **旧威胁推导路径**：带 = 全局战术表 `TACTIC_RANGE[战术]`——**一字不动**
 *   （旧路径的"射程带与期望交距同源"本来是自洽的，故不修）。
 *
 * **动机（实测）**：旧口径把带写死成旧表的绝对区间，于是"敌人想站的位置"与"敌人打得到的距离"脱钩：
 * 快艇（1~1883m）被要求站 440m 还凑合，但狙击舰（1255~9619m）按 kite 站 8000m、按 orbit 站 2688m
 * 都可能**站在自己射程之外**；反过来慢速玩家追不上 → 双方都够不着 → 打满 600s 判负
 * （演习场/新港裸船实测；见 `docs/design/p0-foe-desired-range-20260911.md`）。
 *
 * **与旧口径的可比映射**（同一张 `tacticDesireFactor`，只把带换成"自己的带"）：
 * 期望交距 = `自己带.min + factor[战术] × (自己带.max − 自己带.min)`，
 * 其中 factor 沿用旧口径的**相对位置**语义（brawl 0.20 靠带内近端 / orbit 0.55 居中 / kite 0.85 贴远端）。
 * 取值依据 = **保持"带内相对位置"这一层语义不变**，只让"带"随舰级伸缩（船长口径：
 * 「射程和战术仅仅的弱相关，并不实时强绑定」）。A 族实测差异举例：
 * 快艇 440 → **377m**、护卫舰 2688 → **2498m**、狙击舰 8000 → **8364/8885/10102m**、
 * B 小艇 2688 → **1210m**（后者正是"教学卡敌人一炮未放/双方锁死"的解）。
 *
 * **混编卡取哪一个单位**：取 `foes[0]`（卡上**首个主体单位**，与既有"战术取自 foes[0]"一致）。
 * 需要让头目站得与杂鱼一致（或不同）时，用条目 `rangeMinM`/`rangeMaxM` 覆写（"同卡同带"，
 * A 族四张 kite 卡已用此旋钮把 60% 的头目火力救回来）——**不引入加权平均**（避免"谁都不到位的中间值"）。
 */
export function foeDesiredRange(
  _me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
): number {
  // **期望距离覆写优先**（船长 2026-09-11 E 族：「战术调整、期望距离不改」）
  const pinned = foes[0]?.foeDesireRangeM
  if (pinned !== undefined && Number.isFinite(pinned))
    return Math.max(bal.minDistanceM, Math.round(pinned))
  const tactic = foes[0]?.foeTactic ?? 'orbit';
  // 舰级路径：带 = 自己的有效射程带；旧路径：带 = 全局战术表（原样）
  const band = foes[0]?.foeRangeBand ?? TACTIC_RANGE[tactic]!
  const pos = clamp(0.05, 0.95, bal.tacticDesireFactor[tactic] ?? 0.5)
  return Math.max(bal.minDistanceM, Math.round(band.min + pos * (band.max - band.min)))
}

/* ═══════════ 弹药 ═══════════ */

/**
 * 预载需求（V18B-2 per-gun 多键）：按每种耗弹武器键分别估量
 * （该键武器中取最快装填：时间上限 ÷ reload × 余量）。
 */
export function ammoLoadTotals(
  me: UnitSpec,
  bal: BattleBalance,
  state: import('./state').GameState,
): Partial<Record<DamageType, number>> {
  // 弹药集约学（ammunition-condensing，批次四）：出发预载弹药 +8%/级（实际装载仍受库存上限约束）
  const condLv = Math.min(5, state.skills.trained['ammunition-condensing'] ?? 0)
  const condFactor = 1 + 0.08 * condLv
  const out: Partial<Record<DamageType, number>> = {}
  /** 一轮齐射的用弹量 = 条目门数（同型合并条目 ×N）× 每次耗弹数（缺省 1）；2026-09-11 修复：预载按门数放大 */
  const roundsPerVolley = (w: WeaponSpec): number =>
    Math.max(1, w.count ?? 1) * Math.max(1, w.ammoPerShot ?? 1)
  const addFor = (t: DamageType, reloadMs: number, volley: number): void => {
    const volleys = Math.max(1, Math.ceil(((bal.ammoTimeCapMs * condFactor) / Math.max(100, reloadMs)) * bal.ammoMargin))
    out[t] = (out[t] ?? 0) + volleys * volley
  }
  for (const w of me.weapons) {
    if (w.kind === 'gun') {
      const t = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
      if (t) addFor(t, w.reloadMs, roundsPerVolley(w))
    } else if (w.kind === 'beam') {
      addFor('plasma', w.reloadMs, roundsPerVolley(w))
    }
  }
  return out
}

/**
 * V17.2 单型装载：只装载炮台固定弹种的那一型（炮族制——炮台 damageType 决定弹种，
 * battle.ammo 其余键恒 0；开火/退还/UI dominant 仍走既有三键结构，无需第二套）。
 * 货仓优先、仓库兜底；返回实装各型数量（只有目标型非零）。
 * （基础弹装载：旧语义保留，测试/兼容用；开战装载请走 loadAmmoTier 按档装载）
 */
export function loadAmmo(state: GameState, ctx: SimContext, type: DamageType, total: number): { kin: number; exp: number; pla: number } {
  const out = { kin: 0, exp: 0, pla: 0 }
  const key = ammoKeyOf(type)
  out[key] = loadAmmoOf(state, ctx, AMMO_IDS[type], total)
  return out
}

/** 装载指定弹 id（货仓优先、仓库兜底，单型一次抽足）；返回实装数 */
function loadAmmoOf(state: GameState, ctx: SimContext, id: string, total: number): number {
  if (total <= 0) return 0
  const stock = Math.floor((cargoItemsOf(state)[id] ?? 0) + countWare(state, id))
  if (stock <= 0) return 0
  let want = Math.min(stock, total)
  let got = 0
  const fromCargo = Math.min(want, Math.floor(cargoItemsOf(state)[id] ?? 0))
  if (fromCargo > 0) {
    removeItem(state, id, fromCargo)
    want -= fromCargo
    got += fromCargo
  }
  if (want > 0) {
    const fromWare = Math.min(want, countWare(state, id))
    if (fromWare > 0) {
      removeWare(state, id, fromWare)
      want -= fromWare
      got += fromWare
    }
  }
  return got
}

/**
 * 开战按档装载（弹药 MK2，2026-09-09 船长拍板：出战前选档——船装配 ammoPref 决定本场弹种；
 * 该档库存不足 → 整族回退基础弹（fellBack = true，由调用方日志提示），不卡远征）。
 * 返回实装数 + 实装弹 id（写 battle.ammoIds 供推进/退还/视图对齐）。
 */
export function loadAmmoTier(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  type: DamageType,
  total: number,
): { loaded: number; id: string; fellBack: boolean } {
  const prefId = state.fleet[shipId]?.ammoPref?.[type]
  const wantId = prefId && ctx.items.has(prefId) ? prefId : null
  let id = AMMO_IDS[type]
  let fellBack = false
  if (wantId !== null) {
    const have = Math.floor((cargoItemsOf(state)[wantId] ?? 0) + countWare(state, wantId))
    if (have >= total) id = wantId
    else fellBack = true // 配置档不足整批 → 整族回退基础弹
  }
  const loaded = loadAmmoOf(state, ctx, id, total)
  return { loaded, id, fellBack }
}

/** 剩余弹药退回物品仓库（弹药 MK2：按实装弹 id 原样退回；ids 缺省 = 基础弹语义） */
export function refundAmmo(
  state: GameState,
  ammo: { kin: number; exp: number; pla: number },
  ids?: Partial<Record<DamageType, string>> | null,
): void {
  const map: Array<[DamageType, number]> = [
    ['kinetic', ammo.kin],
    ['explosive', ammo.exp],
    ['plasma', ammo.pla],
  ]
  for (const [t, n] of map) {
    if (n > 0) addWare(state, ids?.[t] ?? AMMO_IDS[t], Math.floor(n))
  }
}

/** 开火弹型 = 剩余最多（平局 kin→exp→pla）；全空 null */
export function nextAmmoType(ammo: { kin: number; exp: number; pla: number }): DamageType | null {
  let best: DamageType | null = null
  let bestN = 0
  const order: Array<DamageType> = ['kinetic', 'explosive', 'plasma']
  for (const t of order) {
    const n = ammo[ammoKeyOf(t)]
    if (n > bestN) {
      bestN = n
      best = t
    }
  }
  return best
}

/** ammo 计数对象键 → DamageType 的映射辅助 */
export type AmmoKey = 'kin' | 'exp' | 'pla'
export function ammoKeyOf(t: DamageType): AmmoKey {
  return t === 'kinetic' ? 'kin' : t === 'explosive' ? 'exp' : 'pla'
}

/* ═══════════ 2026-09-09 船体维修装置（战斗中自动修复装甲/结构） ═══════════ */
/* 船长定稿：中槽支援件；每 5 秒一跳，逐台修复装甲/结构（各层满则额度转投另一层），
 * 每台每跳消耗 1 枚对应修理组件；组件耗尽自动停机；与弹药预载同哲学——开战装载、结束退还。 */

/** 当前船已装配的维修装置（带 repairArmorHp/repairHullHp 的装配件，按位序） */
export function fittedRepairModules(state: GameState, ctx: SimContext, shipId: string): ModuleDef[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  return allFittedModules(ship.fitted, ctx).filter((d) => (d.repairArmorHp ?? 0) > 0 || (d.repairHullHp ?? 0) > 0)
}

/**
 * 维修装置开战预载：装配快照 + 组件装载（货舱优先、仓库兜底，单型一次抽足）。
 * 每台预载上限 = 整场最长战斗时间能跳的脉冲数 + 1（多波演出窗口冻结战斗时钟，余量防不足）；
 * 库存不足的装置直接标记停机（组件一枚没有 = 开战即停）。无装置返回 null。
 * 返回结构的 nextPulseAtMs 恒为 undefined——由 startBattleFor 按开战时刻赋值
 * （全部装置停机则保持 undefined = 不调度）。
 */
export function preloadRepairFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  maxBattleMs: number,
): import('./state').BattleState['repair'] | null {
  const defs = fittedRepairModules(state, ctx, shipId)
  if (defs.length === 0) return null
  const units: import('./state').BattleRepairUnit[] = []
  const need = new Map<string, number>()
  const perUnit = Math.max(1, Math.ceil(maxBattleMs / REPAIR_PULSE_MS)) + 1
  // 舰体快修学（2026-09-13 船长「船体维修装置修改为也吃舰体快修学」）：与**直接使用修理组件**
  // 共用同一处系数（`repair.quickRepairFactor`，技能 id 与每级加成走 `balance.repair`）
  const quickRepair = quickRepairFactor(state, ctx)
  // 无消耗自愈件（2026-09-10 船长：异形生体件）——修复量在**同型多件间按 EVE 曲线收敛**
  // （权重 100%/87%/57%/28%/11%，与"命中/速度"同类；不吃组件故必须收敛，否则叠装失控）
  const freeSeen = new Map<string, number>()
  for (const d of defs) {
    const isFree = d.repairFree === true
    let w = 1
    if (isFree) {
      const n = (freeSeen.get(d.id) ?? 0) + 1
      freeSeen.set(d.id, n)
      w = stackWeight(n)
    }
    if (isFree) {
      units.push({
        moduleId: d.id,
        kitId: '',
        free: true,
        armorPerPulse: Math.max(0, Math.round((d.repairArmorHp ?? 0) * w)),
        hullPerPulse: Math.max(0, Math.round((d.repairHullHp ?? 0) * w)),
        stopped: false,
      })
      continue
    }
    const kitId = d.repairKit ?? 'repairkit-civ'
    // 舰体快修学（2026-09-13 船长「船体维修装置修改为也吃舰体快修学」）：与**直接使用修理组件**
    // 共用同一处系数（`shipyard.quickRepairFactor`，技能 id 与每级加成走 `balance.repair`）——
    // 开战预载时按**开战那一刻的技能**折算成每跳值（与"装配快照 + 组件预载"同一份快照语义）。
    units.push({
      moduleId: d.id,
      kitId,
      armorPerPulse: Math.max(0, Math.round((d.repairArmorHp ?? 0) * quickRepair)),
      hullPerPulse: Math.max(0, Math.round((d.repairHullHp ?? 0) * quickRepair)),
      stopped: false,
    })
    need.set(kitId, (need.get(kitId) ?? 0) + perUnit)
  }
  // 装载（与 loadAmmo 同序：货舱优先、仓库兜底）
  const kits: Record<string, number> = {}
  for (const [kitId, wantTotal] of need) {
    let want = wantTotal
    const inCargo = Math.floor(cargoItemsOf(state)[kitId] ?? 0)
    const fromCargo = Math.min(want, inCargo)
    if (fromCargo > 0) {
      removeItem(state, kitId, fromCargo)
      want -= fromCargo
    }
    if (want > 0) {
      const fromWare = Math.min(want, countWare(state, kitId))
      if (fromWare > 0) {
        removeWare(state, kitId, fromWare)
        want -= fromWare
      }
    }
    const got = wantTotal - want
    if (got > 0) kits[kitId] = got
  }
  // 一枚组件都没装到的装置 → 开战即停机（脉冲逻辑跳过；缺料提示由 startBattleFor 日志给出）
  // 无消耗自愈件不参与组件检查（永不因缺料停机）
  for (const u of units) {
    if (u.free) continue
    if ((kits[u.kitId] ?? 0) <= 0) u.stopped = true
  }
  return { units, kits, nextPulseAtMs: undefined, pulses: 0, kitsUsed: 0 }
}

/** 退还维修装置预载的未用组件（回仓库；与弹药退还同哲学）——战斗结束/撤退收场调用；幂等 */
export function refundRepairKits(
  state: GameState,
  repair: import('./state').BattleState['repair'],
): void {
  if (!repair || !repair.kits || Object.isFrozen(repair.kits)) return
  for (const [id, n] of Object.entries(repair.kits)) {
    if (n > 0) addWare(state, id, Math.floor(n))
  }
  repair.kits = {}
}

/**
 * **战后总结里的"修理组件消耗"文案**（2026-09-11 船长：「船体修理装置不单独显示日志。
 * 只将消耗组件数量显示到战后总结」）：本场一枚没耗 = `''`（战报不添尾巴），否则形如
 * `消耗 军用修理组件 ×12`（多型按「、」连接）。战报四处（远征胜/败、遭遇战、AI 副船）共用本函数。
 */
export function repairUsageText(
  battle: { repair?: import('./state').BattleState['repair'] } | null | undefined,
  ctx: SimContext,
): string {
  const r = battle?.repair
  if (!r || (r.kitsUsed ?? 0) <= 0) return ''
  const byType = r.kitsUsedByType ?? {}
  const parts = Object.entries(byType)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} ×${n.toLocaleString('zh-CN')}`)
  if (parts.length === 0) return `消耗修理组件 ×${r.kitsUsed.toLocaleString('zh-CN')}`
  return `消耗 ${parts.join('、')}`
}

/**
 * **护盾充能装置的脉冲间隔**（2026-09-14 船长：「护盾充能装置，和船体修理装置类似。
 *  **每 30 秒**恢复自身护盾最大值一定比例的护盾量。CPU消耗较多」）。
 *
 * 与 `REPAIR_PULSE_MS`（维修装置 5 秒）是**两套独立计时**：两者可以同装、各按各的节奏跳。
 * ⚠ 界面/说明里的「每 30 秒」与它同源（`content:check` 的「产物说明契约」按语境常量核）。
 */
export const SHIELD_PULSE_MS = 30_000

/** 装配里「护盾充能装置」的**每跳合计比例**（满盾的几分之几；同型多件按 EVE 曲线收敛，无装置 = 0） */
export function shieldPulsePctOf(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = state.fleet[shipId]
  if (!ship) return 0
  const seen = new Map<string, number>()
  let total = 0
  for (const d of allFittedModules(ship.fitted, ctx)) {
    const pct = d.shieldPulsePct ?? 0
    if (pct <= 0) continue
    // 无消耗件（本件不吃组件）⇒ 同型多件必须收敛，否则叠装失控（与 `repairFree` 生体件同口径）
    const n = (seen.get(d.id) ?? 0) + 1
    seen.set(d.id, n)
    total += pct * stackWeight(n)
  }
  return total
}

/**
 * 护盾充能装置开战快照：每跳合计比例 + 首跳时刻（`startBattleFor` 按开战时刻赋值）。
 * 无装置返回 `null`（零行为变化：不写 `battle.shieldCharge`）。
 */
export function preloadShieldChargeFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): import('./state').BattleState['shieldCharge'] | null {
  const pctPerPulse = shieldPulsePctOf(state, ctx, shipId)
  if (pctPerPulse <= 0) return null
  // `nextPulseAtMs` 恒为 undefined——由 `startBattleFor` 按开战时刻赋值（与维修装置同款）
  return { pctPerPulse, nextPulseAtMs: undefined, pulses: 0 }
}

/**
 * **单次护盾充能脉冲**：按**满盾 × 每跳比例**把主控的护盾层补回去（夹在满盾。
 * ⚠ 与维修装置同口径：**只作用于主控**——僚舰的充能装置不参战，见 D 批边界）。
 *
 * 它是**破盾后唯一的回头路**：被动回充按当前盾比例（盾 0 = 回充 0），只有这里能从 0 把盾点起来；
 * 点着之后被动回充立刻接管（指数增长）。
 */
export function pulseShieldCharge(
  b: import('./state').BattleState,
  me: UnitSpec,
): void {
  const sc = b.shieldCharge
  const meRt = b.units['player']
  if (!sc || !meRt || sc.nextPulseAtMs === undefined) return
  if (!isAlive(b, 'player')) return
  const capS = Math.max(0, me.hp.s)
  if (capS <= 0) return
  const gain = capS * Math.max(0, sc.pctPerPulse)
  if (gain > 0) meRt.hp.s = Math.min(capS, meRt.hp.s + gain)
}

/**
 * 单次维修脉冲（advanceBattleFor 在到期脉冲处调用）：
 * 逐台未停机装置修复——每层通道修复量 = 该层额度，某层已满（或补满）后，该层剩余额度
 * 转投另一层（单跳修复上限 = 甲 + 结构额度之和，痊愈后不再消耗）；每台实际修复 > 0 才扣
 * 1 枚对应组件并计入消耗；组件耗尽该台停机（日志一次）。修复上限 = 出场满值口径
 * （advanceBattleFor 重建的 me，与保险检查同源——可把入场残值修回满血）。
 */
function pulseRepairs(
  state: GameState,
  ctx: SimContext,
  b: import('./state').BattleState,
  me: UnitSpec,
): void {
  const r = b.repair
  const meRt = b.units['player']
  if (!r || !meRt || r.nextPulseAtMs === undefined) return
  const capA = Math.max(0, me.hp.a)
  const capH = Math.max(0, me.hp.h)
  const hp = meRt.hp
  let active = 0
  for (const u of r.units) {
    if (u.stopped) continue
    active += 1
    // 无消耗自愈件（repairFree）：不看组件余额、不扣组件、永不停机
    if (u.free) {
      const da0 = Math.max(0, capA - hp.a)
      const dh0 = Math.max(0, capH - hp.h)
      let ag0 = Math.min(u.armorPerPulse, da0)
      let hg0 = Math.min(u.hullPerPulse, dh0)
      if (ag0 < u.armorPerPulse && hg0 < dh0) hg0 += Math.min(u.armorPerPulse - ag0, dh0 - hg0)
      if (hg0 < u.hullPerPulse && ag0 < da0) ag0 += Math.min(u.hullPerPulse - hg0, da0 - ag0)
      if (ag0 <= 0 && hg0 <= 0) continue
      hp.a += ag0
      hp.h += hg0
      continue
    }
    const kitNow = r.kits[u.kitId] ?? 0
    if (kitNow <= 0) {
      // 组件耗尽（预载余额用光）：本台停机。
      // 2026-09-11 船长「船体修理装置不单独显示日志。只将消耗组件数量显示到战后总结」
      // ⇒ **不再写日志**（战斗界面底部已有"运转中/已停机"状态与悬停说明，玩家仍看得见）
      u.stopped = true
      continue
    }
    // 额度分配：各层先按自身额度补缺口，层满后剩余额度转投另一层（总上限 = 甲 + 结构额度）
    const da = Math.max(0, capA - hp.a)
    const dh = Math.max(0, capH - hp.h)
    let ag = Math.min(u.armorPerPulse, da)
    let hg = Math.min(u.hullPerPulse, dh)
    if (ag < u.armorPerPulse && hg < dh) hg += Math.min(u.armorPerPulse - ag, dh - hg) // 甲通道剩余 → 结构
    if (hg < u.hullPerPulse && ag < da) ag += Math.min(u.hullPerPulse - hg, da - ag) // 结构通道剩余 → 甲
    if (ag <= 0 && hg <= 0) continue // 痊愈空转：不耗组件
    hp.a += ag
    hp.h += hg
    r.kits[u.kitId] = kitNow - 1
    r.kitsUsed += 1
    // 逐型记账（战报文案用：2026-09-11 船长「只将消耗组件数量显示到战后总结」）
    r.kitsUsedByType = { ...(r.kitsUsedByType ?? {}) }
    r.kitsUsedByType[u.kitId] = (r.kitsUsedByType[u.kitId] ?? 0) + 1
  }
  r.pulses += 1
  if (active === 0) r.nextPulseAtMs = undefined // 全部停机：停调度
  else r.nextPulseAtMs += REPAIR_PULSE_MS
}


export function createBattleState(
  me: UnitSpec,
  foes: UnitSpec[],
  nowMs: number,
  myDesireM: number,
  /**
   * **僚舰**（虫洞 D 批 · 船长 2026-09-13：一场战斗最多 4 艘我方同时参战）。
   * 缺省 `[]` = **单船路径**（既有 27 张悬赏卡 / 低安遭遇 / AI 副船全走这一档）⇒ 建档内容与
   * 改动前逐字一致（`units` 多出的键只可能是这里传进来的僚舰）。
   */
  myAllies: readonly UnitSpec[] = [],
): import('./state').BattleState {
  const units: Record<string, import('./state').BattleState['units'][string]> = {}
  for (const spec of [me, ...myAllies, ...foes]) {
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**带入场触发的单位不进开战编队**，
    // 由 `advanceBattleFor` 每拍按条件补入。开关关闭时建档期根本不写 `foeReinforceAt` → 本行永不命中。
    if (spec.foeReinforceAt) continue
    units[spec.tag] = {
      tag: spec.tag,
      side: spec.side,
      name: spec.name,
      hp: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      weapons: spec.weapons.map(() => 0),
    }
  }
  return {
    startedAtGameMs: nowMs,
    lastTickGameMs: nowMs,
    distanceM: 0, // 由调用方按 battleOpenM 赋值
    myDesireM,
    units,
    ammo: { kin: 0, exp: 0, pla: 0 },
    stats: { meShots: 0, meHits: 0, meDmg: 0, foeShots: 0, foeHits: 0 },
    fx: [],
    fxSeq: 0,
    ended: null,
  }
}

/** 按规格把单位补入战斗（多波续刷/读档补缺用；已存在（含 hp 归零的尸体）不覆盖）。
 * enterReload（2026-09-09 波次转场）：增援单位入场需先完成一轮装填（weapons 满倒计时）
 * 才开火——给"增援抵达"一段自然哑火窗口（≈一次装填时长），不改变任何结算语义。 */
/**
 * **入场飞入时长（ms）**——船长 2026-09-13「舰船从屏幕外以减速的形式进场」，2026-09-14 补定
 * 「**动画没结束不开火**」⇒ 它就是**入场窗口**的长度。**界面与引擎同源**：`panels/BattleScreen.tsx`
 * 直接 import 这个数当 `--arrive-ms`，不许再各写一份（否则"窗口"与"看得见的动画"会脱钩）。
 */
export const BATTLE_ARRIVAL_FLY_MS = 950
/** **逐舰入场错峰（ms）**：同批入场第 i 条舰的入场时刻 = 群入场时刻 + i×本值（界面同一算式） */
export const BATTLE_ARRIVAL_STAGGER_MS = 60

/**
 * **入场播种**（船长 2026-09-14：「①乙，初始不可开火，且对洞内洞外都生效」「③补。并且参考①动画没结束不开火」）。
 *
 * 只给**有入场动画**的单位写 `enteredAtMs`（洞内首波敌方跃迁入场 / 每一次波次转场与单波内增援）：
 * - `idx` = 该舰在本批入场里的序（0 起）⇒ 入场时刻含逐舰错峰，与界面 `--arrive-delay` 同一算式；
 * - **它自己的首发也推到窗口之后**：装填取"窗口时长"与自身装填的**较大者**
 *   （波次转场/增援本来就带 `enterReload`，只有"洞内首波原本满装填"这一档会因此变慢）；
 * - `enterReload` 语义不变（`true` = 至少一个自身装填周期）。
 */
function seedUnit(
  b: import('./state').BattleState,
  spec: UnitSpec,
  opts: { enterReload?: boolean; arrivedAtMs?: number } = {},
): void {
  if (b.units[spec.tag]) return
  const windowMs = opts.arrivedAtMs !== undefined ? BATTLE_ARRIVAL_FLY_MS : 0
  b.units[spec.tag] = {
    tag: spec.tag,
    side: spec.side,
    name: spec.name,
    hp: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    weapons: opts.enterReload
      ? spec.weapons.map((w) => Math.max(1, w.reloadMs, windowMs))
      : spec.weapons.map(() => 0),
    ...(opts.arrivedAtMs !== undefined ? { enteredAtMs: opts.arrivedAtMs } : {}),
  }
}

/**
 * **洞内开战：敌方跃迁入场**（船长 2026-09-13「虫洞内为敌方」）⇒ 给开战首波的敌舰盖入场时刻
 * （含逐舰错峰），并把它们的首发推到窗口之后。**洞外的首波不盖**——那一场是**我方**飞入
 * （船长同日口径），敌方没有入场动画 ⇒ 也就没有窗口（"有动画才有窗口"）。
 * 开战首波由 `createBattleState` 播种（`units` 的插入序 = `[me, ...僚舰, ...foes]`）⇒ 这里的序即编成序。
 */
export function stampFoeArrivalFx(b: import('./state').BattleState, nowMs = b.lastTickGameMs): void {
  const foeTags = Object.values(b.units)
    .filter((u) => u.side === 'foe')
    .map((u) => u.tag)
  foeTags.forEach((tag, idx) => {
    const rt = b.units[tag]
    if (!rt) return
    rt.enteredAtMs = nowMs + idx * BATTLE_ARRIVAL_STAGGER_MS
    // 首发也推到窗口之后（与 `seedUnit` 同一条判据：动画没演完不开火）
    rt.weapons = rt.weapons.map((cd) => Math.max(cd, BATTLE_ARRIVAL_FLY_MS))
  })
}


/** 追加可视化开火事件（环缓冲 48 条，超长丢最旧；纯展示）。
 * seq 由战斗内计数器自增分配——环头部裁剪后序号仍单调，UI 按 seq>last 续播不受裁剪影响。
 * 导出仅供"事件环回归测试"锁定该语义；引擎内部调用。 */
export function pushBattleFx(
  b: import('./state').BattleState,
  ev: Omit<import('./state').BattleFx, 'seq'>,
): void {
  b.fx.push({ ...ev, seq: b.fxSeq++ })
  if (b.fx.length > 48) b.fx.splice(0, b.fx.length - 48)
}

/**
 * **谜质 B1：我方静态增益**（F3c · 船长 2026-09-13）——**只在洞内战斗**里调用。
 *
 * 六类，全部按"从货仓现算"的派生值施加：
 * - **抗性**：对**敌队主伤害系**（单层单系）走既有"缺口削减"合成 `1 − (1−基础)×(1−值)`，
 *   三层各自上限 **0.9 不变**（不新增旋钮）；
 * - **命中 / 回避**：直接加（回避的**加成**在派生端已 +0.25 封顶）；
 * - **射程**：只放大 `maxRangeM`（放大 `minRangeM` 等于把近盲带往前推，反而吃亏 ⇒ 不放大）；
 * - **单发伤害**：与"全舰单发伤害光环"同款改法（`shotDmg` / `shotsByType` 同乘）；
 * - **装填周期**：周期 ×(1 − 削减)，物理下限 50ms（不封顶，但周期不能到 0）。
 */
export function applyMatterPlayerBuffs(spec: UnitSpec, b: WormholeMatterBuffs, foeMain: DamageType): void {
  if (b.devices === 0) return
  spec.hitBonus += b.hitBonus
  if (b.evasion > 0) spec.evasion = spec.evasion + b.evasion
  const applyResist = (layer: 'shield' | 'armor' | 'hull', add: number): void => {
    if (add <= 0) return
    const cur = spec.resists[layer]
    const base = cur?.[foeMain] ?? 0
    const v = Math.min(0.9, 1 - (1 - base) * (1 - add))
    spec.resists[layer] = { ...(cur ?? {}), [foeMain]: v }
  }
  applyResist('shield', b.resistShield)
  applyResist('armor', b.resistArmor)
  applyResist('hull', b.resistHull)
  const rangeMul = 1 + b.weaponRangePct
  const dmgMul = 1 + b.damagePct
  const reloadMul = Math.max(0.1, 1 - b.reloadPct)
  for (const w of spec.weapons) {
    if (rangeMul !== 1) w.maxRangeM = Math.round(w.maxRangeM * rangeMul)
    if (dmgMul !== 1) {
      if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * dmgMul
      if (w.shotsByType) {
        for (const k of Object.keys(w.shotsByType) as DamageType[]) {
          const v = w.shotsByType[k]
          if (typeof v === 'number') w.shotsByType[k] = v * dmgMul
        }
      }
    }
    if (reloadMul !== 1) w.reloadMs = Math.max(50, Math.round(w.reloadMs * reloadMul))
  }
}

/**
 * **谜质在开战那一刻的快照**（F3c B1）：威胁乘数（按用途三档、各自 −50% 封顶）/ 敌队主伤害系 /
 * 敌方削弱两项。**只在洞内战斗里调用**（`state.wormhole.run?.hold` 就是本趟的装置）。
 */
export function wormholeMatterBattleModsOf(
  state: GameState,
  baseCard: AnomalyDef,
  kind: 'node' | 'boss' | 'extract' | 'ruins',
): { threatMul: number; foeMainType: DamageType; foeHitDown: number; blindReduce: number; volleyOverflow: boolean } | null {
  const buffs = wormholeMatterBuffs(state.wormhole.run?.hold)
  if (buffs.devices === 0) return null
  const bucket: 'node' | 'boss' | 'extract' = kind === 'boss' ? 'boss' : kind === 'extract' ? 'extract' : 'node'
  const threatMul = wormholeMatterThreatMul(buffs, bucket)
  /**
   * **只有真会改变战斗结果的装置才返回快照**（否则返回 `null` ⇒ 走改动前的老路径、存档形状也不变）：
   * 探索与作业类装置（测绘仪 / 时序核心 / 起重机 / 钻机 / 星云 / 富集器 / 扩展器）不影响战斗。
   */
  const any =
    threatMul < 1 ||
    buffs.enemyHitDown > 0 ||
    buffs.blindReduce > 0 ||
    buffs.resistShield > 0 ||
    buffs.resistArmor > 0 ||
    buffs.resistHull > 0 ||
    buffs.hitBonus > 0 ||
    buffs.evasion > 0 ||
    buffs.weaponRangePct > 0 ||
    buffs.damagePct > 0 ||
    buffs.reloadPct > 0 ||
    buffs.volleyOverflow
  if (!any) return null
  return {
    threatMul,
    foeMainType: foeMainDamageType(baseCard),
    foeHitDown: buffs.enemyHitDown,
    blindReduce: buffs.blindReduce,
    volleyOverflow: buffs.volleyOverflow,
  }
}

/**
 * **本场我方的单位规格**（虫洞 D 批 · 每拍重建）：
 * - **单船路径**（`battle.myFleet` 未写）：等价于改动前的单点 `createPlayerSpec(shipId)` + 教学战加成；
 * - **多单位路径**（写了）：按 `myFleet` 逐条重建（各自装配/技能/血条/装填），并把 `tag` 覆盖成
 *   编队标识（`player` / `ally-N`）。**弹药按同一份 `battle.ammoIds` 口径**（共用池的"主控优先档口"，
 *   见 `startFleetBattleFor` 注释）。
 * 返回**空数组** = 主力船记录缺失（调用方按判负收场，与改动前 `!me` 同路径）。
 */
function buildMyUnitSpecs(
  state: GameState,
  ctx: SimContext,
  battle: import('./state').BattleState,
  shipId: string,
  anomalyId: string | null,
): UnitSpec[] {
  const fleet = battle.myFleet
  /**
   * **谜质 B1**：洞内战斗的每拍重建也要吃同一份增益（否则"开战吃、之后几拍又吐回去"）。
   * 快照里的 `foeMainType` 决定三张谐振片对哪一系加抗性。
   */
  const wh = battle.wormhole
  const matterBuffs = wh ? wormholeMatterBuffs(state.wormhole.run?.hold) : null
  const matterFoeMain: DamageType = wh?.foeMainType ?? 'kinetic'
  if (!fleet || fleet.length === 0) {
    const me = createPlayerSpec(state, ctx, shipId, battle.ammoIds) // 弹药 MK2：按本场实装弹 id 重建（回退同源）
    if (!me) return []
    if (matterBuffs) applyMatterPlayerBuffs(me, matterBuffs, matterFoeMain)
    // 序章·苏醒：教学战（教程步骤4 + 演习场 + 主控）给玩家舰 命中/回避加成（每拍规格重建处注入）
    if (isTutorialBattle(state, anomalyId, shipId)) applyTutorialBuff(me)
    return [me]
  }
  const out: UnitSpec[] = []
  for (const entry of fleet) {
    const spec = createPlayerSpec(state, ctx, entry.shipId, battle.ammoIds)
    if (!spec) continue
    if (matterBuffs) applyMatterPlayerBuffs(spec, matterBuffs, matterFoeMain)
    spec.tag = entry.tag
    if (entry.tag === 'player' && isTutorialBattle(state, anomalyId, entry.shipId)) {
      applyTutorialBuff(spec)
    }
    out.push(spec)
  }
  return out
}

/**
 * 到港开战通用组装（主控与 AI 共用）：建状态 + 预载弹药；返回 battle 或 null（记录缺失）。
 * atGameMs = 开战时刻（应传"到港时刻"，让离线大推进能把后续时间全部推完）。
 * desireM = 玩家期望距离偏好（缺省 = 主武器有效射程中点）。 */
/** 本场战斗的目标卡（2026-09-10）：赏金任务·窝点按 tier 现场派生强化卡（威胁/波次/僚机/名称）；
 *  敌对派系活跃（factionActive）= 当日选中星系的常驻悬赏威胁 ×1.1；
 *  普通悬赏、低安遭遇（都没设）一律返回原卡。战斗构建、推进、展示共用此口，避免口径漂移。 */
export function battleAnomalyOf(
  ctx: SimContext,
  anomalyId: string | null | undefined,
  lairTier?: LairTier,
  factionActive?: boolean,
): AnomalyDef | undefined {
  const base = anomalyId ? ctx.anomalies.get(anomalyId) : undefined
  if (!base) return undefined
  const card = lairTier ? lairAnomalyOf(base, lairTier) : base
  return factionActive ? factionAnomalyOf(card) : card
}
export function startBattleFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  /**
   * 目标距离：`number > 0` = 显式指定；**`null` = 强制"射程中段"、不吃该星系的玩家设定**
   * （2026-09-11 船长「只有主控吃」⇒ AI 副船走这一档）；`undefined` = 用该星系设定、没设过则射程中段。
   */
  desireM?: number | null,
): import('./state').BattleState | null {
  if (!anomalyId) return null
  const anomaly = battleAnomalyOf(ctx, anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  /**
   * **满值上限**（血条分母）——必须在**承伤持久化之前**留一份。
   *
   * ⚠ 2026-09-14 修船长报障「**虫洞战斗中，我方舰船的血量上限显示不正确**」：洞内多舰路径把
   * `hpMax` 取自**打完折之后**的规格（下面那两行 `me.hp.a *= armorMul`），于是"上限"跟着场间残余
   * 一起缩水（装甲剩 60% ⇒ 血条分母只有满值的 60%、开局读作满格）；而**单船路径的视图上限**
   * （`battleArcsFor` 的 `maxHp.me`）用的是**现建的满值规格** ⇒ 洞外 60%、洞内 100%，两条路不一致。
   * 语义定案：**上限恒为该舰的满值**，承伤持久化只打"当前值"（与护盾每场满值重建同一条口径）。
   */
  const meFullHp = { ...me.hp }
  // P0 承伤持久化：装甲/结构（=耐久合并属性）按场间残余开局；护盾每场满值重建
  const fleetShip = state.fleet[shipId]
  if (fleetShip) {
    const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
    const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
    me.hp.a = Math.max(0, me.hp.a * armorMul)
    me.hp.h = Math.max(0, me.hp.h * hullMul)
  }
  // 序章·苏醒：教学战加成（开战规格重建处也注入，命中/回避影响后续弹道与 UI 读到的克制无涉）
  if (isTutorialBattle(state, anomalyId, shipId)) applyTutorialBuff(me)
  // 多波（2026-09-09）：开战只生成第一波；后续波由 advanceBattleFor 在敌方全灭时补刷
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 期望距离：显式传入（出发时的偏好/战术）优先；`null` = 强制默认档（AI 副船）；否则用
  // **该星系的目标距离**；该星系没设过 → **星图默认档 = 主武器射程带 0.8 处**（2026-09-15 船长裁定，
  // 旧"射程中段"作废：远程武器默认要站远端，见 `balance.battle.desireBandStarMap`）。
  // 记忆可能来自更远射程的战斗：一律钳到本次开战距离内。
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal, bal.desireBandStarMap)
      : desireM !== undefined && desireM > 0
        ? Math.round(desireM)
        : (desirePrefOf(state, anomaly.galaxyId) ?? desiredRangeFor(me, 'mid', bal, bal.desireBandStarMap))
  const desire = Math.min(openM, Math.max(bal.minDistanceM, rawDesire))
  const battle = createBattleState(me, foes, atGameMs, desire)
  /**
   * **把血条分母修回满值**（2026-09-14 修船长报障「虫洞战斗中，我方舰船的血量上限显示不正确」）：
   * `createBattleState` 是按"传入规格"写 `hp`/`hpMax` 的，而上面已经把规格的装甲/结构按场间残余打过折
   * ⇒ 分母跟着缩水。这里显式改回**满值**，只让 `hp`（当前值）吃那份折扣。
   */
  const meRt0 = battle.units['player']
  if (meRt0) meRt0.hpMax = meFullHp
  // 开战距离 = 双方所有武器最远射程 + 缓冲（缓冲 = max(100m, 最远射程×10%)，船长 2026-09-05）：
  // 开局从射程外缓冲处开始、双方立即向各自期望交战位置接近——被更远程的敌人压制接近期
  // 属于其战术身份（打远程怪就该先挨一段打/换远程武器应对），不视为需要消除的空窗。
  battle.distanceM = openM
  // V18B-2：per-gun 多键预载——动能/爆破导弹/能量弹药各按自身装填估量装载
  // （纯激光船也能带上能量弹药；混装各型互不挤占）
  // 2026-09-09 弹药 MK2：按船装配档位（ammoPref）装载；配置档库存不足整族回退基础弹 +
  // 日志提示；实装弹 id 写入 battle.ammoIds（推进/退还/视图与实际弹种对齐）
  const totals = ammoLoadTotals(me, bal, state)
  const ammoIds: Partial<Record<DamageType, string>> = {}
  for (const [t, n] of Object.entries(totals)) {
    const type = t as DamageType
    const key = ammoKeyOf(type)
    const res = loadAmmoTier(state, ctx, shipId, type, n)
    battle.ammo[key] += res.loaded
    if (state.fleet[shipId]?.ammoPref?.[type] && res.loaded > 0) ammoIds[type] = res.id
    if (res.fellBack && res.loaded > 0) {
      const wantName = ctx.items.get(state.fleet[shipId]!.ammoPref![type]!)?.name ?? type
      const useName = ctx.items.get(res.id)?.name ?? type
      addLog(state, 'warn', `⚙ ${wantName}库存不足，本场改用${useName}（预载 ${res.loaded} 发）。`)
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  // **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：记一份，战后按「预载 − 余额」算这一场打出去多少
  battle.ammoLoaded = { ...battle.ammo }
  // 机群生存池（2026-09-10 船长「无人机可被击落」）：**逐舰**建池（2026-09-14 船长「逐舰机群」），
  // 键 = `舰tag:武器下标`；只有 src='drone' 的条目参战。
  const pools: Record<string, import('./state').DronePoolEntry> = {}
  // 无人机线技能（2026-09-10 船长）：耐久学（基础档）与强化学（进阶档）**乘算**放大三层血
  // （"全血条"）、规避学提闪避（封顶 0.9）
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  buildDronePoolsFor(ctx, me, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    battle.droneLost = {}
    battle.droneLostBy = {}
    // 开战清单快照（战后判定"机群战损过半"→ 停重复清剿用）：单船路径只有主控一份
    const load = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
    battle.droneLoadAtStart = load
    battle.droneLoadAtStartBy = { [me.tag ?? 'player']: load }
  }
  // 敌机机群生存池（2026-09-11 机群批）：与敌方编队同建；无 `foeDrones` 的敌舰不建池 ⇒ 零行为变化
  initFoeDronePools(battle, foes);
  // 近防炮调度（威胁 ≥ pdThreatFloor 的敌舰各装一台；与敌编队同序、独立冷却）
  if (pdEnabledFor(anomaly.threat, bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  // 船体维修装置（2026-09-09 船长定）：装配快照 + 修理组件预载（货舱优先、仓库兜底）；
  // 每台预载上限 = 整场最长战斗时间能跳的脉冲数 + 1，战斗结束退还未用（与弹药同哲学）。
  // 2026-09-11 船长：「船体修理装置不单独显示日志。只将消耗组件数量显示到战后总结」
  // ⇒ 开战的「待命 / 缺组件」两条日志**取消**（装备效果与"是否吃组件"在装配页与手册里已写明，
  //   战斗中是否运转由战斗界面底部状态灯表达），消耗数只在战报里以「消耗 …×N」出现。
  const repair = preloadRepairFor(state, ctx, shipId, bal.maxBattleMs)
  if (repair) {
    const ready = repair.units.filter((u) => !u.stopped)
    if (ready.length > 0) repair.nextPulseAtMs = battle.startedAtGameMs + REPAIR_PULSE_MS // 开战 5 秒后第一跳
    battle.repair = repair
  }
  // 护盾充能装置（2026-09-14）：**独立 30 秒计时**（与维修装置的 5 秒互不干扰），开战 30 秒后第一跳
  const shieldCharge = preloadShieldChargeFor(state, ctx, shipId)
  if (shieldCharge) {
    shieldCharge.nextPulseAtMs = battle.startedAtGameMs + SHIELD_PULSE_MS
    battle.shieldCharge = shieldCharge
  }
  return battle
}

/**
 * **洞内敌卡的派生单点**（F 批 · 2026-09-13）：开战与逐拍重建**必须走同一处**，
 * 否则会出现"建档给了一套数值、逐拍又换一套"的静默错位——
 * 首版就是这么错的：`advanceBattleFor` 漏了总血预算 ⇒ 敌人**血是强化后的、炮还是自然值**
 * （探针实测：敌总血 11,168、单发 1,336，实战里每发只掉 6~7 点，整场残血 100%）。
 */
/**
 * `wormholeDerivedAnomaly` 的一层记忆（见该函数注释；键 = 卡 id|层|用途|波数|强度覆写）。
 * 只存最近一份：一局里同时只会有一种用途在场（节点/守卫/撤离），换键即重算。
 */
let wormholeDerivedMemo: { key: string; card: AnomalyDef } | null = null

export function wormholeDerivedAnomaly(
  ctx: SimContext,
  baseCard: AnomalyDef,
  spec: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins'
    waves: number
    strengthMul?: number
    /** 谜质：威胁乘数（缺省 1）+ 敌方命中/近盲带削减（见 `battle.wormhole` 的字段说明） */
    threatMul?: number
    foeHitDown?: number
    blindReduce?: number
  },
): AnomalyDef {
  /**
   * **一层记忆（2026-09-13 性能修）**：本函数被**每 100ms 一拍**（战斗推进）＋**每次重渲染**
   * （战场视图 `wormholeBattleViewOf`）调用，每次都克隆/缩放整张敌卡与槽位 ⇒ 拖距离条那种
   * 高频重渲染下会顶出顿挫（船长："依旧还是有顿挫感"、"参考洞外战斗的距离调整"）。
   * 入参只由 `(卡 id, 层, 用途, 波数, 强度覆写, 谜质三项)` 决定 ⇒ **同键复用上一份**（调用方都只读不写）。
   */
  const threatMul = spec.threatMul ?? 1
  const zero = (v: number | undefined): string => (v === undefined || v === 0 ? '' : String(v))
  const memoKey = `${baseCard.id}|${spec.depth}|${spec.kind}|${spec.waves}|${spec.strengthMul ?? ''}|${threatMul}|${zero(spec.foeHitDown)}|${zero(spec.blindReduce)}`
  if (wormholeDerivedMemo !== null && wormholeDerivedMemo.key === memoKey) return wormholeDerivedMemo.card
  const derived = wormholeAnomalyOf(baseCard, spec.depth, spec.kind, spec.waves, {
    // **按层把总血压到该层威胁对应的预算**（单船威胁曲线 × **洞内强度系数**——4 舰对 4 舰口径）
    // × **谜质威胁乘数**（压制力场 / 守卫解析仪 / 撤离掩护器；−50% 封顶在派生端夹好）
    hpBudget:
      foeHpOfThreat(wormholeFoeThreat(spec.depth, spec.kind), ctx.balance.battle) *
      WORMHOLE_FOE_BASE_STRENGTH_MUL *
      threatMul,
    ...(spec.strengthMul !== undefined ? { strengthMul: spec.strengthMul } : {}),
  })
  /**
   * **谜质 B1：敌方削弱折进派生卡**（这样**所有** `createFoeSpecs` 调用点自动生效——
   * 开战、逐拍重建、下一波补刷、战场视图都读同一张派生卡，不必各处再补一次）：
   * `foeHitRate` 直接减（命中率是**概率**，按绝对值减、下限 0）；`blindDmgMul` 同样按绝对值减。
   */
  const foeHitDown = spec.foeHitDown ?? 0
  const blindReduce = spec.blindReduce ?? 0
  const card: AnomalyDef =
    foeHitDown > 0 || blindReduce > 0
      ? {
          ...derived,
          ...(foeHitDown > 0 ? { foeHitRate: Math.max(0, (derived.foeHitRate ?? ctx.balance.battle.foeHitRate) - foeHitDown) } : {}),
          ...(blindReduce > 0 ? { blindDmgMul: Math.max(0, (derived.blindDmgMul ?? 0.3) - blindReduce) } : {}),
        }
      : derived
  wormholeDerivedMemo = { key: memoKey, card }
  return card
}

/**
 * **多舰编队开战**（虫洞 D 批 · 船长 2026-09-13：「4 艘同时参战」）——与 `startBattleFor` 并列的
 * 第二条建档入口，**既有单船路径一字不动**。
 *
 * 口径（逐条见设计稿 §二 冲突 1 的 D 批落地表）：
 * - **主控 = `state.shipId`**（若在编队里，否则编队第一艘）；tag 恒为 `'player'`，僚舰 `'ally-1'..`；
 * - **逐船**按自己的装配/技能建三层血，并按自己的**场间残余**（`armorPct`/`durability`）开局；
 * - **弹药整队共用一个池，但池 = 每艘船各自装载量之和**（各船按自己的装配档与货仓装载、
 *   **照付成本**）；⚠ 多船混装**不同弹种档位**时，`battle.ammoIds` 与退还都按**主控优先**
 *   的档口（共用池记不住两套档位——已知简化，F 批可细化）；
 * - **不挂 `hullEscapeFrac`** ⇒ 副本内没有"结构过半自动脱离"保险（冲突 2 · 船长裁定「关闭」）；
 * - 僚舰的**无人机机群 / 近防炮 / 修理包不参战**（D 批边界；机群与点防的多单位化留 F 批）。
 */
export function startFleetBattleFor(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
  anomalyId: string | null,
  atGameMs: number = state.gameMs,
  desireM?: number | null,
  /**
   * **虫洞战斗标记**（F 批 · 2026-09-13）：给了就按层派生敌卡（`wormholeAnomalyOf`），
   * 并把 `{cardId, depth, kind, waves}` 写进 `battle.wormhole` ⇒ 逐拍重建同源。
   * **不给 = 普通多舰战斗**（既有行为）。
   * `strengthMul` = **校准用覆写**（只有 `tools/wormhole-econ.ts` 会传；引擎/实战一律走常量）。
   */
  wormhole?: {
    depth: number
    kind: 'node' | 'boss' | 'extract' | 'ruins'
    waves: number
    strengthMul?: number
    /**
     * **谜质装置在开战那一刻的快照**（F3c B1 · 船长 2026-09-13）：
     * 战斗是"逐拍重建规格"的（`buildMyUnitSpecs` / `createFoeSpecs` 每拍按敌卡重建）
     * ⇒ 把**这一场**吃到的四个值随标记写进 `battle.wormhole`，逐拍重建时**同一份**，不各算各的。
     * - `threatMul`：威胁乘数（压制力场/守卫解析仪/撤离掩护器，**三档各自 −50% 封顶**）；
     * - `foeMainType`：敌队主伤害类型（护盾/装甲/结构三张谐振片**只对它**加抗性）；
     * - `foeHitDown`：敌方命中 −（干扰发射器，**−0.25 封顶**）；
     * - `blindReduce`：敌方近盲带伤害比例 −（盲区压制器，下限 0）。
     */
    threatMul?: number
    foeMainType?: DamageType
    foeHitDown?: number
    blindReduce?: number
  },
): import('./state').BattleState | null {
  if (!anomalyId || shipIds.length === 0) return null
  // 虫洞内的敌卡取**原卡**（不套窝点派生/派系活跃——那是悬赏线的口径），再按层派生
  const baseCard = battleAnomalyOf(ctx, anomalyId)
  if (!baseCard) return null
  /**
   * **谜质在开战那一刻的快照**（F3c B1 · 船长 2026-09-13）：威胁乘数（三档各自 −50% 封顶）、
   * 敌队主伤害系（三张谐振片"单层单系"只对它加抗性）、敌方削弱两项。
   * 快照随 `battle.wormhole` 落进战斗 ⇒ 逐拍重建读同一份。
   */
  const matterMods = wormhole ? wormholeMatterBattleModsOf(state, baseCard, wormhole.kind) : null
  // 洞内敌卡：按层派生（**与逐拍重建同源**，见 `wormholeDerivedAnomaly` 的注释）
  const anomaly = wormhole
    ? wormholeDerivedAnomaly(ctx, baseCard, {
        ...wormhole,
        ...(matterMods
          ? {
              ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
              ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
              ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            }
          : {}),
      })
    : baseCard
  const bal = ctx.balance.battle
  // 编队顺序：**主控置首**（`state.shipId` 在编队里就提到第一位），其余保持传入顺序
  const ordered = [...shipIds]
  const leaderIdx = ordered.indexOf(state.shipId)
  if (leaderIdx > 0) {
    ordered.splice(leaderIdx, 1)
    ordered.unshift(state.shipId)
  }
  const specs: UnitSpec[] = []
  const fleet: NonNullable<import('./state').BattleState['myFleet']> = []
  /** 逐船规格（弹药装载要按船各算一次，故留一份） */
  const specOf = new Map<string, UnitSpec>()
  /**
   * **逐船满值三层血**（血条分母）——必须在承伤持久化**之前**留一份。
   * ⚠ 2026-09-14 修船长报障「**虫洞战斗中，我方舰船的血量上限显示不正确**」：见 `startBattleFor`
   * 里同款注释（洞内多舰路径原先拿"打完折的规格"当初始 `hpMax` ⇒ 上限凭空缩水、与洞外口径不一致）。
   * 语义定案：**上限恒为该舰满值**，承伤持久化只打"当前值"。
   */
  const fullHpOf = new Map<string, { s: number; a: number; h: number }>()
  for (let i = 0; i < ordered.length; i++) {
    const sid = ordered[i]!
    const spec = createPlayerSpec(state, ctx, sid)
    // 主力船记录缺失 = 与单船路径同样的"开不了战"（不让它退化成"打头的变成僚舰"）
    if (!spec) {
      if (i === 0) return null
      continue
    }
    spec.tag = i === 0 ? 'player' : `ally-${i}`
    fullHpOf.set(spec.tag, { ...spec.hp })
    // P0 承伤持久化：装甲/结构（=耐久合并属性）按**各自**场间残余开局；护盾每场满值重建
    const fleetShip = state.fleet[sid]
    if (fleetShip) {
      const armorMul = Math.min(1, Math.max(0, fleetShip.armorPct ?? 1))
      const hullMul = Math.min(1, Math.max(0, fleetShip.durability ?? 1))
      spec.hp.a = Math.max(0, spec.hp.a * armorMul)
      spec.hp.h = Math.max(0, spec.hp.h * hullMul)
    }
    specs.push(spec)
    specOf.set(sid, spec)
    fleet.push({ tag: spec.tag, shipId: sid })
  }
  if (specs.length === 0) return null
  // **全舰单发伤害光环**（2026-09-13 船长：指挥舰「提高全舰的单发伤害 15%」）——
  // 建完各舰规格后统一乘；**多艘同类只取最高、不叠加**（与"同项取优"惯例一致）。
  const fleetAura = Math.max(0, ...ordered.map((sid) => {
    const fs = state.fleet[sid]
    const defId = fs?.defId
    return (defId ? ctx.ships.get(defId)?.fleetDamageBonusPct : 0) ?? 0
  }))
  if (fleetAura > 0) {
    const mul = 1 + fleetAura
    for (const spec of specs) {
      for (const w of spec.weapons) {
        if (typeof w.shotDmg === 'number') w.shotDmg = w.shotDmg * mul
        if (w.shotsByType) {
          for (const k of Object.keys(w.shotsByType) as DamageType[]) {
            const v = w.shotsByType[k]
            if (typeof v === 'number') w.shotsByType[k] = v * mul
          }
        }
      }
    }
  }
  // **谜质 B1：我方静态增益**（抗性 / 命中 / 回避 / 射程 / 单发 / 装填）——只在洞内战斗里生效
  if (matterMods) {
    const buffs = wormholeMatterBuffs(state.wormhole.run?.hold)
    for (const spec of specs) applyMatterPlayerBuffs(spec, buffs, matterMods.foeMainType)
  }
  const me = specs[0]!
  // 多波（2026-09-09）：开战只生成第一波；后续波由 advanceBattleFor 在敌方全灭时补刷
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const foes = waves
    ? createFoeSpecs(anomaly, bal, { units: waves[0]!.units, hpShare: waves[0]!.hpShare })
    : createFoeSpecs(anomaly, bal)
  const openM = battleOpenM(me, foes, bal)
  // 期望距离：`null` = 强制默认档（洞内编队默认走这条）；显式值优先；否则该星系偏好 → 默认档。
  // ⚠ **分档**（2026-09-15 船长裁定）：洞内 = 中段（`desireBandWormhole` 0.5，"进去就得挨打"张力不变）；
  // 星图 = 射程带高位（`desireBandStarMap` 0.8，远程武器默认站远端）。
  const bandMid = wormhole ? bal.desireBandWormhole : bal.desireBandStarMap
  const rawDesire =
    desireM === null
      ? desiredRangeFor(me, 'mid', bal, bandMid)
      : desireM !== undefined && desireM > 0
        ? Math.round(desireM)
        : (desirePrefOf(state, anomaly.galaxyId) ?? desiredRangeFor(me, 'mid', bal, bandMid))
  const desire = Math.min(openM, Math.max(bal.minDistanceM, rawDesire))
  const battle = createBattleState(me, foes, atGameMs, desire, specs.slice(1))
  /**
   * **逐船把血条分母修回满值**（2026-09-14 修船长报障「虫洞战斗中，我方舰船的血量上限显示不正确」）：
   * `createBattleState` 按"传入规格"写 `hp`/`hpMax`，而上面已按各舰的场间残余打过折 ⇒ 分母跟着缩水
   * （洞内 4 条舰的血条开局全是满格、上限比洞外小）。这里显式改回**各自满值**。
   */
  for (const [tag, full] of fullHpOf) {
    const rt = battle.units[tag]
    if (rt) rt.hpMax = full
  }
  // 开战距离 = 双方所有武器最远射程 + 缓冲（缓冲 = max(100m, 最远射程×10%)，船长 2026-09-05）：
  // 开局从射程外缓冲处开始、双方立即向各自期望交战位置接近——被更远程的敌人压制接近期
  // 属于其战术身份（打远程怪就该先挨一段打/换远程武器应对），不视为需要消除的空窗。
  //
  // ⚠ **虫洞内战斗的特殊规则（船长 2026-09-13）**：洞内**不吃**上面那条常规开战距离 ——
  //   ① **非近战敌人**：初始距离 = **其目标距离**（敌人一开场就站在自己想打的位置）；
  //   ② **近战敌人**：初始距离 = **玩家的中距离位置**（贴脸怪一开场就在你脸上）。
  //   动机：常规口径下长射程编队能把近程敌人**永远钉在射程外**（F1 校准实测「敌开火 0」），
  //   洞内要的是"进去就得挨打"的搜打撤张力。混合编成按"**卡内任一近战单位 ⇒ 走近战口径**"。
  if (wormhole) {
    const anyBrawl = foes.some((f) => f.foeTactic === 'brawl')
    // ⚠ 近战怪的开局距离也继续用**洞内中段**（`desiredRangeFor` 缺省 = `desireBandWormhole`）
    const want = anyBrawl ? desiredRangeFor(me, 'mid', bal) : foeDesiredRange(me, foes, bal)
    battle.distanceM = Math.max(bal.minDistanceM, Math.min(openM, Math.round(want)))
  } else {
    battle.distanceM = openM
  }
  battle.myFleet = fleet
  // 弹药：**逐船装载、汇入同一个池**（成本按各船各付；档口按主控优先）
  const ammoIds: Partial<Record<DamageType, string>> = {}
  for (const entry of fleet) {
    const spec = specOf.get(entry.shipId)!
    const totals = ammoLoadTotals(spec, bal, state)
    for (const [t, n] of Object.entries(totals)) {
      const type = t as DamageType
      const key = ammoKeyOf(type)
      const res = loadAmmoTier(state, ctx, entry.shipId, type, n)
      battle.ammo[key] += res.loaded
      if (state.fleet[entry.shipId]?.ammoPref?.[type] && res.loaded > 0 && ammoIds[type] === undefined) {
        ammoIds[type] = res.id
      }
      if (res.fellBack && res.loaded > 0) {
        const wantName = ctx.items.get(state.fleet[entry.shipId]!.ammoPref![type]!)?.name ?? type
        const useName = ctx.items.get(res.id)?.name ?? type
        addLog(state, 'warn', `⚙ ${wantName}库存不足，本场改用${useName}（预载 ${res.loaded} 发）。`)
      }
    }
  }
  if (Object.keys(ammoIds).length > 0) battle.ammoIds = ammoIds
  // **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：记一份，战后按「预载 − 余额」算这一场打出去多少
  battle.ammoLoaded = { ...battle.ammo }
  // 机群生存池：**逐舰建池**（2026-09-14 船长「逐舰机群」——此前只有主控的机群参战，僚舰的
  // 无人机条目被 `stepBattle` 跳过；键 = `舰tag:武器下标`，逐舰各自的机型/技能/舱位口径）
  const pools: Record<string, import('./state').DronePoolEntry> = {}
  const durMul =
    (1 + DRONE_SKILL.durabilityPerLevel * droneSkillLv(state, 'drone-durability')) *
    (1 + DRONE_SKILL.reinforcePerLevel * droneSkillLv(state, 'drone-reinforce'))
  const evaMul = 1 + DRONE_SKILL.evasionPerLevel * droneSkillLv(state, 'drone-evasion')
  for (const spec of specs) buildDronePoolsFor(ctx, spec, pools, durMul, evaMul)
  if (Object.keys(pools).length > 0) {
    battle.dronePools = pools
    battle.droneLost = {}
    battle.droneLostBy = {}
    // 开战清单快照：**逐舰**一份（战后按舰扣各自的机舱清单）；老字段 `droneLoadAtStart` 仍是主控那份
    const by: Record<string, Record<string, number>> = {}
    for (const e of fleet) by[e.tag] = { ...(state.fleet[e.shipId]?.droneLoad ?? {}) }
    battle.droneLoadAtStartBy = by
    battle.droneLoadAtStart = { ...(state.fleet[fleet[0]!.shipId]?.droneLoad ?? {}) }
  }
  initFoeDronePools(battle, foes);
  if (pdEnabledFor(anomaly.threat, bal) && Object.keys(pools).length > 0) {
    battle.pdCd = foes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
  }
  // 维修装置：**只预载主控**（僚舰修理包不参战，见 D 批边界）
  const repair = preloadRepairFor(state, ctx, fleet[0]!.shipId, bal.maxBattleMs)
  if (repair) {
    const ready = repair.units.filter((u) => !u.stopped)
    if (ready.length > 0) repair.nextPulseAtMs = battle.startedAtGameMs + REPAIR_PULSE_MS
    battle.repair = repair
  }
  // 护盾充能装置：与维修装置同口径**只预载主控**（僚舰的充能装置不参战，见 D 批边界）
  const shieldCharge = preloadShieldChargeFor(state, ctx, fleet[0]!.shipId)
  if (shieldCharge) {
    shieldCharge.nextPulseAtMs = battle.startedAtGameMs + SHIELD_PULSE_MS
    battle.shieldCharge = shieldCharge
  }
  // **虫洞战斗标记**（F 批）：写进 battle ⇒ 每拍按同一份派生重建敌卡（`advanceBattleFor` 读它）；
  // F3c B1 起，谜质在开战那一刻的快照（威胁乘数 / 敌主伤害系 / 敌方削弱）**一并写进去**，
  // 逐拍重建与下一波补刷都读这一份（不各算各的）。
  if (wormhole) {
    battle.wormhole = {
      cardId: anomalyId,
      ...wormhole,
      /**
       * 谜质快照**只写真正生效的项**（没带战斗类装置时 `matterMods` = null ⇒ 一个字段都不写）：
       * 于是"没带装置"的洞内战斗与改动前**逐字一致**（存档形状、既有用例、战报都不受影响）。
       */
      ...(matterMods
        ? {
            ...(matterMods.threatMul < 1 ? { threatMul: matterMods.threatMul } : {}),
            ...(matterMods.foeMainType ? { foeMainType: matterMods.foeMainType } : {}),
            ...(matterMods.foeHitDown > 0 ? { foeHitDown: matterMods.foeHitDown } : {}),
            ...(matterMods.blindReduce > 0 ? { blindReduce: matterMods.blindReduce } : {}),
            ...(matterMods.volleyOverflow ? { volleyOverflow: true } : {}),
          }
        : {}),
    }
  }
  // ⚠ **刻意不写 `battle.hullEscapeFrac`**：副本内无"结构过半自动脱离"保险（冲突 2 · 船长裁定）。
  return battle
}

/** 战斗射程带查询（小剧场距离条用）：返回双方主武器带与开战距离上限；无战斗返回 null */
export function battleZonesFor(state: GameState, ctx: SimContext): {
  openM: number
  me: { minM: number; maxM: number; name: string }
  foe: { minM: number; maxM: number }
} | null {
  const anomaly = battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  if (!anomaly) return null
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, state.shipId)
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const main = mainWeaponOf(me) ?? me.weapons[0]!
  let foeMin = 0
  let foeMax = 0
  for (const f of foes) {
    for (const w of f.weapons) {
      foeMin = Math.min(foeMin, w.minRangeM)
      foeMax = Math.max(foeMax, w.maxRangeM)
    }
  }
  return {
    openM: battleOpenM(me, foes, bal),
    me: { minM: main.minRangeM, maxM: main.maxRangeM, name: main.label },
    foe: { minM: foeMin, maxM: foeMax },
  }
}

/** 战斗可视化武器卡（战场射程弧/弹药颜色用）：返回双方射程带、当前弹药与开火弹型。
 * 我方逐武器展开：炮台颜色 = 与引擎同口径的"剩余最多弹型"（无弹 null，画虚线灰弧）；
 * 敌方整编队聚合一道（同型同射程）。无战斗/记录缺失返回 null。 */
export function battleArcsFor(
  state: GameState,
  ctx: SimContext,
  /**
   * **显式战斗上下文**（2026-09-13 F 批）：不给 = 既有"远征战斗"口径（逐字不变）；
   * 给了 = 按这套上下文出视图（虫洞战斗由 `wormholeBattleViewOf` 传进来，与远征互不干扰）。
   */
  override?: {
    battle: import('./state').BattleState
    anomaly: AnomalyDef
    /** 视图锚（我方主视角/主控）的船型 uid */
    leaderShipId: string
  } | null,
): {
  nearM: number
  openM: number
  /** 敌方当前战术期望距离（与引擎推进同口径：按战术系数换算后钳制在开战距离内）——UI 判断敌舰意图方向用 */
  foeDesireM: number
  ammo: { kin: number; exp: number; pla: number }
  /** 弹药 MK2（2026-09-09）：本场实装弹名（键 → 弹药卡名；缺省 = UI 用默认弹型名） */
  ammoNames?: Partial<Record<'kin' | 'exp' | 'pla', string>>
  me: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    /** 武器装填周期毫秒（静态；UI 冷却条分母） */
    reloadMs: number
    /** 武器来源（2026-09-10：无人机条目据此出机群/弹道；缺省 = 旧口径） */
    src?: WeaponSrc
    /** 无人机机型 id（src='drone'）；UI 按机型出机体与弹点 */
    artId?: string
    /** 该条目合并的架数（无人机同机型多架合并为「机型 ×N」一条；非无人机为 1） */
    count?: number
    /** **主武器**（战术距离口径，同 `mainWeaponOf`：射程最远、并列取名义火力大的）——
     *  UI 据此在射程弧端画米数刻度（2026-09-12 船长裁定「甲」后单点下发，界面不再自己 find(kind==='gun')） */
    isMain?: boolean
  }>
  /** 我方各武器当前装填剩余毫秒（与 me 同序；0 = 可开火；战斗单位缺失时为空数组） */
  meReload: number[]
  /** **我方编队逐舰读数**（F 批「4 条舰影 + 血条」；单船路径 = 一条 = 主控） */
  myUnits: Array<{
    tag: string
    /** 编队 uid（`船型id#序号`）：血条 / 名称 / 装配查找用它 */
    shipId: string
    /** 船型 id（`sh-thresher`）：**画舰影必须用它**（uid 查不到舰形资产表 ⇒ 会退回兜底剪影） */
    defId: string
    name: string
    className: string
    /** 主控（视图锚） */
    leader: boolean
    /**
     * **本舰的机群机体清单**（2026-09-14 船长「逐舰机群」）：按该舰**存活**的池条目归并
     * （`artId → 架数`）。界面据此**逐舰**画机体（挂在各舰自己的锚点上）；
     * 键里带 owner，故主控那条与旧口径同源（同 artId、同架数、同锚点 ⇒ 逐像素不变）。
     * 缺省/空数组 = 该舰没有机群（或不参战）。
     */
    drones: Array<{ artId: string; count: number }>
    hp: { s: number; a: number; h: number }
    hpMax: { s: number; a: number; h: number }
    alive: boolean
  }>
  /** 敌方各武器射程带（聚合）：`minM~maxM` 跨全部单位取极值，`type` = 遍历到的最后一件武器弹种 */
  foe: { minM: number; maxM: number; type: DamageType }
  /**
   * 敌方**逐射程带**分解（2026-09-11 船长反馈"敌方射程不一致时只显示其中一个"）：
   * 按 (min, max, 弹种) 去重、外圈在前；`count` = 用该带的**敌舰艘数**，`names` = 舰名（悬停说明用）。
   * 只有一条带时界面观感与旧版完全一致（同一条「敌方 X~Ym」）；多条带时界面逐带各出一条。
   */
  foeBands: Array<{ minM: number; maxM: number; type: DamageType; count: number; names: string[] }>
  /** 各单位三层满血量（UI 垂直血条按各自满值比例绘制） */
  maxHp: { me: { s: number; a: number; h: number }; foe: Record<string, { s: number; a: number; h: number }> }
  /** 机群战损（2026-09-10）：本场已击落架数（机型 id → 架数）；缺省 = 无损失 */
  droneLost?: Record<string, number>
  /** 推进器爆发倍率（2026-09-10 船长定：0 = 未装；点火期乘在战斗机动上）——UI 冷却格显示用 */
  thrusterBoost: number
  /** **我方首舰的推进器周期**（2026-09-14 逐单位周期：微型跃迁引擎 = 10 秒点火）——UI 冷却格与倒计时读它 */
  thrusterCycle: { boostMs: number; cooldownMs: number }
  /** 敌方是否有突进资格（威胁 ≥ 门槛 且 近战）——UI「突进中」标记用（未突进时为 false） */
  foeCanCharge: boolean;
  /** **敌方机群**（2026-09-11 机群批 S5）——按敌单位 tag 汇总：机型 id / 机库存量 / **现存架数**。
   *  表现层据此在**敌舰旁**画出警戒机群（与我方机群层共用 `droneArt` 的机体资产）。
   *  **缺省 = 本场没有敌机**（既有战斗零行为变化）。 */
  foeDrones?: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    /** **受击增程已触发**（见 `FoeShipDef.droneRangeMulOnHit`）——表现层把机群阵位后撤、出击线拉长 */
    rangeBuff: boolean
    /** **机库余量**（备用机库：在库待命的架数；2026-09-12 船长「损坏后补充敌机」）——缺省 = 无备用 */
    hangar?: number
  }>
} | null {
  const anomaly =
    override?.anomaly ??
    battleAnomalyOf(ctx, state.expedition.anomalyId, state.expedition.lairTier, state.expedition.factionActive)
  const battle = override?.battle ?? state.expedition.battle
  if (!anomaly || !battle) return null
  const bal = ctx.balance.battle
  const leaderShipId = override?.leaderShipId ?? state.shipId
  const me = createPlayerSpec(state, ctx, leaderShipId, battle.ammoIds) // 弹药 MK2：视图与实际弹种对齐
  if (!me) return null
  const foes = createFoeSpecs(anomaly, bal)
  const ammoLeft = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  const dominant = nextAmmoType(battle.ammo)
  /** 我方各武器当前装填剩余（与 units['player'].weapons 同序；单位缺失 = 空） */
  const meRt = battle.units['player']?.weapons ?? []
  /**
   * 2026-09-10 船长批：无人机逐架条目在弧列表里合并为「机型 ×N」一条（16 架蜂鸟不再 16 条弧/16 条冷却条）。
   * 冷却剩余取组内最小值（任一可开火即视为群就绪）；非无人机条目原样一条。
   */
  const meArcs: Array<{
    label: string
    kind: 'gun' | 'beam' | 'fixed'
    type: DamageType | null
    minM: number
    maxM: number
    reloadMs: number
    src?: WeaponSrc
    artId?: string
    count?: number
    isMain?: boolean
  }> = []
  const meReload: number[] = []
  const droneAt = new Map<string, number>()
  const droneN: number[] = []
  // 主武器（战术距离口径）：与三按钮/射程带/预估同源——弧上米数刻度照它出
  const mainW = mainWeaponOf(me)
  me.weapons.forEach((w, i) => {
    // 2026-09-10 船长「无人机可被击落」：被点防打掉的架次不出现在射程弧/机群计数里
    if (w.src === 'drone' && battle.dronePools?.[i]?.alive === false) return
    let type: DamageType | null = null
    if (w.kind === 'fixed') type = w.fixedType ?? 'kinetic'
    else if (w.kind === 'beam') type = battle.ammo.pla >= Math.max(1, w.count ?? 1) ? 'plasma' : null // 激光吃能量弹药键（按门数）
    else if (ammoLeft > 0) type = dominant // 炮台弹型动态（消耗中可能切换）
    const rem = Math.max(0, Math.floor(meRt[i] ?? 0))
    if (w.src === 'drone') {
      const key = w.artId ?? 'drone'
      const at = droneAt.get(key)
      if (at !== undefined) {
        droneN[at] = (droneN[at] ?? 1) + 1
        meReload[at] = Math.min(meReload[at] ?? rem, rem)
        if (w === mainW) meArcs[at]!.isMain = true // 同机型合并条目：主武器落在组内也标上
        return
      }
      droneAt.set(key, meArcs.length)
      droneN.push(1)
      meArcs.push({
        label: w.label,
        kind: w.kind,
        type,
        minM: w.minRangeM,
        maxM: w.maxRangeM,
        reloadMs: w.reloadMs,
        src: w.src,
        artId: w.artId,
        count: 1,
        ...(w === mainW ? { isMain: true } : {}),
      })
      meReload.push(rem)
      return
    }
    meArcs.push({
      label: w.label,
      kind: w.kind,
      type,
      minM: w.minRangeM,
      maxM: w.maxRangeM,
      reloadMs: w.reloadMs,
      src: w.src,
      count: 1,
      ...(w === mainW ? { isMain: true } : {}),
    })
    meReload.push(rem)
  })
  meArcs.forEach((a, i) => {
    const n = droneN[droneAt.get(a.artId ?? '') ?? -1]
    if (a.src === 'drone' && n !== undefined) {
      a.count = n
      if (n > 1) a.label = `${a.label}×${n}`
    }
  })
  // 我方各武器当前装填剩余已在上面与 meArcs 同步构建（无人机按机型合并、组内取最小值）
  // 敌方整编队聚合：min/max 跨各单位武器取极值（min 以 +∞ 起步——否则 0 初值会把
  // 近盲带最小射程吞成 0，底部"敌方 X~Ym"显示错误，2026-09-08 玩家反馈）
  let foeMin = Number.POSITIVE_INFINITY
  let foeMax = 0
  let foeType: DamageType = 'kinetic'
  /**
   * 敌方**逐射程带**分解（2026-09-11 船长：「战斗场景内，假如敌方的舰船射程不一致，只会显示其中一个的射程」
   * ——指屏幕下方那条「敌方 X~Ym」标签）。上面那条聚合带只够表达"最远的威胁"：编队里短射程的船
   * （如快速艇 1~1883 对头目舰 1~2210）会被并集吃掉、看起来只剩一个射程。这里按
   * (最小射程, 最大射程, 弹种) 分组去重下发，界面照**我方逐武器一条**的同款做法逐带出一条。
   */
  const foeBandMap = new Map<string, { minM: number; maxM: number; type: DamageType; units: number; names: Set<string> }>()
  for (const f of foes) {
    // 同一单位的多件同带武器只算一艘；`count` = **用该带的敌舰艘数**（三艘同名快艇 = 3，不是 1）
    const seenBandOfUnit = new Set<string>()
    for (const w of f.weapons) {
      // **敌机射程要读"实战射程"**（2026-09-12 船长实测反馈：「无人机射程变更后，下方的射程标签内数值
      // 也要变动」）：敌机武器条目的 `maxRangeM` 是**机型射程**（原始值），而实战射程 = 机型射程 ×
      // **受击增程倍率**（`foeDroneRangeOf`，母舰被命中后 ×4）⇒ 标签若读原始值，就会出现
      // "打得着 20km、标签还写 5km"。**与开火射程门同源**（见 `resolvePointDefense` 上游那处）✓
      const wMin = w.minRangeM
      const wMax =
        w.src === 'drone'
          ? foeDroneRangeOf(battle, w)
          : foeGunMaxRangeOf(battle, f, w)
      foeMin = Math.min(foeMin, wMin)
      foeMax = Math.max(foeMax, wMax)
      const type = w.fixedType ?? 'kinetic'
      foeType = type
      const key = `${wMin}|${wMax}|${type}`
      let band = foeBandMap.get(key)
      if (!band) {
        band = { minM: wMin, maxM: wMax, type, units: 0, names: new Set<string>() }
        foeBandMap.set(key, band)
      }
      band.names.add(f.name)
      if (!seenBandOfUnit.has(key)) {
        seenBandOfUnit.add(key)
        band.units += 1
      }
    }
  }
  if (!Number.isFinite(foeMin)) foeMin = 0
  // 外圈在前（远 → 近），同远者近端更小者在前——与界面"从外往里读"一致
  const foeBands = [...foeBandMap.values()]
    .map((b) => ({ minM: b.minM, maxM: b.maxM, type: b.type, count: b.units, names: [...b.names] }))
    .sort((a, b) => b.maxM - a.maxM || a.minM - b.minM)
  const openM = battleOpenM(me, foes, bal)
  // 各单位三层满血量（UI 垂直血条按各自满值比例绘制）：以战斗实况单位为准——
  // 2026-09-09 多波修复：foes 仅按"单波默认"重建，波次增援/多小队单位（w{n}-foe-* 等）不在其内，
  // 曾致后续波敌人血条为空（数值正常）；现优先 battle.units[tag].hpMax（引擎生成时写入），
  // 旧档缺省 hpMax 时以当前血兜底（读档中断局近似满值显示）。
  const foeMaxHp: Record<string, { s: number; a: number; h: number }> = {}
  for (const [tag, u] of Object.entries(battle.units)) {
    if (u.side !== 'foe') continue
    foeMaxHp[tag] = u.hpMax ?? { s: Math.max(0.001, u.hp.s), a: Math.max(0.001, u.hp.a), h: Math.max(0.001, u.hp.h) }
  }
  // 弹药 MK2（2026-09-09）：本场实装弹名（仅当与基础弹不同时提供；UI 兜底用弹型名）
  const ammoNames: Partial<Record<'kin' | 'exp' | 'pla', string>> = {}
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const id = battle.ammoIds?.[t]
    if (!id) continue
    const def = ctx.items.get(id)
    if (def?.name && id !== AMMO_IDS[t]) ammoNames[ammoKeyOf(t)] = def.name
  }
  // 敌方机群（2026-09-11 机群批 S5）：按 tag 汇总"机型 / 机库存量 / 现存架数"给表现层——
  // 敌机与母舰同建同灭（母舰阵亡 ⇒ 其池不再参战），故这里只汇总**当前波存活单位**的池。
  const foeDroneWings: Array<{
    tag: string
    artId: string
    count: number
    alive: number
    /** **受击增程已触发**（2026-09-11 船长）——表现层据此把机群阵位后撤、出击/攻击线拉长 */
    rangeBuff: boolean
  }> = []
  for (const f of foes) {
    const pools = battle.foeDronePools?.[f.tag]
    if (!pools || pools.length === 0) continue
    // **备用机库**（2026-09-12）：在库待命的架次**不算出战架数**（画面不画、血条不计），
    // 单独以 `hangar` 报给界面（可显示"机库余量"）。
    const active = pools.filter((p) => p.inHangar !== true)
    const hangarN = pools.length - active.length
    const byArt = new Map<string, { count: number; alive: number }>()
    for (const p of active) {
      const id = p.artId ?? 'drone'
      const cur = byArt.get(id) ?? { count: 0, alive: 0 }
      cur.count += 1
      if (p.alive) cur.alive += 1
      byArt.set(id, cur)
    }
    for (const [artId, v] of byArt)
      foeDroneWings.push({
        tag: f.tag,
        artId,
        count: v.count,
        alive: v.alive,
        rangeBuff: (battle.foeDroneRangeBuff ?? 1) > 1,
        ...(hangarN > 0 ? { hangar: hangarN } : {}),
      })
  }
  /**
   * **我方编队逐舰读数**（2026-09-13 F 批「4 条舰影 + 血条」的数据源）：
   * 单船路径 = 只有主控一条（`tag='player'`）；多单位路径 = 主控 + 僚舰（各自三层血）。
   */
  const myUnits = (battle.myFleet && battle.myFleet.length > 0
    ? battle.myFleet
    : [{ tag: 'player', shipId: leaderShipId }]
  ).map((e) => {
    const u = battle.units[e.tag]
    const def = ctx.ships.get(uidDefId(e.shipId))
    return {
      tag: e.tag,
      /** **编队 uid**（`船型id#序号`）—— 血条 / 名称 / 装配查找都用它 */
      shipId: e.shipId,
      /**
       * **船型 id**（`sh-thresher` 这种）—— **画舰影必须用它**。
       *
       * ⚠ 2026-09-14 修船长报障「**在虫洞内，友方舰船的图形不正确**」：战斗界面多舰路径原先拿
       * `shipId`（uid）去查 `SHIP_ART` ⇒ `sh-thresher#3` 查不到资产表 ⇒ **退回 role 兜底剪影**
       * （于是洞里 4 条友舰都成了"通用突击舰/作业船"轮廓）。单船路径一直传的是 `ShipDef.id`，
       * 所以只有洞内多舰战斗会错。这里直接把 defId 一并给出去，界面不必再自己拆 uid。
       */
      defId: uidDefId(e.shipId),
      name: shipDisplayName(state, ctx, e.shipId),
      className: def?.name ?? e.shipId,
      leader: e.tag === 'player',
      hp: u ? { ...u.hp } : { s: 0, a: 0, h: 0 },
      hpMax: u?.hpMax ?? { s: 0, a: 0, h: 0 },
      alive: !!u && u.hp.s + u.hp.a + u.hp.h > 0,
      /** 逐舰机群机体清单（见上方类型注释；只算**该舰存活**的池条目） */
      drones: (() => {
        const byArt = new Map<string, number>()
        for (const [k, p] of Object.entries(battle.dronePools ?? {})) {
          if (!p.alive || !p.artId) continue
          if (dronePoolOwner(k) !== e.tag) continue
          byArt.set(p.artId, (byArt.get(p.artId) ?? 0) + 1)
        }
        return [...byArt].map(([artId, count]) => ({ artId, count }))
      })(),
    }
  })
  return {
    nearM: bal.minDistanceM,
    openM,
    foeDesireM: Math.min(openM, foeDesiredRange(me, foes, bal)),
    ammo: { kin: battle.ammo.kin, exp: battle.ammo.exp, pla: battle.ammo.pla },
    ...(Object.keys(ammoNames).length > 0 ? { ammoNames } : {}),
    me: meArcs,
    meReload,
    myUnits,
    foe: { minM: foeMin, maxM: foeMax, type: foeType },
    foeBands,
    maxHp: { me: { s: me.hp.s, a: me.hp.a, h: me.hp.h }, foe: foeMaxHp },
    // 机群战损（2026-09-10）：本场已击落架数（UI 战报/提示用；缺省 = 无损失）
    ...(battle.droneLost && Object.keys(battle.droneLost).length > 0 ? { droneLost: battle.droneLost } : {}),
    // 推进器爆发倍率与敌方突进资格（2026-09-10 船长定）——UI 与引擎同源
    thrusterBoost: me.thrusterBoost ?? 0,
    /** **我方首舰（= 距离/读数锚）的推进器周期**（2026-09-14 逐单位周期后，战斗界面那一格读它） */
    thrusterCycle: unitThrusterCycle(me, bal),
    foeCanCharge: foes.some((f) => f.foeCanCharge === true),
    ...(foeDroneWings.length > 0 ? { foeDrones: foeDroneWings } : {}),
  }
}

/**
 * 预估胜率扩散（logit 空间线性拉伸，k>1）：
 * - 0.5 为不动点（五五开不变）；
 * - 越高的胜率加成越大（如 0.80 → ~0.90），保证"高胜率=高置信"，玩家不会在显示高胜率时
 *   因模型边缘误差而意外翻车；
 * - 越低的胜率惩罚越重（如 0.20 → ~0.10），杜绝"摸奖"式硬闯高难敌人。
 * 只作用于预估展示与 AI 接单门槛；实际战斗按实时引擎结算（随机性不受影响）。
 */
export function spreadWinChance(p: number, k: number): number {
  const t = clamp(0.001, 0.999, p)
  if (k <= 1) return clamp(0.02, 0.98, t)
  const logit = Math.log(t / (1 - t))
  const s = 1 / (1 + Math.exp(-k * logit))
  return clamp(0.02, 0.98, s)
}

/**
 * **四档判定**（2026-09-14 船长定 · 战报改造）。
 *
 * | 情形 | 判定 |
 * |---|---|
 * | 我方全灭 / 结构归零判负（含弃船） | `defeat` → 界面写「⚠ 失利」 |
 * | 未分胜负就中止（结构撤退 / 打满上限超时 / 无法交战 / 主动撤退） | `break` → 「⚠ 脱离」 |
 * | 胜 + **零沉船 且 机群无净损失** | `great` → 「⚔ 大捷」 |
 * | 胜 + **有沉船 或 机群有净损失** | `pyrrhic` → 「⚔ 惨胜」 |
 *
 * 做成**纯函数**是刻意的：渲染层没有测试运行器（`npm test` 只管 core），而这个判定正是船长
 * 报障的那个点（"损失了舰船也显示大捷"）⇒ 只有放进 core 才拦得住。
 */
export type BattleVerdict = 'great' | 'pyrrhic' | 'defeat' | 'break'

export function battleVerdictOf(r: Pick<BattleReportRecord, 'outcome' | 'shipsLost' | 'dronesGone'>): BattleVerdict {
  if (r.outcome === 'break') return 'break'
  if (r.outcome === 'lose') return 'defeat'
  return r.shipsLost.length > 0 || r.dronesGone > 0 ? 'pyrrhic' : 'great'
}

/**
 * **写一份结构化战报**（2026-09-14 船长定 · 战报改造）——**全仓唯一构造点**。
 *
 * 四个结算点各调一次（悬赏远征胜/败/中止 · 低安遭遇胜/败 · 虫洞胜/负 · AI 副船胜/败），
 * 好处是"派生口径只有一份"：沉船名单、逐舰三层残余、敌方残余、弹药消耗都从 `battle` 现算，
 * 各结算点只负责给 `source` / `outcome` / `breakReason` 与**它自己写的那句日志原文**（`summary`）。
 *
 * 口径要点：
 * - `shipsLost`：**调用方给了就用它**（洞内那边已有船长口径的显示名，含自定义船名），否则从
 *   `battle.units` 里按"我方且三层血合计 ≤ 0"推导（与 `wormholeBattle.sunkShipIds` 同一判据）；
 * - `myUnits`：单船路径 = 只有 `player`；多舰路径 = `myFleet` 顺序（主控在前）；
 * - `foe`：`total` = 本场**参战过**的敌单位数（多波战斗含后续波已刷出的），`alive` = 其中三层血
 *   合计 > 0 的，`hpFrac` = Σ当前 ÷ Σ上限；
 * - `ammoUsed` = 开战预载 − 战后余额（`ammoLoaded` 四条路径都在写 ⇒ 四类战斗都算得出）；
 * - `dronesGone`：从 `state.droneLossReport` 读**净损失**（按时刻配对；AI 副船不写它 ⇒ 0）。
 */
export function captureBattleReport(
  state: GameState,
  battle: import('./state').BattleState,
  opts: {
    source: BattleReportSource
    outcome: 'win' | 'lose' | 'break'
    breakReason?: BattleBreakReason
    /** 本场引擎写的那条日志原文（弹层正文用它 ⇒ 卡片与日志同源） */
    summary: string
    /** 覆盖"我方沉船名单"（洞内传船长口径的显示名；缺省 = 从 battle.units 推导） */
    shipsLost?: readonly string[]
  },
): BattleReportRecord {
  const entries = battle.myFleet && battle.myFleet.length > 0 ? battle.myFleet : [{ tag: 'player' }]
  const myUnits: BattleReportRecord['myUnits'] = []
  const derivedLost: string[] = []
  for (const e of entries) {
    const u = battle.units[e.tag]
    if (!u) continue
    const max = u.hpMax ?? u.hp
    myUnits.push({ name: u.name, s: u.hp.s, a: u.hp.a, h: u.hp.h, sMax: max.s, aMax: max.a, hMax: max.h })
    if (u.hp.s + u.hp.a + u.hp.h <= 0) derivedLost.push(u.name)
  }
  let foeTotal = 0
  let foeAlive = 0
  let foeCur = 0
  let foeMax = 0
  for (const u of Object.values(battle.units)) {
    if (u.side !== 'foe') continue
    foeTotal += 1
    const cur = u.hp.s + u.hp.a + u.hp.h
    const max = u.hpMax ?? u.hp
    foeCur += cur
    foeMax += max.s + max.a + max.h
    if (cur > 0) foeAlive += 1
  }
  const loaded = battle.ammoLoaded
  const ammoUsed = loaded
    ? {
        kin: Math.max(0, Math.round(loaded.kin - battle.ammo.kin)),
        exp: Math.max(0, Math.round(loaded.exp - battle.ammo.exp)),
        pla: Math.max(0, Math.round(loaded.pla - battle.ammo.pla)),
      }
    : { kin: 0, exp: 0, pla: 0 }
  const dr = state.droneLossReport
  const dronesGone = dr && dr.battleStartedAtGameMs === battle.startedAtGameMs ? Math.max(0, dr.gone) : 0
  const shipsLost = [...new Set((opts.shipsLost ?? derivedLost).filter((n) => n.length > 0))]
  const rec: BattleReportRecord = {
    battleStartedAtGameMs: battle.startedAtGameMs,
    source: opts.source,
    outcome: opts.outcome,
    ...(opts.breakReason !== undefined ? { breakReason: opts.breakReason } : {}),
    durMs: Math.max(0, battle.lastTickGameMs - battle.startedAtGameMs),
    stats: { ...battle.stats },
    shipsLost,
    myUnits,
    foe: { alive: foeAlive, total: foeTotal, hpFrac: foeMax > 0 ? Math.max(0, Math.min(1, foeCur / foeMax)) : 0 },
    ammoUsed,
    dronesGone,
    summary: opts.summary,
  }
  state.battleReport = rec
  return rec
}

/**
 * P0 承伤持久化：把装甲/结构残余写回船（结构 = 耐久合并属性；护盾不保留）。
 * cap 用该船当前满值（技能/装配同源 createPlayerSpec）——换装后残余按新上限比例折算。
 * 调用方在战斗结束（或手动撤退收场）后、其余结算（失利附加扣损等）之前调用；
 * battle.ended 为空也允许（撤退时记录当前残余）。
 */
export function persistFleetHullDamage(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('./state').BattleState | null,
): void {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return
  // 多单位（虫洞 D 批）：按 `myFleet` 查本船在这场战斗里的 tag（单船路径 = 恒 'player'）
  const tag = battle?.myFleet?.find((e) => e.shipId === shipId)?.tag ?? 'player'
  const unit = battle?.units[tag]
  if (!unit) return
  const cap = createPlayerSpec(state, ctx, shipId)
  if (!cap) return
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  fleetShip.armorPct = cap.hp.a > 0 ? clamp01(unit.hp.a / cap.hp.a) : 1
  fleetShip.durability = cap.hp.h > 0 ? clamp01(unit.hp.h / cap.hp.h) : 0
}

/**
 * 机群战损结算（2026-09-10 船长拍板「无人机可被击落」+ **永久损失制**；
 * 2026-09-11 船长：「当回收损坏的无人机时，**优先回收高价值的**」）：
 * 把本场被点防击落的架数从该船无人机舱清单里**永久扣除**（清单是"带上船的那批"，
 * 本就不在仓库里——扣清单即真实损失），并写事件日志 + 一次性提示（渲染层读到弹 toast）。
 * 胜负/撤退都照扣（打掉的飞机不会因为撤退飞回来）；在 resolveBattleOutcome 等结算入口调用，
 * 且必须在其它结算之前（战报文案要用损失摘要）。
 *
 * **回收分配（2026-09-11 起）**：总回收架数仍 = round(总损坏 × 回收率)（**回收率数值不动**），
 * 但名额的分配改为**优先高价值**：
 *   ①每型先取 floor(损坏数 × 回收率)；
 *   ②余数名额按**机型基准价从高到低**依次补满（某型补到"损坏数"就换下一型）。
 * 排序读 `ctx.items` 的 `baseSellPriceIsk`（不写死顺序，日后调价自动跟随；同价按 id 稳定排序）。
 * 返回损失摘要文案（无损失 = null）。
 */
export function settleDroneLosses(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('./state').BattleState | null,
  /** **回收率加成**（谜质「机群回收网」· F3c B2）：按百分点加在既有回收率上，并夹在 100% 以内。缺省 0 = 既有行为。 */
  recoveryBonus = 0,
  /**
   * **战损归属**（船长 2026-09-14「按舰归属」）：结算哪条舰的机群——键进 `battle.droneLostBy`。
   * 缺省 `'player'`（主控）= 旧口径；老档没有 `droneLostBy` ⇒ 回落到全队合计 `droneLost`（零迁移）。
   */
  ownerTag = 'player',
): string | null {
  const byOwner = battle?.droneLostBy
  const lost = byOwner ? byOwner[ownerTag] : ownerTag === 'player' ? battle?.droneLost : undefined
  if (!lost) return null
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return null
  const rate = droneRecoveryRateWithBonus(state, recoveryBonus)
  const load: Record<string, number> = { ...(fleetShip.droneLoad ?? {}) }

  // ── ① 先算出各型的损坏数（按清单实有数封顶）与基础名额 floor(损坏×回收率) ──
  type Row = { id: string; name: string; value: number; lost: number; back: number }
  const rows: Row[] = []
  let total = 0
  for (const [id, n] of Object.entries(lost)) {
    if (!n || n <= 0) continue
    const def = ctx.items.get(id)
    const cut = Math.min(load[id] ?? 0, n)
    if (cut <= 0) continue
    rows.push({
      id,
      name: def?.name ?? id,
      value: def?.baseSellPriceIsk ?? 0,
      lost: cut,
      back: Math.floor(cut * rate),
    })
    total += cut
  }
  if (total <= 0) return null

  // ── ② 余数名额按价值从高到低补满（总回收数 = round(总损坏 × 回收率)，与旧口径一致）──
  let rest = Math.max(0, Math.round(total * rate) - rows.reduce((s, r) => s + r.back, 0))
  const byValue = [...rows].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  for (const r of byValue) {
    if (rest <= 0) break
    const room = r.lost - r.back
    if (room <= 0) continue
    const add = Math.min(room, rest)
    r.back += add
    rest -= add
  }

  // ── ③ 落库：扣除净损失、回收的留在清单继续服役 ──
  let recovered = 0
  for (const r of rows) {
    const gone = r.lost - r.back
    recovered += r.back
    if (gone > 0) {
      const left = (load[r.id] ?? 0) - gone
      if (left > 0) load[r.id] = left
      else delete load[r.id]
    }
  }
  fleetShip.droneLoad = Object.keys(load).length > 0 ? load : undefined
  // 结算后清空战损账本（调用幂等：重复结算不会重复扣；战报/日志已带损失摘要）
  battle!.droneLost = undefined
  // **逐舰账本也清掉本舰那一份**（2026-09-14「按舰归属」：多舰各结算一次，清掉才能幂等）
  if (battle!.droneLostBy) {
    const rest = { ...battle!.droneLostBy }
    delete rest[ownerTag]
    battle!.droneLostBy = rest
  }

  // 展示口径：具名清单按价值降序（高价值在前，与"优先回收"的观感一致）
  const lostParts = byValue.map((r) => `${r.name}×${r.lost}`)
  const backParts = byValue.filter((r) => r.back > 0).map((r) => `${r.name}×${r.back}`)
  const ratePct = Math.round(rate * 100)
  const text = lostParts.join('、')
  const backTxt =
    backParts.length > 0 ? `，其中 ${backParts.join("、")} 已回收修复归队` : ''
  /**
   * **战报按舰列出**（船长 2026-09-14「战损按舰归属」）：多舰趟次里每艘舰各出一条战损日志，
   * 日志抬头点名是哪条舰（单舰/主控那条不写抬头 ⇒ 与旧文案逐字一致）。
   */
  const who =
    ownerTag === 'player' ? '' : `${state.fleet[shipId] ? shipDisplayName(state, ctx, shipId) : ownerTag}：`
  addLog(
    state,
    'warn',
    `⚠ 机群战损${who ? `（${who.replace(/：$/, '')}）` : ''}：损坏 ${text}（合计 ${total} 架）${backTxt}（回收率 ${ratePct}%，优先回收高价值，净损失 ${total - recovered} 架）——净损失已从无人机舱清单扣除，回港需补充。`,
  )
  state.droneLossNotice =
    recovered > 0
      ? `机群战损：损坏 ${total} 架，回收 ${recovered} 架归队（回收率 ${ratePct}%，优先回收高价值），净损失 ${total - recovered} 架。`
      : `机群战损：${text} 被近防炮击落、共 ${total} 架（回收率 ${ratePct}%，优先回收高价值）——本场没有回收成功，已从无人机舱清单扣除，回港后请补充。`
  // 结构化结果（2026-09-11：战报弹层要显示"回收了哪些、净损失哪些"；与 battle 起手时刻配对，
  // 避免并行会话/AI 战斗的结果串场）——只在**当前驾驶船**的结算里写，AI 副船的损失不进战报
  if (state.shipId === shipId) {
    state.droneLossReport = {
      battleStartedAtGameMs: battle?.startedAtGameMs ?? 0,
      rate,
      total,
      recovered,
      gone: total - recovered,
      rows: byValue.map((r) => ({
        id: r.id,
        name: r.name,
        value: r.value,
        lost: r.lost,
        back: r.back,
        gone: r.lost - r.back,
      })),
    }
  }
  return text
}

/** 多波演出窗口总时长（2026-09-09）：单次大预算推进（胜率 MC/校准工具）把 state.gameMs * 一次设到 maxBattleMs+余量——若波次间隙（waveEnterGapMs，战斗时钟冻结）吃掉余量，末段
 * 跨窗口会提前耗尽预算判负。调用方应在预算外加本值（无 waves = 0）。 */
export function waveGapTotalMs(anomaly: Pick<AnomalyDef, 'waves'> | undefined, bal: BattleBalance): number {
  const n = anomaly?.waves?.length ?? 1
  return Math.max(0, n - 1) * Math.max(0, bal.waveEnterGapMs ?? 0)
}

/** 推进指定战斗（主控远征与 AI 远征通用）；结束后 ended 非空由调用方结算。
 *  favorAdv：AI 远征专属优势量 ∈[−1,1]（null = 玩家手动战斗，无 favor）——
 *  AI 方命中 ×(1+k·adv)（可到 100%），敌方 ×(1−k·adv)（上限保留 97%）。 */
export function advanceBattleFor(
  state: GameState,
  ctx: SimContext,
  battle: import('./state').BattleState,
  shipId: string,
  anomalyId: string | null,
  favorAdv: number | null = null,
  lairTier?: LairTier,
  factionActive?: boolean,
): void {
  if (!battle || battle.ended) return
  const baseAnomaly = battleAnomalyOf(ctx, anomalyId, lairTier, factionActive)
  if (!baseAnomaly) return
  // 虫洞战斗（F 批）：**每拍按层重建**派生敌卡（**与开战同源**——同一处 `wormholeDerivedAnomaly`）
  const anomaly = battle.wormhole
    ? wormholeDerivedAnomaly(ctx, baseAnomaly, battle.wormhole)
    : baseAnomaly
  const bal = ctx.balance.battle
  const myUnits = buildMyUnitSpecs(state, ctx, battle, shipId, anomalyId)
  if (myUnits.length === 0) {
    battle.ended = 'foe'
    return
  }
  const me = myUnits[0]! // 主控：距离 / 期望交距 / favor 等既有口径的锚（单船路径 = 唯一那条）
  const foes = createFoeSpecs(anomaly, bal)
  const foeDesire = foeDesiredRange(me, foes, bal)
  const openM = battleOpenM(me, foes, bal)
  const favor =
    favorAdv === null
      ? null
      : { meMul: 1 + bal.aiFavorStrength * favorAdv, foeMul: 1 - bal.aiFavorStrength * favorAdv }
  // 多波次（2026-09-09）：按 AnomalyDef.waves 分批推进；无 waves = 单波（现行为）
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const lastIdx = waves ? waves.length - 1 : 0
  const specsOf = (wi: number): UnitSpec[] =>
    waves
      ? createFoeSpecs(anomaly, bal, {
          units: waves[wi]!.units,
          hpShare: waves[wi]!.hpShare,
          tagPrefix: wi === 0 ? '' : `w${wi}-`,
        })
      : createFoeSpecs(anomaly, bal)
  let waveIdx = Math.min(battle.waveIdx ?? 0, lastIdx)
  let curFoes = specsOf(waveIdx)
  // 开战首波由 startBattleFor 生成（无装填延迟）；此处只兜读档中断补缺（视为增援入场）
  for (const f of curFoes) {
    // ⚠ 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**带入场触发、条件未命中的单位
    // 不许在这里补缺**——否则每次推进都会把"还没该到的援军"直接塞进战场（本批用例抓到过这个洞）。
    // 它们只由下面的 `resolveReinforcements` 按条件补入；开关关闭时本字段一律不存在 → 本行不生效。
    if (f.foeReinforceAt) continue
    // 读档中断补缺 = 视为"增援入场" ⇒ 同样盖入场窗口（时刻取**全局时钟**，理由同转场那一处）
    seedUnit(battle, f, { enterReload: true, arrivedAtMs: state.gameMs })
  }
  let guard = 0
  while (state.gameMs > battle.lastTickGameMs && !battle.ended && guard < BATTLE_MAX_STEPS) {
    guard++
    // 切波：当前波全灭且还有后续波 → 先走演出窗口（爆炸/残骸播完），窗口结束才续刷下一波。
    // 窗口语义（2026-09-09 船长反馈"切换突兀/爆炸未播完就刷下一波"）：
    // - 清空瞬间记 waveClearAt = 战斗时钟 + waveEnterGapMs；窗口内本拍只停表等待
    //   （battle.lastTickGameMs 不推进——与击杀慢镜同语义：演出时间不计入 maxBattleMs 超时）；
    // - 实时战斗中游戏时钟与墙钟 1:1，窗口 = 上一波最后一艘的爆炸 + 残骸淡出完整播完；
    // - 大步长/离线推进下 state.gameMs 越过窗口即立刻续刷，无额外等待。
    if (waves && waveIdx < lastIdx && !curFoes.some((f) => isAlive(battle, f.tag))) {
      const gapMs = Math.max(0, bal.waveEnterGapMs ?? 0)
      /** **进入本拍时就已经在等**转场窗口（= 真的等过一段，而不是"本拍才发现全灭、本拍就续刷"） */
      const pendingGap = battle.waveClearAt !== undefined
      if (gapMs > 0 && battle.waveClearAt === undefined) {
        battle.waveClearAt = battle.lastTickGameMs + gapMs
        const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
        addLog(
          state,
          'warn',
          `⚔ 第 ${waveIdx + 1}/${waves.length} 波已全灭（${waveName ? waveName + '·' : ''}${anomaly.name}），` +
            (bal.waveReopenEnabled === true ? '敌方增援正在从远处入场…' : '敌方增援正在入场…'),
        )
      }
      if (gapMs > 0 && battle.waveClearAt !== undefined && state.gameMs < battle.waveClearAt) break // 演出窗口未走完：停表等待，下一拍再续
      /**
       * **这一波是不是"真的等过转场窗口"**（`pendingGap`：进入本拍时 `waveClearAt` 就已经在）。
       * 只有它为真时才盖入场窗口（船长 2026-09-14「动画没结束不开火」）：
       * - **实时**：清空那一拍先记 `waveClearAt` 并 `break`，等 33 拍后才走到这里 ⇒ **等过** ⇒ 有动画、给窗口；
       * - **大步长 / 离线补算**：一次推进就跨过了整个窗口（本拍才发现全灭、`state.gameMs` 一上来就 ≥
       *   `waveClearAt`）⇒ **没等过**、玩家根本没看见过转场（也就没有动画可言）⇒ **不盖窗口**，
       *   行为与改动前逐字一致（否则"离线结算时最后一波敌人免疫到本次推进结束"⇒ 该赢的场次会被
       *   拖成超时判负——`tests/wave-battle.test.ts` 的大步长用例抓到过）；
       * - `waveEnterGapMs = 0`（无转场节拍）⇒ 同样不盖（没有转场演出，也就没有入场动画）。
       */
      const waitedGap = pendingGap
      battle.waveClearAt = undefined
      waveIdx += 1
      battle.waveIdx = waveIdx
      curFoes = specsOf(waveIdx)
      // 增援入场装填（转场窗口）+ **入场窗口**（船长 2026-09-14「动画没结束不开火」）：
      // 逐舰错峰写进 `enteredAtMs`，与界面 `--arrive-delay` 同一算式 ⇒ 动画演完才可被选中。
      // ⚠⚠ **入场时刻取 `state.gameMs`（全局时钟 / 本帧结束时的推进目标），绝不能取 `battle.lastTickGameMs`**
      //   ——转场窗口内战斗时钟是**冻住**的（上面那条"停表等待"），此刻它还是"上一波全灭那一刻"的值；
      //   本帧收尾时战斗时钟会**追平**全局时钟（实测：一帧内推进了 3300ms）⇒ 拿冻住的值当"现在"
      //   会把窗口算到**过去**（真 BUG：窗口一出生就已过期、新一波照样在登场那一拍被打死）。
      //   按全局时钟算 ⇒ 窗口 = **追平之后实实在在的 950ms**（实测：14800 入场 → 15900 才掉第一滴血）。
      if (waitedGap) {
        curFoes.forEach((f, i) =>
          seedUnit(battle, f, { enterReload: true, arrivedAtMs: state.gameMs + i * BATTLE_ARRIVAL_STAGGER_MS }),
        )
      } else {
        curFoes.forEach((f) => seedUnit(battle, f, { enterReload: true }))
      }
      // 近防炮调度随波重建（pdCd 与敌编队同序）
      if (battle.pdCd && battle.dronePools) {
        battle.pdCd = curFoes.map(() => Math.max(100, Math.round(bal.pdJudgementMs)))
      }
      // 敌机机群随波重建（2026-09-11 机群批）：每波单位是新对象、tag 也不同 ⇒ 旧池自然作废
      initFoeDronePools(battle, curFoes);
      // 波次转场（2026-09-09 船长建议）：把战斗距离向开战距离回拉 waveReopenFrac 比例——
      // 增援从"更远的接战距离"进入，双方重新接近（重演接近期，kite/远程敌同样被拉回）；
      // 0 = 原地续战（旧行为），1 = 完整回到开战距离
      // ⚠ **2026-09-11 船长：「将敌人增援波次距离会后退的惩罚暂时关闭」** ⇒ 本段由**总开关
      //   `waveReopenEnabled`** gate（现值 false = 关闭）：关闭时**距离原地不动**，下一波在当前交战距离入场，
      //   玩家可见日志同步改为中性表述（不再说"从远处入场 / 重新接近中"——否则文案与实际不符）。
      //   机制整套保留：把开关改回 true 即恢复 2026-09-09 口径。
      const reopenOn = bal.waveReopenEnabled === true
      const reopen = reopenOn ? (bal.waveReopenFrac ?? 0) : 0
      if (reopen > 0 && Number.isFinite(openM)) {
        battle.distanceM = Math.round(openM * reopen + battle.distanceM * (1 - reopen))
      }
      const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
      addLog(
        state,
        'warn',
        `⚔ 第 ${waveIdx + 1}/${waves.length} 波来袭（${waveName ? waveName + '·' : ''}${anomaly.name}）：` +
          (reopenOn ? '敌方增援自远处入场，重新接近中。' : '敌方增援入场。'),
      )
      continue
    }
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）——每拍结算"尚未入场"的编成条目；
    // 放在 `stepBattle` **之前**：上一拍刚打死的单位本拍即可触发援军，且判胜检查看到的是补入后的编队。
    // 总开关关闭时本函数第一步就返回（且建档期也没写过 `foeReinforceAt`）= 零行为变化。
    resolveReinforcements(state, ctx, battle, anomaly, curFoes, bal, openM)
    const dt = Math.min(BATTLE_STEP_MS, state.gameMs - battle.lastTickGameMs)
    stepBattle(
      state,
      battle,
      myUnits,
      curFoes,
      foeDesire,
      openM,
      bal,
      dt,
      favor,
      waves ? waveIdx < lastIdx : false,
      // 敌方选靶模式（虫洞内敌卡专属；缺省 random）——单船路径不消费选靶随机数，见 pickMyUnitTarget
      anomaly.foeTargeting ?? 'random',
      // 倾向概率（2026-09-14 船长定 0.6；缺省 1 = 铁律 ⇒ 洞外场次连一次骰都不掷）
      anomaly.foeTargetingChance ?? 1,
    )
    battle.lastTickGameMs += dt
    // 连续作战保险（2026-09-08 船长定，仅巡回场次 battle.hullEscapeFrac 有值）：
    // 本场结构损失过半（剩余 < 满值结构 × 阈值）→ 中止步进并请求自动撤退，绝不拖到弃船
    if (!battle.autoEscaped && battle.hullEscapeFrac !== undefined) {
      const pl = battle.units['player']
      if (pl && pl.hp.h < me.hp.h * battle.hullEscapeFrac) {
        battle.autoEscaped = true
        battle.escapeReason = 'hull'
        break
      }
    }
    // 船体维修装置脉冲（2026-09-09）：本拍内到期的脉冲补齐——修复发生在受伤结算之后
    // （≤1 拍延迟，保守口径）；战斗结束/自动撤退后不再补跳
    if (!battle.ended && battle.repair?.nextPulseAtMs !== undefined && battle.repair.nextPulseAtMs <= battle.lastTickGameMs) {
      let guardR = 0
      while (
        !battle.ended &&
        battle.repair.nextPulseAtMs !== undefined &&
        battle.repair.nextPulseAtMs <= battle.lastTickGameMs &&
        guardR < BATTLE_MAX_STEPS
      ) {
        pulseRepairs(state, ctx, battle, me)
        guardR++
      }
    }
    // 护盾充能装置脉冲（2026-09-14 船长）：与维修装置**各按各的计时**（30 秒 vs 5 秒），
    // 同样在受伤结算之后补跳（≤1 拍延迟）；破盾后它是唯一能把盾点起来的路径。
    if (
      !battle.ended &&
      battle.shieldCharge?.nextPulseAtMs !== undefined &&
      battle.shieldCharge.nextPulseAtMs <= battle.lastTickGameMs
    ) {
      let guardS = 0
      while (
        !battle.ended &&
        battle.shieldCharge.nextPulseAtMs !== undefined &&
        battle.shieldCharge.nextPulseAtMs <= battle.lastTickGameMs &&
        guardS < BATTLE_MAX_STEPS
      ) {
        pulseShieldCharge(battle, me)
        battle.shieldCharge.pulses += 1
        battle.shieldCharge.nextPulseAtMs += SHIELD_PULSE_MS
        guardS++
      }
    }
  }
}

/** 推进当前主控远征的战斗（到耗尽时间或分出胜负） */
export function advanceBattle(state: GameState, ctx: SimContext): void {
  const battle = state.expedition.battle
  if (battle) advanceBattleFor(state, ctx, battle, state.shipId, state.expedition.anomalyId)
}

/* ══════════ 机群战损（2026-09-10 船长拍板「无人机可被击落」，永久损失制） ══════════ */

/** 无人机线技能系数（2026-09-10 船长：四条新技能；接线点集中在此，改数值 = 同步 skills.ts 的 ⟦…⟧） */
export const DRONE_SKILL = {
  /** 无人机作战学：单发伤害 +5%/级（既有） */
  warfarePerLevel: 0.05,
  /** 无人机打击学：单发伤害再 +4%/级（与作战学乘算，满级再 ×1.2） */
  strikePerLevel: 0.04,
  /** 无人机耐久学（基础档）：三层血量 +4%/级（满级 +20%） */
  durabilityPerLevel: 0.04,
  /** 无人机强化学（进阶档）：三层血量再 +6%/级（满级再 +30%；与耐久学**乘算** → 双满 ×1.56） */
  reinforcePerLevel: 0.06,
  /** 无人机规避学：闪避 +2%/级（满级 +10%；相对乘算，闪避封顶 0.9） */
  evasionPerLevel: 0.02,
  /** 无人机回收学：战后回收损坏机体，基础 20% + 6%/级（满级 50%）——2026-09-10 船长定：基础 10%→20%、满级仍 50% */
  recoveryBase: 0.2,
  recoveryPerLevel: 0.06,
  recoveryMax: 0.5,
} as const

/** 无人机技能等级读取（0~5） */
function droneSkillLv(state: GameState, id: string): number {
  return Math.min(5, state.skills.trained[id] ?? 0)
}

/** 战后损坏机体的回收比例（2026-09-10 船长：基础 20%，回收学满级 50%） */
/**
 * **回收率（含谜质加成）**（F3c B2 · 船长：「机群回收网」）：既有回收率 + 装置加成，
 * **夹在 100% 以内**（物理上限：回收率是比例）。单点抽出 ⇒ 用例可直接验这条口径。
 */
export function droneRecoveryRateWithBonus(state: GameState, bonus = 0): number {
  return Math.min(1, droneRecoveryRate(state) + Math.max(0, bonus))
}
export function droneRecoveryRate(state: GameState): number {
  const rate = DRONE_SKILL.recoveryBase + DRONE_SKILL.recoveryPerLevel * droneSkillLv(state, 'drone-recovery')
  return Math.min(DRONE_SKILL.recoveryMax, rate)
}

/** 该威胁的敌舰是否装近防炮（威胁 < pdThreatFloor 不装；2026-09-10 船长：60） */
export function pdEnabledFor(threat: number, bal: BattleBalance): boolean {
  return threat >= bal.pdThreatFloor
}
/**
 * **建敌机生存池**（2026-09-11 机群批）——按**敌单位 tag** 索引；池数组与本单位 `src:'drone'`
 * 武器条目**同序**（`slot` 顺序、每条展开 `count` 架，与 `createFoeSpecsFromShips` 的展开顺序一致）。
 *
 * - 三层血 / 抗性 / 回避取自**机型表**（`FoeDroneDef.defense`，绝对值）；我方无人机线技能
 *   （耐久学/强化学/规避学）**只作用于我方机群**，敌机不吃——族格由机型表定死，与玩家技能无关；
 * - **开战与每次换波都调用**（每波单位是新对象、tag 也不同 ⇒ 旧波的池自然作废）；
 * - **无 `foeDrones` 的单位不建池**；全场都没有 ⇒ 本字段不写（既有战斗零行为变化）。
 */
function initFoeDronePools(
  b: import('./state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const pools: Record<string, import('./state').DronePoolEntry[]> = {}
  for (const f of foes) {
    const slots = f.foeDrones
    if (!slots || slots.length === 0) continue
    const list: import('./state').DronePoolEntry[] = []
    const mk = (
      d: (typeof slots)[number]['drone']['defense'],
      artId: string,
      inHangar: boolean,
    ): import('./state').DronePoolEntry => {
      const resists = {
        ...(d.shieldResist ? { shield: d.shieldResist } : {}),
        ...(d.armorResist ? { armor: d.armorResist } : {}),
        ...(d.hullResist ? { hull: d.hullResist } : {}),
      }
      const s = Math.max(1, Math.round(d.shieldHp))
      const a = Math.max(1, Math.round(d.armorHp))
      const h = Math.max(1, Math.round(d.hullHp))
      return {
        s,
        a,
        h,
        alive: true,
        artId,
        evasion: clamp(0, 0.9, d.evasion ?? 0),
        ...(Object.keys(resists).length > 0 ? { resists } : {}),
        // 满血三层值（备用机补位按此放出）；缺省字段仅供新档，旧档缺省即视为"当前血 = 满血"
        maxS: s,
        maxA: a,
        maxH: h,
        ...(inHangar ? { inHangar: true } : {}),
      }
    }
    for (const ds of slots)
      for (let k = 0; k < Math.max(0, Math.round(ds.count)); k++)
        list.push(mk(ds.drone.defense, ds.drone.id, false))
    // **备用机库**（2026-09-12）：同机型的额外条目，开局全部在库（不出战、不开火、不计存活架数）
    const reserve = f.foeDroneReserve
    const reserveModel = slots[0]?.drone
    if (reserve && reserveModel)
      for (let k = 0; k < Math.max(0, Math.round(reserve.count)); k++)
        list.push(mk(reserveModel.defense, reserveModel.id, true))
    if (list.length > 0) pools[f.tag] = list
  }
  if (Object.keys(pools).length > 0) b.foeDronePools = pools
}

/** **单次出击（分批放飞）的"在空窗口"**（2026-09-12 船长「限制敌机单次出击数量」）——
 *  按**在场架次列表**轮换：每 `cycleMs` 换一批，每批最多 `maxAloft` 架在空（其余在机库待命）。
 *  `cycleMs` 缺省 = 机型装填时长（一批打完换下一批）。
 *  ⚠ 纯**由战斗时钟推导**（`startedAtGameMs` 起算）⇒ **不新增存档字段**；
 *  触发增程/备用补位都会自然改变"在场列表"，窗口随之重排。 */
function aloftDroneSet(
  pools: readonly import('./state').DronePoolEntry[],
  launch: { maxAloft: number; cycleMs?: number },
  reloadMs: number,
  b: import('./state').BattleState,
): ReadonlySet<number> {
  const active: number[] = []
  for (let i = 0; i < pools.length; i++) {
    const p = pools[i]!
    if (p.alive && p.inHangar !== true) active.push(i)
  }
  const out = new Set<number>()
  if (active.length === 0) return out
  const k = Math.max(1, Math.min(Math.round(launch.maxAloft), active.length))
  const cycle = Math.max(200, launch.cycleMs ?? reloadMs)
  const elapsed = Math.max(0, b.lastTickGameMs - b.startedAtGameMs)
  const batch = Math.floor(elapsed / cycle)
  const start = (batch * k) % active.length
  for (let j = 0; j < k; j++) out.add(active[(start + j) % active.length]!)
  return out
}

/** **敌机有效射程**（单一真相源）＝机型绝对射程 × **全敌队的受击增程倍率**（未触发 = ×1）。
 *
 *  2026-09-11 船长：「添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」——
 *  E 族三条舰级写 `droneRangeMulOnHit: 4` ⇒ 警戒机 5,000 → **20,000m**（本场永久、不封顶）；
 *  **全敌队一次生效**（船长二次裁定：「只触发一次，**对所有敌舰生效**」）。
 *  ⚠ **开火判定与界面（机群阵位/弹道/击落点）都读本函数**：射程只有一处算法，不出现"打得着但画得近"。
 */
export function foeDroneRangeOf(
  b: import('./state').BattleState,
  w: WeaponSpec,
): number {
  const mul = b.foeDroneRangeBuff
  return mul && mul > 1 ? Math.round(w.maxRangeM * mul) : w.maxRangeM
}

/** **受击增程**触发器（只由"我方武器**命中敌舰本体**"调用——打机群 / 未命中都不算）。
 *
 *  ⚠ **全敌队一次生效**（船长二次裁定：「每个敌人都会单独触发一次射程增加的文字提示，理论上应该
 *  **只触发一次**，**对所有敌舰生效**」）：命中**任一**带该机制的敌舰 ⇒ 给**整支敌队**盖章
 *  （状态是标量 `battle.foeDroneRangeBuff`），此后所有敌舰的机群都吃倍率；提示**只推一条**。
 *  **一次触发即本场永久**（值即倍率，不存时间戳）。
 *  @returns 是否本次**首次**触发（首次才推画面提示） */
function markFoeDroneRangeBuff(
  rt: UnitSpec,
  b: import('./state').BattleState,
): boolean {
  const mul = rt.foeDroneRangeMulOnHit
  if (mul === undefined || mul <= 1) return false
  if (!rt.foeDrones || rt.foeDrones.length === 0) return false
  const cur = b.foeDroneRangeBuff
  if (cur !== undefined && cur >= mul) return false // 已触发过（整队共享）⇒ 不重复盖章、不重复提示
  b.foeDroneRangeBuff = mul
  return true
}

/* ═══════════ 敌方炮台受击增程（2026-09-12 船长：给 D 族静滞卫舰"挨打后射程增加 50%"）═══════════
 * 与上面机群那条**同款触发、不同作用面**：
 * - **触发**：任一"带 `foeGunRangeMulOnHit` 的敌舰"**被命中一次** ⇒ 在 `BattleState.foeGunRangeBuff`
 *   上盖章一次（打机群不算、未命中不算；**本场永久**、**只推一条**画面提示）；
 * - **生效面**：**只有带该字段的敌舰**（= 所有静滞卫舰）；同场的其它舰级（守墓长舰等）**不受影响**
 *   —— 船长原话「**仅影响所有静滞卫舰**」。⚠ 与 E 族那条（"**整支敌队的机群** ×4"）是**两套独立状态**，
 *   互不覆盖；
 * - **口径（船长选「乙」）**：只延长**最远射程**、近界不动；**原射程内的命中/伤害折减一字不变**，
 *   延长段按**同斜率**继续线性衰减（12 km 处仍 ×0.5，18 km 处 ≈ ×0.20，而非趴在 falloff 平台上）。
 * ⚠ **射程与折减都只有这一处算法**：开火射程门、命中/伤害衰减、战斗界面底部射程标签三处共用
 *   （教训来自 2026-09-12「无人机射程变更后标签没跟着变」那次实测反馈）。 */

/** 该敌舰当前的**炮台增程倍率**（未带字段 / 未触发 = 1） */
export function foeGunRangeMulOf(
  b: import('./state').BattleState,
  unit: { foeGunRangeMulOnHit?: number },
): number {
  const mul = unit.foeGunRangeMulOnHit
  if (mul === undefined || mul <= 1) return 1
  const buff = b.foeGunRangeBuff
  return buff !== undefined && buff > 1 ? buff : 1
}

/** 该敌舰武器的**有效最远射程**（开火门与界面标签共用；未触发 = 原值） */
export function foeGunMaxRangeOf(
  b: import('./state').BattleState,
  unit: { foeGunRangeMulOnHit?: number },
  w: { maxRangeM: number },
): number {
  const mul = foeGunRangeMulOf(b, unit)
  return mul > 1 ? Math.round(w.maxRangeM * mul) : w.maxRangeM
}

/** 该敌舰武器的**距离折减**（船长选乙：原区间内 = 原公式，逐字一致；延长段同斜率外推、下限 0） */
export function foeGunPowerFactorOf(
  b: import('./state').BattleState,
  unit: { foeGunRangeMulOnHit?: number },
  w: { minRangeM: number; maxRangeM: number; falloff: number },
  dist: number,
): number {
  const base = distFactor(dist, w) // 原区间内 = 原读数（一字不变）
  if (foeGunRangeMulOf(b, unit) <= 1 || dist <= w.maxRangeM) return base
  const span = Math.max(1, w.maxRangeM - w.minRangeM)
  const slope = (1 - w.falloff) / span
  return Math.max(0, base - slope * (dist - w.maxRangeM))
}

/** **炮台受击增程**触发器（只由"我方武器**命中敌舰本体**"调用——打机群 / 未命中都不算）。
 *  @returns 是否本次**首次**触发（首次才推画面提示） */
function markFoeGunRangeBuff(rt: UnitSpec, b: import('./state').BattleState): boolean {
  const mul = rt.foeGunRangeMulOnHit
  if (mul === undefined || mul <= 1) return false
  const cur = b.foeGunRangeBuff
  if (cur !== undefined && cur >= mul) return false // 该型舰共享 ⇒ 不重复盖章、不重复提示
  b.foeGunRangeBuff = mul
  return true
}

/** **战斗内提示条**（画面顶部提示位，与「敌方增援」同一处显示）——2026-09-11 船长二次裁定：
 *  「**日志内不用显示提示，将该提示放入战斗画面内显示**（和敌方增援统一下系统，**显示位置改为战斗
 *  窗口正上方**）」⇒ 机制提示**不写 `addLog`**，改推这里；UI 按 `atMs` 限时显示后自动消失。
 *  只保留最近 4 条（提示位是"当前正在发生的事"，不是留档——留档归战报）。 */
function pushBattleNotice(b: import('./state').BattleState, text: string): void {
  b.notices = [...(b.notices ?? []), { atMs: b.lastTickGameMs, text }].slice(-4)
}

/**
 * 近防炮可选靶（存活放飞条目下标）：
 * - 哨戒机**优先**（`pdPriorityOf` = 0），但**要进射程**才算候选（2026-09-12 船长改判：
 *   原 2026-09-10「近防炮不打哨戒无人机」**已作废**；见 `PD_PRIORITY_BY_ART` 与 `PD_SENTRY_RANGE_M`）；
 * - **非哨戒机全被摧毁后，近防炮转而攻击哨戒机**（2026-09-10 船长追加）——
 *   即"机群里还有别的机型就先打别的，只剩哨戒机时才打它"。
 */
function aliveDroneKeys(
  b: import('./state').BattleState,
  sentryIds: ReadonlySet<string> = SENTRY_DRONE_IDS,
  sentriesInRange = false,
  sentryOnly = false,
): string[] {
  const pools = b.dronePools
  if (!pools) return []
  const others: string[] = []
  const sentries: string[] = []
  for (const [k, p] of Object.entries(pools)) {
    if (!p.alive) continue
    if (p.artId && sentryIds.has(p.artId)) sentries.push(k)
    else others.push(k)
  }
  // **船长 2026-09-11：关闭"哨戒机可被攻击"的机制**（代码保留、不删）——常驻伴飞的哨戒机停在
  // 母舰旁、**从不飞到敌方** ⇒ **永不被攻击**；**只有出击型（会飞到敌舰旁的那些）才会挨打**。
  // 置 `PD_TARGET_SENTRIES = true` 即恢复旧口径（非哨戒机全灭后转而打哨戒机）。
  // **哨戒机：只在近防炮射程内才可被反击**（船长 2026-09-11 重新定义）——
  // 出击型不受此限，它们的反击由"被攻击"驱动（令牌见 resolvePointDefense）。
  if (sentryOnly) return sentries
  if (!sentriesInRange) return others
  return [...others, ...sentries]
}

/**
 * **哨戒机是否可被攻击**（船长 2026-09-11：「将之前新增的哨戒无人机会被攻击的机制**关闭（不是删除）**。
 * **只有靠近敌方的无人机会被攻击**」）。`false` = 关闭（现值）；改 `true` 即恢复旧行为。
 */
const PD_TARGET_SENTRIES = false

/**
 * **反应式防空的窗口（毫秒）**（船长 2026-09-11：「**每轮都是被攻击后才开火**」）——
 * 近防炮只在'**刚被机群打过**'的这段时间内还手；超窗脱锁，等下一轮被打再开火。
 * 取 5,000ms：略长于敌机装填（4,400ms）⇒ **每一轮敌机攻击都换来一次反击窗口**。
 */
const PD_REACTIVE_WINDOW_MS = 5_000

/**
 * **哨戒机可被反击的射程（米）**（船长 2026-09-11 重新定义近防炮）——
 * · **非哨戒机（出击型）**：**攻击一次 ⇒ 换一次无视射程的反击**（它们扑到敌方去，永远够得着）；
 * · **哨戒机**：不适用'被攻击换反击'，而是**进入近防炮射程内**就会被反击
 *   （它常驻自己母舰旁 ⇒ 平时安全；两舰贴到 2,500m 以内它就暴露）。
 * 取 2,500m ＝ 我方近防炮射程 ⇒ **两侧同口径**。
 */
const PD_SENTRY_RANGE_M = 2_500

/** 哨戒机机型 id（**2026-09-12 起为"优先打击"而非"排除"**；机型表变化时此处同步） */
const SENTRY_DRONE_IDS: ReadonlySet<string> = new Set(['drone-sentry'])

/** 存活放飞条目**键**（近防炮选靶 / 开火跳过共用）——2026-09-14 起返回 `舰tag:下标`（逐舰机群）；
 *  `droneTotalCount` 已随"取消单场上限"移除用途 */

/** **机群池键**（2026-09-14 船长「逐舰机群」）：`舰tag:武器条目下标`。
 *  老档的**纯数字键**（只有主控）由 `save.ts` 归一成 `player:<下标>`（零迁移）。 */
export function dronePoolKey(tag: string, wi: number): string {
  return `${tag}:${wi}`
}
/** 池键 → 所属舰 tag（老档/异常键一律算 `player`） */
export function dronePoolOwner(key: string): string {
  const i = key.indexOf(':')
  return i > 0 ? key.slice(0, i) : 'player'
}

/**
 * **建一艘船自己的机群生存池**（2026-09-14 船长「逐舰机群」）：按该舰 `weapons` 里 `src='drone'`
 * 的条目逐条建（键 = `舰tag:下标`），机型三层血/抗性/闪避取自物品本体（`DroneDefense`）。
 * `durMul`/`evaMul` = 无人机线技能（耐久学 × 强化学 乘算 / 规避学）的既有系数，由调用方算一次传进来。
 */
function buildDronePoolsFor(
  ctx: SimContext,
  spec: UnitSpec,
  pools: Record<string, import('./state').DronePoolEntry>,
  durMul: number,
  evaMul: number,
): void {
  const tag = spec.tag ?? 'player'
  spec.weapons.forEach((w, i) => {
    if (w.src !== 'drone' || !w.artId) return
    const d = ctx.items.get(w.artId)?.defense
    pools[dronePoolKey(tag, i)] = {
      owner: tag,
      s: Math.max(1, Math.round((d?.shieldHp ?? 1) * durMul)),
      a: Math.max(1, Math.round((d?.armorHp ?? 1) * durMul)),
      h: Math.max(1, Math.round((d?.hullHp ?? 1) * durMul * (1 + (spec.droneHullBonusPct ?? 0)))),
      alive: true,
      artId: w.artId,
      evasion: clamp(0, 0.9, (d?.evasion ?? 0) * evaMul),
      ...(d
        ? {
            resists: {
              ...(d.shieldResist ? { shield: d.shieldResist } : {}),
              ...(d.armorResist ? { armor: d.armorResist } : {}),
              ...(d.hullResist ? { hull: d.hullResist } : {}),
            },
          }
        : {}),
    }
  })
}

/** 本场已击落架数 */
export function droneLostCount(b: import('./state').BattleState): number {
  return Object.values(b.droneLost ?? {}).reduce((s, n) => s + n, 0)
}

/** 近防炮选靶优先级（2026-09-12 船长：「**优先攻击哨戒和攻坚无人机**」「侦查和普通战机相同权重抽取」）：
 *  `0` = 最高（哨戒机）· `1`（攻坚机）· `2` = 其余（侦察机 / 战斗机 / 专属机等，**彼此等权**）。
 *
 *  ⚠ **两侧共用本函数、查表轴不同**（P-40 收口时发现）：**敌方侧**打的是**我方机型**（id 稳定、
 *  表里有登记）⇒ 按**机型 id** 命中；**我方侧**打的是**敌方机型**（不受本表约束，且日后才可能加
 *  哨戒/攻坚机型）⇒ 查不到时**退回按 `role` 判档**（`sentry` → 0 / `assault` → 1），加机型即生效。
 *  ⚠ 哨戒机另受"进 `PD_SENTRY_RANGE_M`（我方侧 = 本武器射程）才暴露"的约束（船长 2026-09-11 重新定义）。 */
const PD_PRIORITY_BY_ART: Record<string, number> = {
  'drone-sentry': 0,
  'drone-heavy': 1,
}
function pdPriorityOf(artId: string | undefined | null, role?: string): number {
  const byArt = artId ? PD_PRIORITY_BY_ART[artId] : undefined
  if (byArt !== undefined) return byArt
  if (role === 'sentry') return 0
  if (role === 'assault') return 1
  return 2
}

/**
 * 近防炮结算（每拍调用；2026-09-10 船长口径 · **2026-09-12 八条裁决改版**）：
 * - 每艘点防舰**独立**按 `pdJudgementMs`（0.5s）判定一次 ⇒ **判定频率 = 火力密度**（反击制只决定"能不能开火"）；
 * - **集火**（船长 2026-09-12）：锁定一架直到它被击落才换靶（旧口径 = 每拍随机换靶 ⇒ 伤害摊薄到整群、几乎打不掉）；
 * - **选靶优先级**：**哨戒机 → 攻坚机 → 其余等权抽取**（侦察机与战斗机同权）；
 *   ⚠ **前提：哨戒机必须在近防炮射程内**（船长 2026-09-12：「**优先攻击哨戒机的前提是哨戒在射程内**」）——
 *   哨戒机**只有 `distanceM ≤ PD_SENTRY_RANGE_M`（2,500m）时才进候选池**（见 `aliveDroneIndices`：
 *   `if (!sentriesInRange) return others`）⇒ 两舰拉开距离时它**既不可选、也不占优先级**，
 *   优先级自然落到"攻坚机 → 其余"；**集火锁**同样在它出射程那一刻解除（候选池里没有它了）。
 * - 命中 = `clamp(pdHitFloor, 1, pdAcc − 机型闪避)`（**下限 10%**，修掉"闪避 ≥ pdAcc ⇒ 永久免疫"）；
 * - 伤害 = `pdDmg × 舰种档系数(pdTierMul)`（**越大的船防空越强**：T1 1.0 / T3 2.0 / T5 4.0），
 *   再走该机型三层抗性；血量打空 = 该架本场击落（停火 + 计入 droneLost + 击落演出）；
 * - **两条独立开火许可**（2026-09-12 **修 bug**）：旧代码要求"哨戒机在射程内"**并且**有令牌，
 *   等于把"出击型打一次换一次反击"整条路掐死（出击型机群永远不会被反击、实测战损恒为 0）：
 *   a) **反击令牌**：我方无人机打过敌舰 ⇒ 窗口内还手（**无视距离**，船长 2026-09-11 口径）；
 *   b) **哨戒机在射程内**：常驻暴露 ⇒ 不需令牌即可还手（船长 2026-09-11 重新定义）；
 * - **不看距离**（放飞出去就在威胁之下）；**战斗内可 100% 损坏**（战后按回收率找回一部分）；
 * - 近防炮不参与敌舰对玩家的常规攻击（独立系统）；全程消费 state.rng，确定性可复现。
 */
function resolvePointDefense(
  state: GameState,
  b: import('./state').BattleState,
  foes: UnitSpec[],
  bal: BattleBalance,
  dtMs: number,
): void {
  const pools = b.dronePools
  // 无近防炮调度 = 本场敌舰未达威胁门槛（或本改动前的旧战斗）：不结算
  if (!pools || b.pdCd === undefined) return;
  const period = Math.max(100, Math.round(bal.pdJudgementMs))
  // ⚠ **哨戒机只在射程内可选/可被反击**（船长 2026-09-11 重新定义）
  const sentryOk = b.distanceM <= PD_SENTRY_RANGE_M
  // 许可 a：**反击令牌**（我方无人机打过敌舰 ⇒ 窗口内还手，**无视距离**）
  const foeHitAt = b.droneHitAt?.foe
  const tokenOpen =
    foeHitAt !== undefined && b.lastTickGameMs - foeHitAt <= PD_REACTIVE_WINDOW_MS
  // 许可 b：**哨戒机在射程内**（不需令牌）
  const sentryOpen =
    sentryOk && aliveDroneKeys(b, SENTRY_DRONE_IDS, true, true).length > 0
  if (!tokenOpen && !sentryOpen) return
  // **消费制**（船长 2026-09-11）：一次攻击换一次还手（对每艘点防舰各一次）
  if (tokenOpen) b.droneHitAt = { ...(b.droneHitAt ?? {}), foe: undefined }
  const focus: Array<string | undefined> = b.pdFocus ? [...b.pdFocus] : []
  for (let fi = 0; fi < foes.length; fi++) {
    if (!isAlive(b, foes[fi]!.tag)) continue
    let cd = (b.pdCd[fi] ?? period) - dtMs
    let guard = 0
    while (cd <= 0 && guard < 64) {
      guard++
      cd += period;
      // 候选 = 存活放飞条目（哨戒机**只在射程内**可选）
      const candsAll = aliveDroneKeys(b, SENTRY_DRONE_IDS, sentryOk)
      if (candsAll.length === 0) break
      /**
       * **逐舰各自挨打**（船长 2026-09-14）：本舰先选**一条舰**、再在该舰机群里按优先级选机。
       * · 选舰 = **等权随机**（与"机型等权抽取"同族，不引入新的距离口径——近防炮打机群本就不看两舰间距）；
       * · **集火**（船长 2026-09-12）沿用同一把锁：上次锁的**池键**仍可选 ⇒ 继续打那一架；
       *   否则**重新选舰**再按优先级（哨戒 → 攻坚 → 其余等权）选机。
       */
      const owners = [...new Set(candsAll.map(dronePoolOwner))]
      const lockedKey = focus[fi]
      const owner =
        lockedKey !== undefined && candsAll.includes(lockedKey)
          ? dronePoolOwner(lockedKey)
          : pickOne(state.rng, owners)!
      const cands = candsAll.filter((k) => dronePoolOwner(k) === owner)
      let key = focus[fi] !== undefined && cands.includes(focus[fi]!) ? focus[fi]! : undefined
      if (key === undefined) {
        const best = Math.min(...cands.map((k) => pdPriorityOf(pools[k]!.artId)))
        const tier1 = cands.filter((k) => pdPriorityOf(pools[k]!.artId) === best)
        key = pickOne(state.rng, tier1)!
      }
      focus[fi] = key
      const pool = pools[key]!
      // 命中 = clamp(**下限 10%**, 1, pdAcc − 闪避)（船长 2026-09-12）
      const pHit = clamp(bal.pdHitFloor ?? 0, 1, bal.pdAcc - pool.evasion)
      if (nextRandom(state.rng) >= pHit) continue // 未命中（闪避生效）
      // 伤害 = pdDmg × **舰种档系数**（越大的船防空越强；船长 2026-09-12）
      const tierMul =
        bal.pdTierMul?.[Math.min(4, Math.max(0, (foes[fi]!.hullClassTier ?? 1) - 1))] ?? 1
      const res = applyDamage(
        { s: pool.s, a: pool.a, h: pool.h },
        pool.resists ?? {},
        bal.pdDmg * tierMul,
        'kinetic',
      )
      pool.s = res.hp.s
      pool.a = res.hp.a
      pool.h = res.hp.h
      if (pool.s + pool.a + pool.h <= 0) {
        pool.alive = false
        focus[fi] = undefined // 目标已灭 ⇒ 本舰下一拍重选
        // 机型直接从**池条目**取（2026-09-14「逐舰」后不再回查主控武器表：键里有舰 tag，池里有 artId）
        const artId = pool.artId ?? 'drone'
        const ownerTag = pool.owner ?? dronePoolOwner(key)
        b.droneLost = { ...(b.droneLost ?? {}) }
        b.droneLost[artId] = (b.droneLost[artId] ?? 0) + 1
        // **逐舰战损**（船长 2026-09-14「战损按舰归属」）：结算按舰扣各自的机舱清单
        const byOwner = { ...(b.droneLostBy ?? {}) }
        byOwner[ownerTag] = { ...(byOwner[ownerTag] ?? {}) }
        byOwner[ownerTag]![artId] = (byOwner[ownerTag]![artId] ?? 0) + 1
        b.droneLostBy = byOwner
        // 击落演出事件（side='me' + src='drone' + droneDown：UI 出小爆炸/坠落）——**tag = 该架所属舰**
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'me',
          tag: ownerTag,
          type: 'kinetic',
          src: 'drone',
          artId,
          hit: true,
          droneDown: true,
        })
      }
    }
    b.pdCd[fi] = cd
  }
  b.pdFocus = focus
}

/**
 * **防空选靶**（2026-09-11 机群批 · 船长 A1：「玩家武器通常**不可打**，**需要带有防空属性的武器**」）。
 *
 * 从存活敌机里随机抽一架——**消费 `state.rng`**，与既有'每发武器在开火瞬间独立抽取目标'同款口径。
 * - 只在**该武器自己的射程内**抽（炮台射程 ≠ 机群射程）；抽不到就照旧打舰；
 * - 已击落的架次跳过（`pool.alive === false`）；母舰阵亡 ⇒ 其机群不再参战（「机群是舰的一部分」）；
 * - 返回 `null` = 本场无机群 / 全打光 / 不在射程内。
 *
 * ⚠ **只有带 `canHitDrones` 的武器会调用本函数** ⇒ 既有武器（含我方无人机）**按构造看不到机群**，
 * 一次 `nextRandom` 都不会多消耗 ⇒ **零行为变化**。
 *
 * **导出仅供回归测试**锁住上面两条语义（零消费 rng / 击落后不再被选）——引擎内部调用，与我方
 * 无人机的 `pushBattleFx` 同款处理。真实'武器 → 机群'链路在 E 族近防炮落码后由集成用例覆盖。
 */
export function pickFoeDroneTarget(
  state: GameState,
  b: import('./state').BattleState,
  foes: readonly UnitSpec[],
  dist: number,
  w: { minRangeM: number; maxRangeM: number },
  /** 我方**武器槽下标**（集火锁定的索引轴；见 `BattleState.mePdFocus`） */
  wi = 0,
): { foeTag: string; pool: import('./state').DronePoolEntry } | null {
  const pools = b.foeDronePools
  if (!pools) return null;
  // **反应式**（船长 2026-09-11「每轮都是被攻击后才开火」）：只有**刚被机群打过**才反击——
  // 敌机没打过来（或已超出窗口）⇒ 近防炮不开火（"敌方无人机只有靠近你你才能反击"）。
  const hitAt = b.droneHitAt?.me
  if (hitAt === undefined || b.lastTickGameMs - hitAt > PD_REACTIVE_WINDOW_MS)
    return null;
  // **消费制**（船长 2026-09-11：「我没有看到反应式防空，被攻击后近防炮就一直开火」）——
  // 窗口原设 5,000ms 而敌机装填 4,400ms ⇒ **窗口首尾相接、看着就是一直在打**。
  // 现改为：**一次敌机攻击只换一次反击**（把这个时刻消费掉，下一次要等它再打过来）——
  // 节奏变成"挨一下 → 还一炮 → 静默等下一轮"，反应式才看得出来。
  b.droneHitAt = { ...(b.droneHitAt ?? {}), me: undefined };
  // ⚠ **打机群不按两舰间距判射程**（船长 2026-09-11 裁定 · 甲案）：敌机在画面里是**飞到您舰旁**
  // 才开火的——机制服从画面 ⇒ 只要机还活着、近防炮就能打它（近防炮的射程只对"打舰"生效）。
  // 旧口径用 `b.distanceM` 判 ⇒ 画面里贴着您的敌机被当成在 4.5km 外 ⇒ 近防炮"不工作"（船长实测）。
  const cands: Array<{
    foeTag: string
    idx: number
    pool: import('./state').DronePoolEntry
    /** 该机型的角色（选靶优先级按 role 兜底判档——敌方机型不受我方 id 表约束） */
    role: string | undefined
  }> = []
  for (const f of foes) {
    if (!isAlive(b, f.tag)) continue;
    // **入场窗口内的敌舰整舰不可交战**（船长 2026-09-14「动画没结束不开火」）：它的机群自然也打不到
    // ——母舰还在跃迁/入场中，机库里的机还没跟着到场。
    if (!isFoeEngageable(b, f.tag)) continue;
    // 该舰各机型的**角色**（哨戒机按"进射程才可打"处理——船长 2026-09-11 重新定义近防炮）
    const roleOf = new Map<string, string>()
    for (const slot of f.foeDrones ?? [])
      roleOf.set(slot.drone.id, slot.drone.role)
    const arr = pools[f.tag] ?? [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!;
      if (!p.alive) continue;
      if (p.inHangar === true) continue; // **备用机在库**：还没放飞 ⇒ 打不到它（2026-09-12）
      // **对称规则**（P-40）：敌方**哨戒机**要在**本武器射程内**才可被打；
      // **出击型**不受射程限制（它们扑到我方来，反击由"被攻击"的令牌驱动）。
      const role = p.artId ? roleOf.get(p.artId) : undefined
      if (role === 'sentry' && (dist < w.minRangeM || dist > w.maxRangeM))
        continue
      cands.push({ foeTag: f.tag, idx: i, pool: p, role })
    }
  }
  if (cands.length === 0) return null
  // ── **集火**（2026-09-12 船长「改为集火制度」；P-40 乙案：与我方侧口径对齐）──
  // 本武器已锁定的那架**还活着且仍可打** ⇒ 继续打它（换靶只发生在"被击落 / 被备用机替换 / 出射程"时）。
  // ⚠ 与敌方侧 `pdFocus` 同口径（那侧按**点防舰**同序存；我方按**武器槽**存，见 `BattleState.mePdFocus`）。
  const focus: Array<{ tag: string; idx: number } | undefined> = b.mePdFocus ? [...b.mePdFocus] : []
  const locked = focus[wi]
  if (locked) {
    const keep = cands.find((c) => c.foeTag === locked.tag && c.idx === locked.idx)
    if (keep) return { foeTag: keep.foeTag, pool: keep.pool }
  }
  // ── **选靶优先级**（船长 2026-09-12：「**优先攻击哨戒和攻坚无人机**」「侦查和普通战机相同权重抽取」）──
  // 与敌方侧 `pdPriorityOf` **同一张表**：哨戒 0 → 攻坚 1 → 其余 2；取**当前存在的最低档**，同档**等权随机**。
  let best = 2
  for (const c of cands) {
    const p = pdPriorityOf(c.pool.artId, c.role)
    if (p < best) best = p
  }
  const tier = cands.filter((c) => pdPriorityOf(c.pool.artId, c.role) === best)
  const pick = tier[nextInt(state.rng, tier.length)]!
  focus[wi] = { tag: pick.foeTag, idx: pick.idx }
  b.mePdFocus = focus
  return { foeTag: pick.foeTag, pool: pick.pool }
}

/**
 * 一步战斗推进。
 *
 * **多单位（虫洞 D 批 · 船长 2026-09-13）**：`myUnits` 恒为**我方编队**——单船路径传 `[me]` 一条，
 * 虫洞内传 `[主控, ...僚舰]`（见 `BattleState.myFleet`）。硬纪律：**`myUnits.length === 1` 时
 * 每一处多单位分支都必须与改动前逐字等价**（尤其**随机数消费顺序**——选靶函数在"只剩一艘"时
 * 直接返回、一次 `nextRandom` 都不多消耗），否则既有 27 张卡的标定读数会整体漂移。
 */
function stepBattle(
  state: GameState,
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
  foes: UnitSpec[],
  foeDesire: number,
  openM: number,
  bal: BattleBalance,
  dtMs: number,
  favor: { meMul: number; foeMul: number } | null = null,
  hasMoreWaves = false, // 多波（2026-09-09）：本波清空但还有后续波 → 不判胜，由推进方切波续刷
  /** 敌方选靶模式（虫洞内敌卡专属；`random` = 等权随机，多单位下的缺省） */
  foeTargeting: FoeTargetingMode = 'random',
  /**
   * **选靶倾向概率**（船长 2026-09-14「虫洞敌人的攻击倾向，加一个概率」→「挨个定为 60%」）：
   * `1` = 铁律（缺省，不掷骰）· `<1` ⇒ 每发开火前掷一次，没掷中退回随机（见 `pickMyUnitTarget`）。
   */
  foeTargetingChance = 1,
): void {
  const dtSec = dtMs / 1000
  // 主控 = 编队首条（距离/期望交距/胜率口径的锚；单船路径即唯一那条）
  const me = myUnits[0]!

  // ── 距离机动（无过冲转向：每方朝自己期望距离推进，剩余距离不足本步航程时只走剩余，
  //    到位即停；双方意图相反时在中间形成无振荡角力平衡，杜绝"到点来回抖动"）──
  // 2026-09-10 船长（推进器周期爆发）：我方机动 = 基础机动 ×(1 + 推进器爆发倍率)——**只在爆发窗口内**；
  // 冷却期回到基础值（不再常驻加成）。
  // 2026-09-14 船长（微型跃迁引擎）：窗口**逐单位**判定——各舰按自己装配的周期算（见 `unitThrusterCycle`）。
  const phaseOf = (u: UnitSpec): boolean => thrusterPhase(b, bal, unitThrusterCycle(u, bal)).boosting
  // **整队机动 = 存活我方单位的「平均」战斗机动**（虫洞 D 批 · 船长 2026-09-13 选定"整队平均"）——
  // 与敌方 2026-09-11 定的「敌舰速度按所有船的平均值算」**同一把尺**；单船 = 该船自己（逐字不变）。
  // 爆发倍率**逐舰各取自己的**（装微型跃迁引擎那条只在它自己的 10 秒窗口里快；其余船维持 60/60）——
  // 全队同款推进器时与改前逐字等价（相位与倍率都相同 ⇒ 平均速度 ×(1+倍率)）。
  // 敌方期望距离不得超出开战距离（近距开局下 kite 战术系数可能越界 → 钳制，避免一直想拉开）
  const foeDesireClamped = Math.min(openM, foeDesire);
  // 冲锋状态机（2026-09-14 船长改判：**逐单位** + **自身炮台命中解除** + 冷却 10 秒）——
  // ⚠ **顺序**：先更新状态、再算接近速度（倍率由状态读出来，见 `unitSpeedMulOf` 的单点）。
  // 触发条件（乙）与"到达期望交距"兜底都在 `updateFoeCharge` 里；本处只管"读状态算速度"。
  updateFoeCharge(b, foes, bal, b.lastTickGameMs, foeDesireClamped)
  // **整队机动 = 存活单位的「平均」战斗机动 ×各自倍率**（倍率单点 = `unitSpeedMulOf`）：
  // 我方倍率 = 推进器**周期爆发**（逐单位周期）；敌方倍率 = **冲锋**（逐单位状态）。
  // ⚠ 冲锋倍率**不外溢**（船长 2026-09-11：「冲锋还是按照巨兽自己的速度算…哪怕是冲锋也是按照巨兽速度」）：
  // 逐单位乘各自倍率**再取平均** ⇒ 只有正在冲的那条吃到倍率。
  // **2026-09-14 船长改判（本批）**：删掉旧的 `max(编队平均, 冲锋者速度 × 全局倍率)` 补丁——
  // 那条写法在"逐单位各自倍率"下已不成立（小虫 1.5 与巨兽 3 各异），改回**纯平均**：
  // 例 C 族噬口第 3 波（小虫 544×1.5 ×3 条 + 巨兽 297×3 ×1 条）⇒ 编队接近速度
  // = (816×3 + 891) ÷ 4 = **834.8 m/s**（旧的 `max(编队最快, 冲锋者×倍率)` 补丁会给 891）。
  // 敌方接近速度沿用 2026-09-11 船长口径（「能否敌舰移动速度按照敌方是所有船的平均值算」）：
  // 原口径是**取最快单位**（`Math.max`）——混编卡里一条快船会把整队拖快：例 穹顶守卫
  // = 2 静滞卫舰（129）+ 1 守墓长舰（232）⇒ 原口径整队按 **232** 走，与「静滞卫舰是半速炮台」
  // 的设定相冲；改平均后该队按 **163**（战斗机动 92）走。
  // 同速编成（单舰卡 / 同型多舰卡，如 A 族头目+同族杂鱼、C 族虫群）**逐字不变**（平均值 = 该速度）。
  let meV = 0
  {
    let n = 0
    for (const u of myUnits) {
      if (!isAlive(b, u.tag)) continue
      meV += combatSpeed(u.speedMps, u.agility, bal) * unitSpeedMulOf(u, b, bal, 'me')
      n += 1
    }
    if (n > 0) meV /= n
  }
  let foeV = 0
  let foeAliveN = 0
  for (const f of foes) {
    if (!isAlive(b, f.tag)) continue
    foeV += combatSpeed(f.speedMps, f.agility, bal) * unitSpeedMulOf(f, b, bal, 'foe')
    foeAliveN += 1
  }
  if (foeAliveN > 0) foeV /= foeAliveN;
  const rate =
    steerStep(b.distanceM, b.myDesireM, meV, dtSec) +
    steerStep(b.distanceM, foeDesireClamped, foeV, dtSec)
  b.distanceM = clamp(bal.minDistanceM, openM, b.distanceM + rate)

  // ── 我方开火（主炮 + 无人机条目）——**逐舰结算**（单船路径 = 只循环一次，逐字等价）──
  // 开火失稳代价只在点火期生效（2026-09-10 船长：没点火就不失稳）——每次开火取当前有效乘子，
  // 冷却期 = 1（不改 me 本身，避免污染其它读法）；**逐舰各取自己的 `hitMul`**。
  const meAtkOf = (u: UnitSpec): UnitSpec =>
    phaseOf(u) ? u : { ...u, hitMul: effectiveHitMul(u, false) }
  for (const unit of myUnits) {
    const meRt = b.units[unit.tag]
    if (!meRt || !isAlive(b, unit.tag)) continue
    // 主控（`player`）——单船路径与多单位路径的首条都走这里
    const meAtk = meAtkOf(unit)
    for (let wi = 0; wi < unit.weapons.length; wi++) {
      const w = unit.weapons[wi]!
      /**
       * **逐舰放飞**（船长 2026-09-14「逐舰机群」；此前只有主控的机群参战、僚舰条目被跳过）：
       * 本舰的无人机条目查**本舰自己的池**（键 = `舰tag:武器下标`）。
       * ⚠ 查不到池条目 = 这条无人机**不参战**（该舰没带 / 老档没这类键 / 未建池）——**跳过而非
       * "无池开火"**，否则会出现打不掉的幽灵机群（这条纪律从 D 批起就有，本轮换成逐舰判定）。
       */
      if (w.src === 'drone') {
        const poolEntry = b.dronePools?.[dronePoolKey(unit.tag, wi)]
        if (!poolEntry || poolEntry.alive === false) continue // 已被点防打掉的架次不再开火（条目保留占位）
      }
      const cd = meRt.weapons[wi] ?? 0
      if (cd > 0) {
        meRt.weapons[wi] = Math.max(0, cd - dtMs)
        continue
      }
      // ── 防空属性（船长 A1）：**只有带 `canHitDrones` 的武器能筛到敌机** ──
      // 机群不在主目标池里 ⇒ 其余武器（含我方无人机，船长 B1）按构造看不到它们。
      // 带标记的武器**优先打机群**（防空是它的本职）。
      // **射程口径（船长 2026-09-11 甲案）**：打机群**不看两舰间距**（敌机扑到您舰旁才开火，
      // 机制服从画面）⇒ 有敌机可打时不受 `inRange` 拦截；只有"打舰"才按本武器射程判。
      const droneHit = w.canHitDrones
        ? pickFoeDroneTarget(state, b, foes, b.distanceM, w, wi)
        : null
      if (!droneHit && !inRange(b.distanceM, w)) continue;
      // V18B 随机目标（船长 2026-09-05）：每发武器在开火瞬间从存活敌人中独立抽取
      // （确定性 rng 种子，可复现；齐射可分散到不同目标）。目标死亡即时换人。
      // 2026-09-09 锁定装置：装上即切换"集火模式"——全部武器打存活编队首位（主舰优先、击毁接力）。
      const foeTarget = droneHit
        ? null
        : unit.lockedDmgBonus
          ? firstAliveFoe(foes, b)
          : randomAliveFoe(state, b, foes)
      if (!foeTarget && !droneHit) continue
      let type: DamageType
      let dmg: number
      let autoHit = false
      /** 一轮齐射的用弹量（同型合并条目 ×N × 每次耗弹数；2026-09-11 修复：此前多门武器只扣 1 发弹药） */
      const roundsPerVolley = Math.max(1, w.count ?? 1) * Math.max(1, w.ammoPerShot ?? 1)
      if (w.kind === 'gun') {
        // V18B-2 per-gun 弹型：每件武器打自己的键（动能/爆破导弹/能量弹药混装各自供弹），
        // 该键弹尽 → 本武器停火（不拖累其它型）。**齐射按门数扣弹**：不足一轮齐射的余弹不发射
        // （等返港补弹；预载已按门数放大，正常战斗不会因缺弹中断）
        const pick = (Object.keys(w.shotsByType ?? {})[0] as DamageType | undefined) ?? null
        if (!pick || b.ammo[ammoKeyOf(pick)] < roundsPerVolley) {
          meRt.weapons[wi] = w.reloadMs // 无弹：等一轮再查（避免每步空转）
          continue
        }
        type = pick
        dmg = w.shotsByType?.[pick] ?? 0
        b.ammo[ammoKeyOf(pick)] -= roundsPerVolley
        meRt.weapons[wi] = w.reloadMs
      } else if (w.kind === 'beam') {
        // V18B-2 激光：必中光束——逐发扣能量弹药（按门数）；威力随距离衰减（beamPowerFactor）
        if (b.ammo.pla < roundsPerVolley) {
          meRt.weapons[wi] = w.reloadMs
          continue
        }
        type = 'plasma'
        b.ammo.pla -= roundsPerVolley
        dmg = Math.max(1, Math.round((w.shotDmg ?? 0) * beamPowerFactor(b.distanceM, w)))
        meRt.weapons[wi] = w.reloadMs
        autoHit = true
      } else {
        type = w.fixedType ?? 'kinetic'
        dmg = w.shotDmg ?? 0
        meRt.weapons[wi] = w.reloadMs
      }
      // **对无人机伤害加成**（船长 2026-09-12：「近防炮给予一个对无人机伤害加成」→「**那伤害倍率按2倍算**」）：
      // 只作用于**打机群**这一支（`droneHit` 非空 ⇔ 本发打的是敌机，见上方 `pickFoeDroneTarget`）；
      // **对舰伤害一字不动**——`tests/pd-damage-ladder.test.ts` 的对舰单发定值就是这条的守卫。
      // 倍率来自装备表（`ModuleDef.antiDroneDmgMul` → `WeaponSpec.antiDroneMul`），缺省 = 1 ⇒ 不乘。
      if (droneHit && (w.antiDroneMul ?? 1) !== 1)
        dmg = Math.round(dmg * (w.antiDroneMul ?? 1))
      b.stats.meShots += 1;
      // **反应式防空**：我方**无人机**打过敌舰 ⇒ 记录时刻，供**敌方近防炮**在窗口内反击
      if (w.src === 'drone')
        b.droneHitAt = { ...(b.droneHitAt ?? {}), foe: b.lastTickGameMs };
      // AI favor：我方（AI 副船）命中按优势放大，上限放开到 100%（可必中）；
      // beam 已必中（autoHit），不掷骰、favor 不放大
      // **两条命中分开算**（船长 2026-09-12 裁定「按丁修复」，口径说明见 `droneHitChance`）：
      // 打**机群**不吃两舰距离衰减（守方只用该架的闪避 `DronePoolEntry.evasion`，机型表绝对值）；
      // 打**舰**一字未动（仍按两舰间距算 `distFactor`）。
      const meHit = autoHit
        ? 1
        : droneHit
          ? droneHitChance(w, meAtk, droneHit.pool.evasion, bal)
          : hitChance(w, meAtk, foeTarget!, b.distanceM, bal)
      const meHitEff = autoHit
        ? 1
        : favor
          ? clamp(0, 1, meHit * favor.meMul)
          : meHit
      const hit = dmg > 0 && (autoHit || nextRandom(state.rng) < meHitEff)
      if (hit) {
        b.stats.meHits += 1
        if (droneHit) {
          // 打机群：扣该架的三层血（吃它自己的层抗）；打空 = **击落**（停火 + 小型爆炸演出）。
          // ⚠ 锁定装置的加深**不作用于机群**（锁定锁的是舰）——防空靠的是射速与命中，不是锁定。
          const pool = droneHit.pool
          const r = applyDamage(
            { s: pool.s, a: pool.a, h: pool.h },
            pool.resists ?? {},
            dmg,
            type,
          )
          pool.s = r.hp.s
          pool.a = r.hp.a
          pool.h = r.hp.h
          b.stats.meDmg += r.dealt
          if (pool.s + pool.a + pool.h <= 0) {
            pool.alive = false
            // **备用机库补位排期**（2026-09-12 船长「损坏后补充敌机」）：前线战损 ⇒ 从机库放出一架，
            // `respawnMs` 后到位。⚠ 同一时刻只排**一架**（在前的那架到位后才轮到下一架）。
            const reserveOf = foes.find((x) => x.tag === droneHit.foeTag)?.foeDroneReserve
            const hangar = b.foeDronePools?.[droneHit.foeTag] ?? []
            if (
              reserveOf &&
              reserveOf.count > 0 &&
              !hangar.some((p) => p.inHangar === true && p.readyAtMs !== undefined)
            ) {
              const next = hangar.find(
                (p) => p.inHangar === true && p.readyAtMs === undefined,
              )
              if (next) next.readyAtMs = b.lastTickGameMs + reserveOf.respawnMs
            }
            pushBattleFx(b, {
              atMs: b.lastTickGameMs + dtMs,
              side: 'foe',
              tag: droneHit.foeTag,
              to: 'player',
              type,
              src: 'drone',
              artId: pool.artId,
              hit: true,
              droneDown: true, // 击落演出（与我方被点防打落同款事件类型）
            })
          }
        } else {
          const rt = b.units[foeTarget!.tag]!;
          const hpBefore = { ...rt.hp }
          // 锁定装置：被锁目标受本舰伤害加深（对锁定目标的任意命中都乘入；2026-09-09）
          const dmgLocked = unit.lockedDmgBonus
            ? Math.round(dmg * (1 + unit.lockedDmgBonus))
            : dmg
          const r = applyDamage(rt.hp, {}, dmgLocked, type)
          rt.hp = r.hp
          b.stats.meDmg += r.dealt
          /**
           * **谜质「齐射协调仪」：溢出火力转移**（F3c B2 · 船长 2026-09-13：
           * 「齐射协调仪改为溢出火力会转移到其他敌舰」）——目标被这一发打空后，把超出
           * 「打空它所需原始伤害」的那一截转给下一艘存活敌舰（按那一艘自己的层克重重算）。
           * 只在本场带了该装置时生效（`battle.wormhole.volleyOverflow`）。
           */
          if (b.wormhole?.volleyOverflow === true && rt.hp.s + rt.hp.a + rt.hp.h <= 0) {
            const carry = carryVolleyOverflow(b, foes, foeTarget!.tag, type, dmgLocked, hpBefore)
            if (carry.hits > 0) {
              pushBattleNotice(b, `齐射协调：溢火结转 ${Math.round(carry.total)} 点伤害到下一艘敌舰`)
            }
          }
          // **附加伤害段**（2026-09-13 船长：掠袭破片炮「额外造成 50% 的动能伤害是附加伤害，
          // 和弹种无关」）——口径（船长 2026-09-13 二次裁定）：「**伤害各自吃各自的制（克制）效果**」：
          // 副段取**武器原伤害**（含锁定加深，不含主段已吃的克制）×比例，然后**两段各吃各自的层克制**。
          // ⚠ 不能用主段实收做基数——那会把主系的克制乘进副段（实测该目标会从 +50% 放大到 +75%）。
          const secPct = w.secondaryDamagePct ?? 0
          if (secPct > 0 && rt.hp.s + rt.hp.a + rt.hp.h > 0) {
            const secType = w.secondaryDamageType ?? 'kinetic'
            const secDmg = Math.max(1, Math.round(dmgLocked * secPct))
            const r2 = applyDamage(rt.hp, {}, secDmg, secType)
            rt.hp = r2.hp
            b.stats.meDmg += r2.dealt
          }
          // **受击增程触发点（唯一）**——2026-09-11 船长：「受到攻击后，大幅提高无人机射程
          // （提高 400%）」：**母舰本体被命中** ⇒ 该舰全部机群射程 ×倍率（本场永久）。
          // ⚠ 打机群（上面的 `droneHit` 分支）**不触发**、未命中（`hit === false`）也进不到这里。
          if (markFoeDroneRangeBuff(foeTarget!, b)) {
            // **画面提示**（船长 2026-09-11 二次裁定：日志不写，改走画面顶部提示位 ⇒ `battle.notices`，
            // 与「敌方增援」同一处显示、限时自动消失）。
            // ⚠ **整队只推一条**（三次裁定：「每个敌人都会单独触发一次射程增加的文字提示，理论上应该
            // **只触发一次**，**对所有敌舰生效**」）⇒ 文案不点单舰名（生效范围是全敌队）。
            pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
          }
          // **炮台受击增程触发点（唯一）**——2026-09-12 船长：D 族静滞卫舰「挨打后射程增加 50%」，
          // **仅影响所有静滞卫舰**（同场其它舰级不受影响）。命中其本体 ⇒ 本场该型舰炮台射程 ×1.5。
          // ⚠ 打机群／未命中都进不到这里；状态该型舰共享 ⇒ 只推一条提示（文案不点单舰名）。
          if (markFoeGunRangeBuff(foeTarget!, b)) {
            pushBattleNotice(b, '静滞阵列解除限幅：静滞卫舰炮台射程 +50%')
          }
        }
        // **全体攻击**（2026-09-13 船长：C 孢子导弹巢「对所有敌方同时攻击」）——
        // 主目标已按上面的常规口径结算；这里把**同一轮齐射**逐个结算到其余存活敌舰：
        // 逐目标独立掷命中（各用各自的命中条件）、各吃各自的层克制与抗性；受击增程等触发点照常逐舰触发。
        // ⚠ 副目标**不吃锁定加深**（锁定锁的是主目标）⇒ 基数用 dmg，主目标仍用 dmgLocked。
        if (w.allFoes === true && hit && !droneHit) {
          for (const other of foes) {
            if (other.tag === foeTarget!.tag) continue
            const ort = b.units[other.tag]
            if (!ort || !isAlive(b, other.tag)) continue
            const oHitChance = autoHit ? 1 : hitChance(w, meAtk, other, b.distanceM, bal)
            const oHit = dmg > 0 && (autoHit || nextRandom(state.rng) < oHitChance)
            if (oHit) {
              b.stats.meHits += 1
              const rAll = applyDamage(ort.hp, {}, dmg, type)
              ort.hp = rAll.hp
              b.stats.meDmg += rAll.dealt
              const secPctAll = w.secondaryDamagePct ?? 0
              if (secPctAll > 0 && ort.hp.s + ort.hp.a + ort.hp.h > 0) {
                const secTypeAll = w.secondaryDamageType ?? 'kinetic'
                const secDmgAll = Math.max(1, Math.round(dmg * secPctAll))
                const rAll2 = applyDamage(ort.hp, {}, secDmgAll, secTypeAll)
                ort.hp = rAll2.hp
                b.stats.meDmg += rAll2.dealt
              }
              if (markFoeDroneRangeBuff(other, b)) {
                pushBattleNotice(b, '巨构残存程序过载：警戒机群解除射程限制')
              }
              if (markFoeGunRangeBuff(other, b)) {
                pushBattleNotice(b, '静滞阵列解除限幅：静滞卫舰炮台射程 +50%')
              }
            }
            pushBattleFx(b, {
              atMs: b.lastTickGameMs + dtMs,
              side: 'me',
              tag: unit.tag,
              to: other.tag,
              type,
              src: w.src,
              artId: w.artId,
              hit: oHit,
            })
          }
        }
      }
      pushBattleFx(b, {
        atMs: b.lastTickGameMs + dtMs,
        side: 'me',
        tag: unit.tag,
        to: droneHit ? droneHit.foeTag : foeTarget!.tag,
        type,
        src: w.src,
        artId: w.artId,
        hit,
        // **打的是机群**（船长 2026-09-11：「炮在攻击无人机时**不显示弹道**」）——UI 只出炮口闪光。
        ...(droneHit ? { pd: true } : {}),
      })
    }
  }

  // ── 敌方开火（按**选靶模式**打我方；单船路径 = 恒打唯一那艘、零随机数消费） ──
  for (const f of foes) {
    const rt = b.units[f.tag]
    if (!rt || !isAlive(b, f.tag)) continue;
    // 本发（本次齐射）的目标：**每次开火前重选**——目标被打沉后自动换人，与"每发独立抽敌人"对称。
    const pickTarget = (): { spec: UnitSpec; rt: import('./state').BattleState['units'][string] } | null => {
      const spec = pickMyUnitTarget(state, b, myUnits, foeTargeting, foeTargetingChance)
      if (!spec) return null
      const urt = b.units[spec.tag]
      return urt ? { spec, rt: urt } : null
    }
    // ── 敌方机群开火（2026-09-11 机群批）──
    // 逐架独立装填、独立掷命中（与我方无人机条目同款口径：`src:'drone'` + `artId` 供演出层识别）。
    // ⚠ 本段**放在主武器之前**：主武器有 `continue`（无弹分支之外还有 beam 分支的 continue），
    //   放在循环尾部会被那些 `continue` 跳过。
    // 池与 drone 条目**同序**（`initFoeDronePools` 按 slot 顺序展开），故用独立计数 `di` 对位。
    const fPools = b.foeDronePools?.[f.tag]
    if (fPools && fPools.length > 0 && isAliveAnyOf(b, myUnits)) {
      // **备用机库补位到位**（2026-09-12 船长「损坏后补充敌机」）：到点的备用机翻成**在空**并**满血**放出
      for (const p of fPools) {
        if (p.inHangar !== true || p.readyAtMs === undefined) continue
        if (b.lastTickGameMs < p.readyAtMs) continue
        p.inHangar = false
        p.readyAtMs = undefined
        p.alive = true
        p.s = p.maxS ?? p.s
        p.a = p.maxA ?? p.a
        p.h = p.maxH ?? p.h
      }
      // **单次出击上限**（2026-09-12 船长「限制敌机单次出击数量」）：本拍只有"在空窗口"里的架次能开火，
      // 其余在机库待命（装填也冻着 ⇒ 轮到它时即打）。缺省不写该字段 ⇒ `aloft = null` ⇒ 全群照旧同时开火。
      const launch = f.foeDroneLaunch
      const reloadBase = f.weapons.find((w) => w.src === 'drone')?.reloadMs ?? 4400
      const aloft = launch
        ? aloftDroneSet(fPools, launch, reloadBase, b)
        : null
      const activeCount = fPools.filter((p) => p.alive && p.inHangar !== true).length
      const kAloft = launch
        ? Math.max(1, Math.min(Math.round(launch.maxAloft), Math.max(1, activeCount)))
        : 0
      // `keepDps`（推荐）：在空架次的有效装填 ×(k ÷ 在场架数) ⇒ **平均 DPS 守恒**（限制的是同时在空数）
      const aloftReload = (base: number): number =>
        launch && launch.keepDps === true && kAloft > 0 && activeCount > 0
          ? Math.max(200, Math.round((base * kAloft) / activeCount))
          : base
      let di = 0
      for (let k = 0; k < f.weapons.length; k++) {
        const dw = f.weapons[k]!
        if (dw.src !== 'drone') continue
        const pool = fPools[di]
        const idx = di
        di += 1
        if (!pool || !pool.alive) continue; // 已被防空武器击落的架次：停火（条目保留占位）
        if (pool.inHangar === true) continue; // **备用机**：在库待命（不开火、不算在场架数）
        if (aloft && !aloft.has(idx)) continue; // **不在本批出击窗口**：在库待命（装填冻结）
        const dcd = rt.weapons[k] ?? 0
        if (dcd > 0) {
          rt.weapons[k] = Math.max(0, dcd - dtMs)
          continue
        }
        rt.weapons[k] = aloftReload(dw.reloadMs)
        // 射程门：**受击增程**生效时读 `foeDroneRangeOf`（机型射程 × 倍率），否则就是机型射程
        if (b.distanceM > foeDroneRangeOf(b, dw)) continue // 机群够不着（我方在它射程外）
        // 选靶（多单位）：**每架敌机独立选靶**——与我方"每发独立抽敌人"同款粒度
        const dtgt = pickTarget()
        if (!dtgt) break // 我方已全灭（正常由结束判定收场）
        b.stats.foeShots += 1;
        // **反应式防空**：敌机打过我方 ⇒ 记录时刻，供**我方近防炮**在窗口内反击
        b.droneHitAt = { ...(b.droneHitAt ?? {}), me: b.lastTickGameMs }
        const dType = dw.fixedType ?? 'kinetic';
        // 机群为掷命中（`fixed`）：吃自己的 `hitRate`、吃我方回避与距离衰减——与我方无人机同源
        const droneHit = hitChance(dw, f, dtgt.spec, b.distanceM, bal)
        const droneHitEff = favor
          ? clamp(0, 0.97, droneHit * favor.foeMul)
          : droneHit
        const dHit = nextRandom(state.rng) < droneHitEff
        if (dHit) {
          b.stats.foeHits += 1
          dtgt.rt.hp = applyFoeShot(
            dtgt.rt.hp,
            dtgt.spec.resists,
            dw,
            dw.shotDmg ?? 0,
            dType,
          )
        }
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'foe',
          tag: f.tag,
          to: dtgt.spec.tag,
          type: dType,
          src: 'drone',
          artId: dw.artId,
          hit: dHit,
        })
      }
    }
    const w = f.weapons[0]!
    const cd = rt.weapons[0] ?? 0
    if (cd > 0) {
      rt.weapons[0] = Math.max(0, cd - dtMs)
      continue
    }
    rt.weapons[0] = w.reloadMs
    // V18B（2026-09-05 船长拍板）：敌人近盲带（dist < minRange）内**不停火**——放行到
    // maxRange 内即可开火；伤害按 blindDmgMul 打折（玩家贴脸钻近盲不再零风险）。
    // 玩家武器无此待遇（近盲带内仍不开火）——双方在近盲带上行为区分。
    // 射程门：**炮台受击增程**生效时读 `foeGunMaxRangeOf`（原射程 × 倍率；仅带该字段的舰）
    if (b.distanceM > foeGunMaxRangeOf(b, f, w)) continue
    // 选靶（多单位）：**本发开火前重选**（上一次齐射可能已把目标打沉）
    const gtgt = pickTarget()
    if (!gtgt) continue // 我方已全灭（正常由结束判定收场）
    b.stats.foeShots += 1
    const fType = w.fixedType ?? 'kinetic'
    // 2026-09-08（船长定）：能量（beam）= 必中——不掷命中骰；威力：近盲带内 ×blindDmgMul
    // （近盲带保留），带内至远端按 beamPowerFactor 距离衰减（与玩家激光同源语义）
    if (w.kind === 'beam') {
      // **炮台受击增程感知的折减**（船长选乙：原射程内读数一字不变，延长段同斜率外推）
      const pow = b.distanceM < w.minRangeM ? w.blindDmgMul ?? 0.3 : foeGunPowerFactorOf(b, f, w, b.distanceM)
      const dmg = Math.max(1, Math.round((w.shotDmg ?? 0) * pow))
      // 冲锋解除（船长 2026-09-14）：光束必中 ⇒ 本发即"自身炮台命中我方"
      releaseFoeChargeOnHit(b, f.tag, bal)
      b.stats.foeHits += 1
      // 混伤（2026-09-10 船长）：按逐系单发各自结算（各系吃自己的层位克制与层抗）
      gtgt.rt.hp = applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, dmg, fType)
      pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: true })
      continue
    }
    const blindMul = b.distanceM < w.minRangeM ? (w.blindDmgMul ?? 0.3) : 1
    const shotDmg = blindMul < 1 ? Math.max(1, Math.round((w.shotDmg ?? 0) * blindMul)) : (w.shotDmg ?? 0)
    // AI favor：敌方命中被优势压制，且始终保留 97% 命中上限（3% miss 底线不变）
    // ⚠ 距离折减传**增程感知**的 `foeGunPowerFactorOf`（原射程内与原公式逐字一致；延长段同斜率外推）
    const foeHit = hitChance(w, f, gtgt.spec, b.distanceM, bal, foeGunPowerFactorOf(b, f, w, b.distanceM))
    const foeHitEff = favor ? clamp(0, 0.97, foeHit * favor.foeMul) : foeHit
    const fHit = nextRandom(state.rng) < foeHitEff
    if (fHit) {
      b.stats.foeHits += 1
      gtgt.rt.hp = applyFoeShot(gtgt.rt.hp, gtgt.spec.resists, w, shotDmg, fType)
      // 冲锋解除（船长 2026-09-14）：**自身炮台命中我方** ⇒ 立刻解除冲锋并进入冷却（掷命中，只有真命中才算）
      releaseFoeChargeOnHit(b, f.tag, bal)
    }
    pushBattleFx(b, { atMs: b.lastTickGameMs + dtMs, side: 'foe', tag: f.tag, to: gtgt.spec.tag, type: fType, hit: fHit })
  }

  // ── 敌方点防（2026-09-10 船长「无人机可被击落」）：对我方放飞机群逐架结算 ──
  // ⚠ 本批仍只结算**主控**的机群（`b.dronePools` 按主控武器槽建池；僚舰无人机不参战，见 D 批边界）
  resolvePointDefense(state, b, foes, bal, dtMs)

  // ── P0：护盾战中被动回充（EVE 式；损失不跨场，只回盾层）。
  // 甲/结构已打穿时停止回充——避免"只剩一层盾皮"的无限僵持（P2 可再调）
  // ⚠ **2026-09-14 船长改判**：回充量由"**满盾** × 费率"改为"**当前盾** × 费率"
  //   （原话：「改成按当前盾比例，这样护盾被击穿后应该是 0 回复对吧？」＋「不留，破盾后 0 回复」）
  //   ⇒ 回充变成**指数式**（回满时间 = ln(满盾/当前盾) ÷ 费率），且**盾归零后回充恒为 0**：
  //   盾被打穿 = 本场的分水岭，此后全程由甲/结构承伤。想重新把盾点起来只有一条路 =
  //   中槽「**护盾充能装置**」（`shieldPulsePct`，每 `SHIELD_PULSE_MS` 脉冲回满盾的一个比例）。──
  if (bal.shieldRegenPerSec > 0) {
    for (const unit of myUnits) {
      const urt = b.units[unit.tag]
      if (!urt || !isAlive(b, unit.tag)) continue
      if (urt.hp.s >= unit.hp.s || (urt.hp.a <= 0 && urt.hp.h <= 0)) continue
      const regen = urt.hp.s * bal.shieldRegenPerSec * dtSec
      if (regen > 0) urt.hp.s = Math.min(unit.hp.s, urt.hp.s + regen)
    }
  }

  // ── 结束判定 ──
  // **判负 = 我方全灭**（虫洞 D 批 · 船长 2026-09-13 定）：主控沉了僚舰继续打；
  // 单船路径下"全灭"与"主控沉"等价 ⇒ 与改动前逐字一致。
  const meAlive = isAliveAnyOf(b, myUnits)
  const foeAlive = foes.some((f) => isAlive(b, f.tag))
  if (!meAlive) {
    b.ended = 'foe'
    return
  }
  if (!foeAlive) {
    // 多波未完：本波清空不判胜（推进方下一拍切波续刷）；末波清空 = 胜利
    if (!hasMoreWaves) b.ended = 'me'
    return
  }
  // **无法交战 ⇒ 提前脱战**（2026-09-11 船长裁定「乙2 · 事件为 120 秒」）：
  // 三件同时成立 —— ①开战满 `bal.cannotEngageMs`；②我方**全程一炮未发**（`stats.meShots === 0`，
  // 开过一炮就永不触发）；③当前距离仍**在我方最远射程之外**且**敌人已经开火**（`stats.foeShots > 0`，
  // 即"它在打我、我打不着它"）。判负口径与「超时判负」同源（结算侧走轻损撤退、**不掷弃船骰**），
  // 只把 `escapeReason` 记为 'cannot-engage'，好让战报写明"我方射程不足"。
  // 数值一个字不动：这一条只决定**什么时候收场**（灰霾 ②/⑤/③ 原为打满 600 秒触顶；
  // 蜃影/赤潮三行原是 140/373 秒被打死）。双方都够不着（敌也未开火）**不触发**，仍走 `maxBattleMs`。
  if (
    !b.ended &&
    bal.cannotEngageMs > 0 &&
    b.lastTickGameMs - b.startedAtGameMs >= bal.cannotEngageMs &&
    b.stats.meShots === 0 &&
    b.stats.foeShots > 0
  ) {
    const myTopRangeM = myUnits.reduce(
      (m, u) => u.weapons.reduce((mm, w) => Math.max(mm, w.maxRangeM), m),
      0,
    )
    if (b.distanceM > myTopRangeM) {
      b.ended = 'foe'
      b.autoEscaped = true
      b.escapeReason = 'cannot-engage'
    }
  }
  if (b.lastTickGameMs - b.startedAtGameMs >= bal.maxBattleMs) {
    // 超时判负（2026-09-10 船长定）：打满战斗上限**不再按剩余血量比判胜**（旧口径
    // "meRatio >= bestFoe 即我方胜"= 平局算赢，已作废），一律判负并按**撤退**处理——
    // 置 autoEscaped 交给结算侧走轻损撤退路径（远征据 escapeReason 区分文案）。
    // 动机：旧口径下"打不死但打不着我"的风筝流可白拿全额赏金（见 docs/design/
    // mixed-damage-review-20260910.md §6、docs/design/timeout-defeat-20260910.md）。
    b.ended = 'foe'
    b.autoEscaped = true
    b.escapeReason = 'timeout'
  }
}

/**
 * 距离机动的单方转向步（米）：
 * - 已到位（差 <0.5m）不动；
 * - 否则以 ≤ 本步全速航程推进，且绝不越过期望距离 → 到达后下一拍即停，不产生过冲振荡。
 * 比例收尾段（剩余 < 本步航程时推力 = 剩余）让系统天然收敛，拔河也只在平衡点静止。
 */
export function steerStep(cur: number, desire: number, speedMps: number, dtSec: number): number {
  const gap = desire - cur
  if (Math.abs(gap) < 0.5) return 0
  const cap = Math.max(0.5, speedMps * dtSec)
  const step = Math.min(Math.abs(gap), cap)
  return gap > 0 ? step : -step
}

function isAlive(b: import('./state').BattleState, tag: string): boolean {
  const u = b.units[tag]
  return !!u && (u.hp.s > 0 || u.hp.a > 0 || u.hp.h > 0)
}

/**
 * **敌舰是否"可被我方选中"**（= 能开火打它）——船长 2026-09-14：「**动画没结束不开火**」。
 *
 * 判据 = **真值存活**（{@link isAlive}）**且已过入场窗口**（{@link BATTLE_ARRIVAL_FLY_MS}）：
 * 洞内首波的敌舰跃迁入场、以及每一次波次转场/增援入场，在窗口内都**不可被选中**——
 * 于是我方的枪口会**跳过它去打别人**；若窗口内没有别的可打目标，本拍自然停火（转场时正是这种情况）。
 *
 * 为什么这条要做成**选靶判据**而不是"伤害免疫"：引擎里**命中与伤害同拍结算**（没有在途弹道状态，
 * 界面上那条延迟弹道只是演出）⇒ 选靶处排除即**彻底**堵住"登场第一拍就被齐射带走"。
 *
 * 缺 `enteredAtMs`（开战即在的常规单位 / 洞外首波敌舰 / 老档读入）⇒ **恒可选中**（零行为变化）。
 */
function isFoeEngageable(b: import('./state').BattleState, tag: string): boolean {
  if (!isAlive(b, tag)) return false
  const at = b.units[tag]?.enteredAtMs
  return at === undefined || b.lastTickGameMs >= at + BATTLE_ARRIVAL_FLY_MS
}

/** 我方还有没有活着的单位（`myUnits` 里任一存活）——单船路径等价于 `isAlive(b,'player')` */
function isAliveAnyOf(b: import('./state').BattleState, myUnits: readonly UnitSpec[]): boolean {
  return myUnits.some((u) => isAlive(b, u.tag))
}

/* ═══════════ 虫洞 D 批：敌方选靶（船长 2026-09-13 定） ═══════════ */

/** 存活的我方单位（按编队顺序；`myFleet` 首条 = 主控 ⇒ 首位恒为 `player`） */
export function aliveMyUnits(
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
): UnitSpec[] {
  return myUnits.filter((u) => isAlive(b, u.tag))
}

/** 我方单位的**输出分**（模式「打输出最高的」判据）= 各武器条目名义 DPS 之和
 *  （`nominalWeaponDps` 与装配页 `rawDpsOf` 同口径：炮台取首弹种单发 × 门数 ÷ 装填） */
export function myUnitOutputScore(u: UnitSpec): number {
  let sum = 0
  for (const w of u.weapons) sum += nominalWeaponDps(w)
  return sum
}

/** **非战斗船**（模式「打非战斗船」判据）：工业/采矿与货舰算非战斗；武装/装甲算战斗 */
export function isNonCombatShipRole(role: ShipRole | undefined): boolean {
  return role === 'industrial' || role === 'hauler'
}

/**
 * **敌方选靶**（虫洞 D 批 · 船长 2026-09-13 定的五种模式；见 `FoeTargetingMode`）：
 * 从**存活我方单位**里挑一个目标。并列（同输出 / 同档 / 多艘非战斗船）一律**等权随机**。
 *
 * ⚠⚠ **只剩一艘我方单位时直接返回、一次随机数都不消费** —— 这条是单船路径零漂移的命门：
 * 既有 27 张悬赏卡 / 低安遭遇 / AI 副船的战斗里，敌方开火从不掷"选靶骰"，本函数在那些
 * 场次里也不会多消耗一个 `nextRandom`（否则整批标定读数会漂移）。
 * ⚠ `noncombat` 模式下编队里**没有**非战斗船 ⇒ **退回随机**（船长口径）。
 * ⚠ 模式只由**虫洞内敌卡**（`AnomalyDef.foeTargeting`）写；不写 = `random`。
 *
 * **倾向概率**（船长 2026-09-14：「虫洞敌人的攻击倾向，加一个概率」→「目前先挨个定为60%」）：
 * `chance` = 该模式下**每发开火前**按这个概率生效一次，没掷中 ⇒ **这一发乱了（退回随机抽取）**。
 * `chance >= 1`（缺省）或模式本来就是 `random` ⇒ **连一次骰都不掷** ⇒ 旧场次的随机数消费顺序逐字节不变。
 */
export function pickMyUnitTarget(
  state: GameState,
  b: import('./state').BattleState,
  myUnits: readonly UnitSpec[],
  mode: FoeTargetingMode = 'random',
  /** 模式的作用概率（1 = 铁律；<1 ⇒ 每发开火前掷一次，没掷中退回随机） */
  chance = 1,
): UnitSpec | null {
  // ⚠ **单船路径逐字等价**：编队只有一条（= 既有 27 张悬赏卡 / 低安遭遇 / AI 副船全部场次）
  // ⇒ 恒返回那一条、**一次随机数都不消费**。这里**刻意不看存活**：改动前敌方主炮分支只判
  // `!meRt`、不判 `isAlive`，故"我方在某一拍被打沉后、本拍剩余敌人仍照旧结算开火"——
  // 那一发打在尸体上、对战果无影响，但**会进 `stats.foeShots`**（标定工具「敌开火」列）。
  // 若在此提前返回 null，该计数会少掉最后一拍 ⇒ 与改动前口径不一致（D 批实测到的唯一漂移）。
  if (myUnits.length === 1) return myUnits[0]!
  const alive = aliveMyUnits(b, myUnits)
  if (alive.length === 0) return null
  if (alive.length === 1) return alive[0]!
  /** 并列集合里等权随机（**恰好消费一次** `nextInt`） */
  const randomOf = (cands: UnitSpec[]): UnitSpec => cands[nextInt(state.rng, cands.length)]!
  /**
   * **倾向概率的掷骰点**（2026-09-14 船长）：**每发开火前各掷一次**，没掷中 ⇒ 这一发乱了。
   * 位置刻意放在两个早退**之后** —— 单船 / 只剩一艘时恒返回、不掷骰（洞外零漂移的命门）。
   */
  const missed = chance < 1 && mode !== 'random' && nextRandom(state.rng) >= chance
  if (mode === 'random' || missed) return randomOf(alive)
  switch (mode) {
    case 'top-output': {
      const best = Math.max(...alive.map((u) => myUnitOutputScore(u)))
      return randomOf(alive.filter((u) => myUnitOutputScore(u) === best))
    }
    case 'smallest':
    case 'largest': {
      const tiers = alive.map((u) => u.shipTier ?? 1)
      const want = mode === 'smallest' ? Math.min(...tiers) : Math.max(...tiers)
      return randomOf(alive.filter((u) => (u.shipTier ?? 1) === want))
    }
    case 'noncombat': {
      const civ = alive.filter((u) => isNonCombatShipRole(u.shipRole))
      return civ.length > 0 ? randomOf(civ) : randomOf(alive)
    }
    // `random` 已在上面早退（`mode === 'random' || missed`）⇒ 这里只剩兜底
    default:
      return randomOf(alive)
  }
}

/** 锁定目标（2026-09-09 锁定装置）：存活编队首位（foes 生成序 = 主舰优先），
 * 主舰击毁自动接力下一艘——集火永不卡空；确定性、不消耗 rng */
function firstAliveFoe(foes: UnitSpec[], b: import('./state').BattleState): UnitSpec | null {
  for (const f of foes) if (isFoeEngageable(b, f.tag)) return f
  return null
}

/**
 * V18B 随机目标（船长 2026-09-05）：从存活敌人中均匀随机抽一个（确定性走 state.rng——
 * 种子固定则每场可复现；每发武器调用一次 = 齐射可分散到不同目标）。
 */
function randomAliveFoe(state: import('./state').GameState, b: import('./state').BattleState, foes: UnitSpec[]): UnitSpec | null {
  // ⚠ 抽签池 = **可选中**的敌人（`isFoeEngageable`：存活 + 已过入场窗口）——池子为空 ⇒ 返回 null
  //    ⇒ 本发武器跳过（`advanceBattleFor` 里 `if (!foeTarget && !droneHit) continue`），本拍停火。
  const alive = foes.filter((f) => isFoeEngageable(b, f.tag))
  if (alive.length === 0) return null
  const i = nextInt(state.rng, alive.length)
  return alive[i]!
}

/**
 * **某星系的玩家目标距离设定**（船长 2026-09-11：「玩家每个星系设定的目标距离独立保存，
 * 预估胜率的战斗按照那个距离决定。如果没有，采用射程中段距离」）。
 * 返回 null = 该星系没设过（调用方回落到默认档：**星图 = 射程带 0.8、洞内 = 中段 0.5**，
 * 2026-09-15 船长裁定；见 `balance.battle.desireBand*`）。
 * 单点：实战开战（远征/遭遇/AI）、胜率预估（MC 与稳态解析）全走这一处，避免多处各读各的。
 */
export function desirePrefOf(state: GameState, galaxyId: string | null | undefined): number | null {
  if (!galaxyId) return null
  const v = state.expedition.desirePrefByGalaxy?.[galaxyId]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

/** 写入某星系的目标距离（战斗内拖条/战术切换、出发时显式指定共用）；返回写入后的值 */
export function setDesirePrefOf(state: GameState, galaxyId: string, desireM: number): number {
  const v = Math.max(1, Math.round(desireM))
  state.expedition.desirePrefByGalaxy = { ...(state.expedition.desirePrefByGalaxy ?? {}), [galaxyId]: v }
  return v
}

/* ═══════════ 预估胜率（确定性期望推演；UI/AI 门槛同源，不消耗 rng） ═══════════ */

/**
 * 该敌卡是不是**洞内敌卡**（`wh-*`，见 `packages/data/src/wormholeFoes.ts`）。
 * 用途：把"**洞内维持中段 / 星图站远端**"这条默认期望分档口径落到**预估模型**上
 * （2026-09-15 船长裁定：星图默认抬到射程带 0.8，洞内维持 0.5）。
 * 洞内节点/撤离战的敌卡一律由 `wh-*` 派生（id 沿袭）⇒ 这里判 id 前缀即可，不必传上下文。
 */
function isWormholeCard(anomaly: AnomalyDef | undefined): boolean {
  return anomaly?.id.startsWith('wh-') === true
}

/** 稳态距离近似：双方期望距离的中点（钳制在开战距离内）。
 * `midPos` = 我方默认档在射程带内的位置（星图 0.8 / 洞内 0.5，见上）。 */
function steadyDistance(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance, midPos: number): number {
  const dMe = desiredRangeFor(me, 'mid', bal, midPos)
  const dFoe = foeDesiredRange(me, foes, bal)
  const open = battleOpenM(me, foes, bal)
  return clamp(bal.minDistanceM, open, (dMe + dFoe) / 2)
}

/** 预估胜率核心（确定性期望推演；不消耗 rng）。
 * meMul/foeMul = 命中率缩放系数（AI favor 用；玩家手动 = 1/1），返回未扩散的模型胜率 raw ∈ [0,1] */
/** 稳态预览引擎（battleWinPreview 与带伤预警共用同一公式源——DPS/承伤/tick 换算与展示一一对应）。
 * 2026-09-09 修正（real sim 终验暴露低估，docs/design/wave-battles-20260909.md）：
 * ① 多波卡：敌方总血 = 全波预算；敌方火力 = 峰值波（各波不同时在场，不吃全波火力加成）；
 * ② 护盾回充进承伤模型（引擎 shieldRegenPerSec 实回，长盘显著）——回充窗口 ≈ 直到装甲击穿，
 *    净敌火 = foeDps − 回充率，破甲时间 tA = (盾+甲)/(净敌火)，可承受总伤 = 总 EHP + 回充量。 */
function steadyPreview(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): {
  me: UnitSpec
  meHpTotal: number
  foeHpTotal: number
  meDps: number
  foeDps: number
  ttrMe: number
  ttrFoe: number
} | null {
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  // 敌血总预算（多波 = 全波；foeHpOverride/曲线同 createFoeSpecs 口径）
  const baseHp = anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)
  const foeHpTotal = baseHp
  // 敌方火力按"峰值波小队数"计（同族单位射程/单发相同；多波不吃全波同时在场加成）
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const peakUnits = waves ? Math.max(...waves.map((w) => w.units)) : 1
  const foes = peakUnits > 1 ? createFoeSpecs(anomaly, bal, { units: peakUnits }) : createFoeSpecs(anomaly, bal)
  // 距离口径（船长 2026-09-11：「预估胜率的战斗按照那个距离决定，如果没有，采用射程中段距离」）：
  // 该星系设过目标距离 → 用它（钳到本次开战距离内）；没设过 → 双方期望距离中点（旧口径）。
  const steadyPref = desirePrefOf(state, anomaly.galaxyId)
  const steady =
    steadyPref !== null
      ? clamp(bal.minDistanceM, battleOpenM(me, foes, bal), steadyPref)
      : steadyDistance(
          me,
          foes,
          bal,
          isWormholeCard(anomaly) ? bal.desireBandWormhole : bal.desireBandStarMap,
        )

  const meHpTotal = me.hp.s + me.hp.a + me.hp.h

  // 我方 DPS：逐武器（V17.2 炮台 = 固定弹种：按炮型 × 敌方血型克制精确计算；
  // V18B-2 激光 beam = 命中恒 1（必中）且按稳态距离折算威力衰减）
  let meDps = 0
  for (const w of me.weapons) {
    let shot = 0
    let ammoType: DamageType | null = null
    let hit = 0
    let power = 1
    if (w.kind === 'gun') {
      const entries = Object.entries(w.shotsByType ?? {})
      if (entries.length > 0) {
        const [t, v] = entries[0]!
        ammoType = t as DamageType
        shot = v ?? 0
      }
      hit = hitChance(w, me, foes[0]!, steady, bal)
    } else if (w.kind === 'beam') {
      ammoType = w.fixedType ?? 'plasma'
      shot = w.shotDmg ?? 0
      hit = 1 // 必中
      power = beamPowerFactor(steady, w)
    } else {
      shot = w.shotDmg ?? 0
      hit = hitChance(w, me, foes[0]!, steady, bal)
    }
    if (hit <= 0) continue
    const mult = effectiveDmgMultAgainst(foes, ammoType ?? w.fixedType ?? 'kinetic')
    // **全体攻击**（2026-09-13 船长：C 孢子导弹巢「对所有敌方同时攻击」）——
    // 预估必须同步：一轮齐射的实收 = 单目标 × **当前在场敌舰数**（多波卡按峰值波小队数，与 `foes` 同源）。
    const allFoesMul = w.allFoes === true ? Math.max(1, foes.length) : 1
    meDps += (shot * power * mult * hit * allFoesMul * 1000) / w.reloadMs
    // 附加伤害段同步（掠袭破片炮）：预估不许"卡面混伤、按纯系算"——副段走它自己那系的克制倍率
    const secPctEst = w.secondaryDamagePct ?? 0
    if (secPctEst > 0) {
      const secMul = effectiveDmgMultAgainst(foes, w.secondaryDamageType ?? 'kinetic')
      meDps += (shot * power * secMul * hit * allFoesMul * secPctEst * 1000) / w.reloadMs
    }
  }
  // 敌方 DPS（打我，含类型克制与层抗；近盲带内伤害按 blindDmgMul 折算——
  // 2026-09-08：能量 beam 必中（hit=1）且威力走 beamPowerFactor/盲带，与实时引擎同源）
  // 2026-09-10 船长（窝点混伤）：克制倍率按**火力构成加权求和**（与实时逐系结算同源，
  // 否则"卡面写混伤、预估按纯系算"会骗人）
  const foeComp = foeDamageComposition(anomaly)
  const foeCompWeighted = (type: DamageType): number =>
    foeComp.length <= 1
      ? avgLayerMult(meHpTotal, me, type)
      : foeComp.reduce((s, c) => s + c.share * avgLayerMult(meHpTotal, me, c.type), 0)
  let foeDpsPeak = 0
  for (const f of foes) {
    const w = f.weapons[0]!
    const isBeam = w.kind === 'beam'
    const hit = isBeam ? 1 : hitChance(w, f, me, steady, bal)
    if (hit <= 0) continue
    const power = isBeam ? (steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : beamPowerFactor(steady, w)) : steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : 1
    const shot = Math.max(1, Math.round((w.shotDmg ?? 0) * power))
    const mult = foeCompWeighted(w.fixedType ?? 'kinetic')
    foeDpsPeak += (shot * mult * hit * 1000) / w.reloadMs
  }
  // 2026-09-09 减员修正（稳态把"敌人满员全程输出"当真相，多单位/多波严重高估承伤）：
  // 我方逐个击毁敌方单位 → 敌方在场火力近似线性衰减，全程平均 ≈ 峰值 × (N+1)/(2N)
  // （N = 峰值波单位数；随机目标下各单位击杀时刻 ≈ 按血量比例均匀分布）
  const foeUnitN = Math.max(1, foes.length)
  const foeDps = foeDpsPeak * ((foeUnitN + 1) / (2 * foeUnitN))

  // 承伤窗口含护盾回充（2026-09-09 修正）——**2026-09-14 船长改判后为指数式**：
  // 回充按**当前盾**比例（引擎：`urt.hp.s × 费率`）⇒ 盾动力学 `ds/dt = k·s − D`（k = 费率、D = 净敌火）
  //   · 盾被打穿时刻 `tBreak = ln(D/(D − k·s₀)) ÷ k`（**仅当 D > k·s₀**；否则回充永远顶得住、盾不破）
  //   · **破盾后回充归 0**（船长「不留，破盾后 0 回复」）⇒ 之后 D 全打在甲+结构上
  //   · 装了「护盾充能装置」时：把 30 秒脉冲折成**恒定附加回充** `c = 满盾 × 每跳比例 ÷ 30 秒`，
  //     **只在破盾后计入**（盾没破时被动回充远大于它）——这样估算不会对带装置的人过分悲观。
  const foeDpsNet = foeDps * foeMul
  const k = bal.shieldRegenPerSec
  const s0 = Math.max(0, me.hp.s)
  const chargePerSec = (shieldPulsePctOf(state, ctx, shipId) * s0) / (SHIELD_PULSE_MS / 1000)
  let ttrMe: number
  if (foeDpsNet <= 0) {
    ttrMe = Number.POSITIVE_INFINITY // 敌方打不动我
  } else if (k > 0 && s0 > 0 && foeDpsNet <= k * s0) {
    ttrMe = Number.POSITIVE_INFINITY // 回充顶住敌火：盾永不破 ⇒ 只有超时血比才可能落败
  } else if (k > 0 && s0 > 0) {
    const tBreak = Math.log(foeDpsNet / (foeDpsNet - k * s0)) / k // 盾被打穿
    const after = Math.max(0, foeDpsNet - chargePerSec) // 破盾后：充能装置托底
    ttrMe = after > 0 ? tBreak + (me.hp.a + me.hp.h) / after : Number.POSITIVE_INFINITY
  } else {
    ttrMe = meHpTotal / foeDpsNet // 无回充（费率 0 或无盾）：原口径
  }
  const ttrFoe = meDps > 0 ? foeHpTotal / Math.max(1e-9, meDps * meMul) : Infinity // 我击毁敌方所需秒数
  return { me, meHpTotal, foeHpTotal, meDps, foeDps, ttrMe, ttrFoe }
}

function winPreviewRaw(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): number {
  const sp = steadyPreview(state, ctx, anomaly, shipId, meMul, foeMul)
  if (!sp) return 0
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) return 0.5
  if (!Number.isFinite(sp.ttrMe)) return 1 // 敌永远打不死我 → 必胜
  if (!Number.isFinite(sp.ttrFoe)) return 0 // 我永远打不死敌 → 必败
  return clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
}

/**
 * 带伤预警预估（2026-09-08 船长定）：在满耐久稳态模型上，把"预计承受总伤"按 盾→装甲→结构
 * 三层顺序分摊，得到预计装甲损耗比与结构损耗比（0~1）。战斗持续时长 = 先到者（我被击毁 /
 * 我击毁敌方），与实时引擎同源公式。
 */
export function bountyDamageForecast(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): { armorLoss: number; hullLoss: number; rawWin: number } {
  const sp = steadyPreview(state, ctx, anomaly, shipId, 1, 1)
  if (!sp) return { armorLoss: 0, hullLoss: 0, rawWin: 0 }
  let rawWin: number
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) rawWin = 0.5
  else if (!Number.isFinite(sp.ttrMe)) rawWin = 1
  else if (!Number.isFinite(sp.ttrFoe)) rawWin = 0
  else rawWin = clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
  const duration = Math.min(sp.ttrMe, sp.ttrFoe)
  const dmg = Number.isFinite(duration) ? sp.foeDps * duration : 0
  const afterShield = Math.max(0, dmg - sp.me.hp.s)
  const armorLoss = sp.me.hp.a > 0 ? clamp(0, 1, afterShield / sp.me.hp.a) : afterShield > 0 ? 1 : 0
  const hullLoss = sp.me.hp.h > 0 ? clamp(0, 1, Math.max(0, afterShield - sp.me.hp.a) / sp.me.hp.h) : afterShield > sp.me.hp.a ? 1 : 0
  return { armorLoss, hullLoss, rawWin }
}

/**
 * 【已退役的展示口径，2026-09-09】悬赏展示胜率 = 稳态解析 + 带伤扣分(旧方案)——探针实测双向
 * 大偏差(显示 2% 却常胜),被 winEstimate.ts 蒙特卡洛推演(玩家可见)取代。本函数保留仅作：
 * ①缓存预热完成前的临时回退显示；②活动远征视图/测试兼容。结算与 AI/工具口径 battleWinPreview 不变。
 * = 原显示胜率（满耐久基准 + logit 扩散）− 预计装甲损耗×winPenaltyArmorPerFull
 * − 预计结构损耗×winPenaltyHullPerFull（结构伤扣更重），下限 2%。
 */
export function bountyWinPercentGuarded(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): number {
  const f = bountyDamageForecast(state, ctx, anomaly, shipId)
  if (f.rawWin <= 0) return 0
  const shown = spreadWinChance(f.rawWin, ctx.balance.battle.winSpread)
  const bal = ctx.balance.battle
  const penalty = f.armorLoss * bal.winPenaltyArmorPerFull + f.hullLoss * bal.winPenaltyHullPerFull
  return Math.max(0.02, Math.min(0.98, shown - penalty))
}

/** 玩家口径预估胜率：无 favor 模型 + logit 扩散（悬赏卡/玩家手动战斗展示用；实际结算与之对应） */
export function battleWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string = state.shipId): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return spreadWinChance(raw, ctx.balance.battle.winSpread)
}

/** AI 远征 favor 优势量（与结算推进同一来源；指派与展示共用） */
export function aiFavorAdv(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return clamp(-1, 1, (raw - 0.5) * 2)
}

/** AI 口径预估胜率（"最终成功率"）：无 favor 模型 → 按 aiFavorStrength 修正命中 → logit 扩散。
 *  AI 接单门槛与 AI 指挥中心展示用它；数值 = AI 副船在该 favor 下的期望表现。 */
export function aiWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const k = ctx.balance.battle.aiFavorStrength
  const adv = aiFavorAdv(state, ctx, anomaly, shipId)
  const favored = winPreviewRaw(state, ctx, anomaly, shipId, 1 + k * adv, 1 - k * adv)
  return spreadWinChance(favored, ctx.balance.battle.winSpread)
}

/** 伤害类型 × 敌方三层占比的期望克制倍率（敌方无抗） */
function effectiveDmgMultAgainst(foes: UnitSpec[], type: DamageType): number {
  let total = 0
  let acc = 0
  for (const f of foes) {
    const s = f.hp.s + f.hp.a + f.hp.h
    total += s
    acc += f.hp.s * typeLayerMult(type, 'shield') + f.hp.a * typeLayerMult(type, 'armor') + f.hp.h * typeLayerMult(type, 'hull')
  }
  return total > 0 ? acc / total : 1
}

/** 我方三层占比 × 类型克制 × (1−层抗) 的期望倍率 */
function avgLayerMult(meHpTotal: number, me: UnitSpec, type: DamageType): number {
  if (meHpTotal <= 0) return 1
  const s = (me.hp.s / meHpTotal) * typeLayerMult(type, 'shield') * (1 - (me.resists.shield?.[type] ?? 0))
  const a = (me.hp.a / meHpTotal) * typeLayerMult(type, 'armor') * (1 - (me.resists.armor?.[type] ?? 0))
  const h = (me.hp.h / meHpTotal) * typeLayerMult(type, 'hull') * (1 - (me.resists.hull?.[type] ?? 0))
  return s + a + h
}
