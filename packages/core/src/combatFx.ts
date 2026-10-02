/**
 * **战斗演出层**（2026-10-02 从 `combat.ts` 拆出 · 批次 4c · 零行为变化）。
 *
 * 本文件 = 战斗的**特效演出**：入场窗口三常量、敌方跃迁入场时刻盖章、可视化开火事件环、
 * 战斗内提示条——全部**纯 BattleState 写账**（只依赖 `state` 的类型，无战斗引擎内部件）。
 * `combat.ts` 原样再导出（先例：fitted.ts），BattleScreen / 用例等既有引用零改动。
 */

/**
 * **入场飞入时长（ms）**——船长 2026-09-13「舰船从屏幕外以减速的形式进场」，2026-09-14 补定
 * 「**动画没结束不开火**」⇒ 它就是**入场窗口**的长度。**界面与引擎同源**：`panels/BattleScreen.tsx`
 * 直接 import 这个数当 `--arrive-ms`，不许再各写一份（否则"窗口"与"看得见的动画"会脱钩）。
 */
export const BATTLE_ARRIVAL_FLY_MS = 950
/** **逐舰入场错峰（ms）**：同批入场第 i 条舰的入场时刻 = 群入场时刻 + i×本值（界面同一算式） */
export const BATTLE_ARRIVAL_STAGGER_MS = 60

/**
 * **洞内敌方首轮齐射的逐舰相位错开（ms/条）**（船长 2026-09-16：「错开首轮齐射」）。
 *
 * 为什么需要（同日实测）：洞内敌舰装填一致、开场即满弹、且入场窗口把首发全推到同一刻
 * ⇒ **整卡首轮同时落地**：层 1 一张卡的同步首轮 = 我方单舰（长尾鲨满配 648 血）的 **99%~137%**，
 * 层 2 E 族单体一轮即 103% ⇒ 配合族定选靶就是"一击秒掉一艘"。
 *
 * 口径：同批入场的第 `idx` 条敌舰，首发再推后 `idx × 本值`；此后**各自保持相位**
 * （装填相等 ⇒ 相位差永久保留）⇒ 一轮齐射被摊成 N 拍，**总 DPS 与期望伤害不变**。
 * **确定性、不吃随机数**；**只作用于洞内战斗**（首波由 `stampFoeArrivalFx`、波次转场/增援由 `seedUnit`
 * 的 `foePhaseMs` 带入；洞外两条路径都不传 ⇒ **洞外读数逐字不变**）。
 */
export const WORMHOLE_FOE_VOLLEY_STAGGER_MS = 900

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
    // 首发也推到窗口之后（与 `seedUnit` 同一条判据：动画没演完不开火）；
    // 2026-09-16 船长「错开首轮齐射」：再按编成序各推 `idx × WORMHOLE_FOE_VOLLEY_STAGGER_MS`
    // ⇒ 全敌不再同时落地（本函数**只被洞内调用**，洞外首波不盖 ⇒ 洞外读数不变）。
    rt.weapons = rt.weapons.map(
      (cd) => Math.max(cd, BATTLE_ARRIVAL_FLY_MS + idx * WORMHOLE_FOE_VOLLEY_STAGGER_MS),
    )
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

/** **战斗内提示条**（画面顶部提示位，与「敌方增援」同一处显示）——2026-09-11 船长二次裁定：
 *  「**日志内不用显示提示，将该提示放入战斗画面内显示**（和敌方增援统一下系统，**显示位置改为战斗
 *  窗口正上方**）」⇒ 机制提示**不写 `addLog`**，改推这里；UI 按 `atMs` 限时显示后自动消失。
 *  只保留最近 4 条（提示位是"当前正在发生的事"，不是留档——留档归战报）。 */
export function pushBattleNotice(b: import('./state').BattleState, text: string): void {
  /**
   * **同类提示同时只留一条**（**船长 2026-10-01 实测反馈**：「**跃迁规避的提示同样过于频繁
   * （同类提示建议同时只存在一条）**」）——
   * 先按**文字**去掉已有的同款，再把新的一条推到末尾 ⇒ 反复触发的机制（闪现/规避/自毁…）
   * 在提示位里始终最多一条、且总显示**最近一次**的时刻。
   * ⚠ 只按"文字完全相同"判同款（不做模糊匹配）；不同机制的提示互不影响；上限仍 4 条。
   */
  const fresh = (b.notices ?? []).filter((n) => n.text !== text)
  b.notices = [...fresh, { atMs: b.lastTickGameMs, text }].slice(-4)
}
