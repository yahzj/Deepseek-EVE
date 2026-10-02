/**
 * **敌力曲线**（2026-10-02 从 `combat.ts` 拆出 · 批次 4e · 零行为变化）。
 *
 * 本文件 = 敌方**战力与速度的平衡曲线**：战术射程带、参考船速、血量曲线、威胁反解、
 * 多舰补偿——全部**纯 `BattleBalance` / `AnomalyDef` 读数**，只依赖 `types`（`Hp3` 请去 combatMath）。
 * `combat.ts` 原样再导出（先例：fitted.ts），winEstimate / 内容体检 / 用例等既有引用零改动。
 * `TACTIC_RANGE` / `foeSpeedBase` / `foeMultiShipCompMul` 原为模块私有，因 `createFoeSpecs`
 * 仍要用而转公开（不进 combat 公开面）。
 */
import type { AnomalyDef, BattleBalance, FoeTactic } from './types'

/** 敌方战术 → 武器射程带（贴合作战风格）：
 * brawl 贴脸肉搏 = 无最小射程的近身喷子；orbit 环绕 = 中距小炮；kite 放风筝 = 高最小射程的远距炮。
 * C4-#3（2026-09-05）：射程/速度由"虚拟装配模板"推导——射程 = 基础带 ×
 * (1 + 侧重系数×(threat−10)/90) 后封顶；速度 = 参考船速段 × m_base × tactic 系数
 * （平衡常量 battle 段 foe* 模板）。射程语义保持 tactic 身份（brawl 近战靠速度贴脸）。
 *
 * ⚠ **2026-09-11 起本表只服务旧威胁推导路径**：舰级路径（写了 `ships` 的卡）的期望交距
 * 改用**单位自己的射程带**（`UnitSpec.foeRangeBand`，见 `foeDesiredRange`）。旧路径行为一字不变。 */
export const TACTIC_RANGE: Record<FoeTactic, { max: number; min: number }> = {
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
export function foeSpeedBase(threat: number, bal: BattleBalance): number {
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
 * 故此处**去掉 `min(1, …)`**：血量随威胁继续增长；火力由 `BattleBalance.foeDpsCap`（**150 DPS**，
 * 2026-09-15 起为**「超出部分 15% 折扣」**而非硬封顶，见 `foeDpsCapScaleOf`）收敛；
 * **速度与射程成长的钳制保留**（`foeRefSpeedMps` / `growT`，避免敌人"又快又远又硬"）。
 *
 * **对现有内容的影响（实测）**：改写前全表 27 张卡威胁 ≤ 96 ⇒ `t ≤ 1` ⇒ **逐字零变化**；
 * 受影响的是"威胁 > 96"的卡（旧口径下血量冻结在 1152）。
 * ⚠ **2026-09-25 更新**：洞外 23 张常驻悬赏按「单舰 ×3」定价式重定标威胁（**属性零改动**，
 * 见 `packages/data/src/anomalies.ts` 的 `ANOMALIES` 头注）⇒ 最大者 `巨构核心勘探令` = **115**，
 * 该卡起 `t = (115−6)/90 = 1.21 > 1`、血量走出旧钳制区间（**有意**）；洞内 19 张锚点未动。
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

/**
 * **由属性反推敌卡威胁**（船长 2026-09-25 定价式的反解 · 规则的一部分）。
 *
 * 口径：`X = √(全波总血 × 全波总火力DPS) = 2 × foeHpOfThreat(威胁) ÷ 10 × 系数`
 * ⇒ `威胁 = foeHpOfThreat⁻¹( 5X ÷ 系数 )`，其中**系数 = 这张卡预设给谁打**
 * （`FOE_DESIGN_STRENGTH_MUL`：单舰 3 · 4 舰小队 10），与玩家实带舰数、敌人编成数都无关。
 *
 * 实现 = 在 `foeHpOfThreat` 上取"最小的使曲线值 ≥ 需求"的整数威胁（曲线带取整台阶，
 * 故低威胁段是**平台**：威胁 1~5 的曲线值都是 11 ~ 14，反解会落平台起点）。
 * 返回上界 1024（远高于现表最大威胁 115，只为防死循环；真触顶说明属性严重越界）。
 */
export function foeThreatRatingOf(x: number, designMul: number, bal: BattleBalance): number {
  const need = (5 * Math.max(0, x)) / Math.max(1e-6, designMul)
  return foeThreatAtHpBudgetOf(need, bal)
}

/**
 * **`foeHpOfThreat` 的反解**（**2026-10-02 加**）：取"最小的使曲线值 ≥ `needHp`"的整数威胁。
 *
 * 为什么要有它（本批的来路）：**窝点（每日赏金任务）威胁的"相对重锚"**——窝点 = 主题悬赏的强化版
 * （属性按 `LAIR_THREAT_MUL` 的比例同乘），于是它的**威胁标签**该按**同一把尺**上推：
 * `窝点威胁 = 反解( 派生倍率 × 曲线(主题卡威胁) )`。
 * 起因 = 船长 2026-10-02：「让窝点威胁按其**实际强度**重新定价，与入侵/常驻悬赏同尺（只改数字，
 * 战斗零变化）」——旧口径是 `round(主题威胁 × 倍率)` 的**线性**乘积，而血曲线是**非线性**的，
 * 于是深层窝点印出 230（比入侵旗舰 170 还高），实际强度却没到那儿。
 *
 * ⚠ 曲线带取整台阶 ⇒ 低威胁段是**平台**（威胁 1~5 的曲线值都落在 11~14），反解会落平台起点；
 * 返回上界 1024（远高于现表最大威胁，只为防死循环）。
 */
export function foeThreatAtHpBudgetOf(needHp: number, bal: BattleBalance): number {
  const need = Math.max(0, needHp)
  let lo = 1
  let hi = 1024
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (foeHpOfThreat(mid, bal) >= need) hi = mid
    else lo = mid + 1
  }
  return lo
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
export function foeMultiShipCompMul(anomaly: AnomalyDef): number {
  const n = (anomaly.ships ?? []).reduce((s, x) => s + Math.max(1, Math.floor(x.count ?? 1)), 0)
  return n <= 1 ? 1 : (2 * n) / (n + 1)
}

/**
 * **引擎内部判据用的威胁**（**2026-10-02 船长令取「乙」**）：`threatJudged ?? threat` —— **唯一入口**。
 *
 * 谁读它：① `pdEnabledFor`（威胁 ≥ 60 ⇒ 敌舰装近防炮）· ② 敌「船体修理装置」强度 `k = max(1, 威胁 ÷ 45)`。
 * 字段的含义与两次定价批次的来路见 `AnomalyDef.threatJudged` 的注释。
 *
 * 一句话口径：**`threat` 是给玩家看的价目表，`threatJudged` 是引擎判据的输入**；
 * "只重锚标签"的批次必须同时把 `threatJudged` 钉在重锚前的值上，否则那两个判据会跟着漂。
 */
export function foeJudgedThreatOf(a: { threat: number; threatJudged?: number }): number {
  return a.threatJudged ?? a.threat
}