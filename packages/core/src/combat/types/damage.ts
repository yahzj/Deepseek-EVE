/** 功能域职责拆分，保持原计算与顺序。 */


/** 伤害类型（V10.5 战斗数值契约：远行星号体系——动能/高爆/能量三系） */
export type DamageType = 'kinetic' | 'explosive' | 'plasma'

/** 一层装甲/护盾对三系伤害的减伤（V10.5b：EVE 式"每层多抗"的 3 类型版；0~0.9，缺省 0） */
export type DamageResists = Partial<Record<DamageType, number>>

/** 无人机等小型作战单位的生存包（V11 补：三层血量/抗性/回避；
 * v1 无人机并入主船火力不单独承伤，数据为"可被击落"机制的零迁移契约） */
export interface DroneDefense {
  shieldHp: number
  armorHp: number
  hullHp: number
  shieldResist?: DamageResists
  armorResist?: DamageResists
  hullResist?: DamageResists
  /** 基础回避 0~0.9（小体积无人机应偏高） */
  evasion?: number
}

/** 无人机分类（2026-09-10 船长拍板；与射程分类一一对应：侦察机 2500 / 战斗机 3000 /
 * 攻坚机 3500 / 哨戒机 5000） */
export type DroneClass = 'scout' | 'combat' | 'assault' | 'sentry'

/** 敌方战术性格（V11）：brawl 贴脸近战 / orbit 中距绕圈 / kite 拉远吊打 */
export type FoeTactic = 'brawl' | 'orbit' | 'kite'

/**
 * **虫洞内敌方选靶模式**（船长 2026-09-13 定 · 虫洞专属机制）。
 *
 * 多单位战斗（我方 4 艘同时参战）下，敌人按本模式从**存活我方单位**里挑目标；
 * 并列（同输出 / 同档 / 多艘非战斗船）一律**等权随机**。
 *
 * - `random` 缺省：等权随机（与"每发独立抽敌人"对称）
 * - `top-output`：打**武器名义 DPS 之和**最高的那艘
 * - `smallest` / `largest`：按**舰种档**（T1 护卫舰 … T4 战列舰）取最小 / 最大
 * - `noncombat`：打**非战斗船**（舰种定位 `industrial` 工业/采矿 · `hauler` 货舰；
 *   `armed` 武装 / `armored` 装甲不算）；**编队里没有非战斗船时退回 `random`**
 *
 * ⚠ **只有虫洞内的敌卡会写**（`AnomalyDef.foeTargeting`）——现有 27 张悬赏卡、低安遭遇、
 * 窝点派生卡一律不写 ⇒ 单船路径连选靶函数都不调用，行为与随机数消费顺序**逐字节不变**。
 */
export type FoeTargetingMode = 'random' | 'top-output' | 'smallest' | 'largest' | 'noncombat'

/** 异常空间/悬赏目标（远征目的地） */
/**
 * 敌族字母（A 海盗舰系 / B 武装拾荒者 / C 异形生物 / D 守墓古舰 / E 泰坦巨构 / G 鱿鱼亡军 /
 * **H 墨潮帮**）。
 *
 * ⚠ **`'F'`（制式巡逻）已于 2026-09-11 废弃**（船长「废弃F族，将F族融合进A族」）：
 * 字母位**永久保留为空位**（不分配给新族；旧内容表/旧导出带 `'F'` 时仍能解析），
 * 但**任何卡不得再登记 `'F'`**（契约「敌族显式登记契约」拦下）；四张旧遭遇模板已显式登记 A 族。
 *
 * ⚠ **`'H'`（墨潮帮 · The Ink Tide）2026-09-24 新增**（船长：「A族变种（其实也可以视作新种族）」
 * ⇒ 追问后定名「**叫'墨潮帮'（The Ink Tide）**」＋ 族格「**H ＋ 中速带 0.90~1.30×**」＋
 * 「配色**依旧红色色系最好**」）——它是 A 族海盗的**变种/叛出分支**：壳体沿用海盗系的性格
 * （快、贴脸、动能为主），但**另立族字母**（不碰 A 族"只用护卫/驱逐/巡洋三档、不配战列级"的族格），
 * 为**周末入侵**提供一族可打 T5 旗舰的对手。原 A 族变种那批壳体与族格**一字未动**。
 *
 * ⚠ **`'R'`（光环 · Corona Systems）2026-10-01 新增**（船长：「**是新势力：余晖，你可以查阅下远行星号中的
 * 无人机敌对势力余晖，我们参考那个做**」；裁定「族格**新立**、不复制 A 族」）——参考远行星号 Remnants
 * 的设定骨架（**全无人 AI 舰队残余**），转成本作的一支：**护盾特化 ＋ 偏等离子 ＋ 每艘自带机巢**，
 * 与 H 族（快、贴脸、动能高爆、红色系）形成**正对照**。族格**另立**，不是任何既有族的分支。
 */
export type FoeFamily = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'R'
