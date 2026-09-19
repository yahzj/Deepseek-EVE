/**
 * **谜质科技树节点表**（船长 2026-09-19：「先挂起，我打算用制作一个消耗谜质升级的研究科技树。」
 * ＋「消耗谜质和信用点。不消耗时间。主要研究对虫洞内的战斗和探索。另外含部分洞外工业科技。
 * 谜质单价提高到70W。研究入口放在扫描虫洞界面内。将现有的扫描虫洞分出2个子页面：虫洞探索和谜质科技」）。
 *
 * **三线 · 4 层 · 23 节点**（逐线讨论后的定稿，数值全部经船长点头；逐条沿革见工作文档
 * `docs/design/matter-tech-20260919.md`）：
 * - **A 探索线 6**：时序锚定器（T1·10 级·最大回合数 +10/级）· 引力吊臂（T2·打捞器效率 +20%/级）·
 *   富集钻头（T2·采集器效率 +20%/级）· 折叠货舱（T2·货仓格 +4/级）· 谐振信号滤波阵列
 *   （T3·扫描虫洞间隔 −5%/级·5 级）· 时间压缩矩阵（T4·2 级·洞内战斗 ×2 / ×4）；
 * - **B 战斗线 14**：三层抗性缺口 +0.05/级（T1/T1/T2）· 命中 +1%/级 · 回避 +1%/级 · 敌命中 −1%/级 ·
 *   射程 +4%/级 · 装填 −3%/级 · 单发 +3%/级 · 近盲削减 +0.05/级 · 节点威胁 −3%/级 · 守卫威胁 −3%/级 ·
 *   机群回收 +5%/级 · 战地自修（T4·2 级·战后回复 +10%/级）；
 * - **C 工业线 3**：货柜拆解技术（T2·拆解周期 −25%/级）· 虚空精炼技术（T3·虚空晶回收 +10%/级）·
 *   残骸解析技术（T3·残骸保底原材料 +5%/级）。
 *
 * ⚠ **本表只描述"是什么"**：效果语义与聚合在 `core/matterTech.ts`（按 `effect` 关键字汇总，**不认 id**）；
 * 这里写错 `effect` ⇒ 体检判红 + 引擎忽略。费用单位 = 谜质 **枚** / 信用点 **ISK**，逐级给出。
 * ⚠ 费用随层单调上升由体检契约守（T1 `2·4·6` / T2 `5·10·15` / T3 `10·20·30` / T4 `30·60`）。
 */
import type { MatterTechNodeDef } from '@whale/core'

export const MATTER_TECH_NODES: readonly MatterTechNodeDef[] = [
  /* ══════════════ A 虫洞探索线（6） ══════════════ */
  {
    id: 'mt-explore-turn',
    name: '时序锚定器',
    branch: 'explore',
    tier: 1,
    effect: 'whTurnMax',
    per: 10,
    maxLevel: 10,
    essence: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
    isk: [
      3_000_000, 3_000_000, 3_000_000, 3_000_000, 3_000_000,
      3_000_000, 3_000_000, 3_000_000, 3_000_000, 3_000_000,
    ],
    note: '每级提高虫洞探索的最大回合数 10（永久加成；与本趟带出的「时序核心」各自相加）。',
  },
  {
    id: 'mt-explore-salvage',
    name: '引力吊臂',
    branch: 'explore',
    tier: 2,
    effect: 'whSalvageEff',
    per: 0.2,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    prereq: { 'mt-explore-turn': 1 },
    note: '每级提高打捞器效率 20%：每次打捞按效率额外多捞若干堆（每满 100% 必多捞 1 堆，余数按概率）。',
  },
  {
    id: 'mt-explore-collect',
    name: '富集钻头',
    branch: 'explore',
    tier: 2,
    effect: 'whCollectEff',
    per: 0.2,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    prereq: { 'mt-explore-turn': 1 },
    note: '每级提高采集器效率 20%：每次采集按效率额外多采若干堆（每满 100% 必多采 1 堆，余数按概率）。',
  },
  {
    id: 'mt-explore-hold',
    name: '折叠货舱',
    branch: 'explore',
    tier: 2,
    effect: 'whHoldCells',
    per: 4,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    prereq: { 'mt-explore-turn': 1 },
    note: '每级提高虫洞货仓有效格 4。',
  },
  {
    id: 'mt-explore-scan',
    name: '谐振信号滤波阵列',
    branch: 'explore',
    tier: 3,
    effect: 'whScanCut',
    per: 0.05,
    maxLevel: 5,
    essence: [10, 20, 30, 40, 50],
    isk: [10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000],
    prereq: { 'mt-explore-turn': 2 },
    note: '每级缩短「扫描虫洞」的扫描间隔 5%（与技能链相乘）。',
  },
  {
    id: 'mt-explore-speed',
    name: '时间压缩矩阵',
    branch: 'explore',
    tier: 4,
    effect: 'whBattleSpeed',
    per: 2,
    maxLevel: 2,
    essence: [30, 60],
    isk: [120_000_000, 240_000_000],
    prereq: { 'mt-explore-scan': 1 },
    note: '解锁虫洞内战斗的倍速：1 级 ×2、2 级 ×4（战斗中可随时切回 ×1）。',
  },

  /* ══════════════ B 虫洞战斗线（14） ══════════════
   * ⟪文案调整 2026-09-19⟫ 12 条说明尾部补「（仅洞内战斗生效）」——船长：「**虫洞战斗的科技说明需要
   *   提及仅针对虫洞内敌人**」。技术核对（本批复核过）：本线效果**确实只在虫洞内的战斗里生效**——
   *   我方增益走 `applyMatterPlayerBuffs`（三个调用点全在 `battle.wormhole` 路径上）、
   *   威胁/敌命中/近盲走 `wormholeMatterBattleModsOf`（非洞内恒返回 `null`）、
   *   无人机回收与战后回复走 `wormholeBattle` 的洞内结算。
   *   两条威胁说明**原文已写明"洞内"**（洞内节点战 / 洞内层末守卫）⇒ 不重复加尾注。
   *   ⚠ 英文覆盖层 `EN_MATTER_TECH` 目前只有 `name`（无说明）⇒ 本次改动不造成英文漂移。 */
  {
    id: 'mt-battle-shield',
    name: '谐振护盾阵列',
    branch: 'battle',
    tier: 1,
    effect: 'whResistShield',
    per: 0.05,
    maxLevel: 3,
    essence: [2, 4, 6],
    isk: [3_000_000, 6_000_000, 9_000_000],
    note: '每级降低护盾层对敌方主用伤害系的抗性缺口 5%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-armor',
    name: '装甲重排',
    branch: 'battle',
    tier: 1,
    effect: 'whResistArmor',
    per: 0.05,
    maxLevel: 3,
    essence: [2, 4, 6],
    isk: [3_000_000, 6_000_000, 9_000_000],
    note: '每级降低装甲层对敌方主用伤害系的抗性缺口 5%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-hull',
    name: '骨架强化',
    branch: 'battle',
    tier: 2,
    effect: 'whResistHull',
    per: 0.05,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    prereq: { 'mt-battle-shield': 1, 'mt-battle-armor': 1 },
    note: '每级降低结构层对敌方主用伤害系的抗性缺口 5%（仅洞内战斗生效；前置：谐振护盾阵列与装甲重排各 1 级）。',
  },
  {
    id: 'mt-battle-hit',
    name: '追踪校准',
    branch: 'battle',
    tier: 1,
    effect: 'whHit',
    per: 0.01,
    maxLevel: 3,
    essence: [2, 4, 6],
    isk: [3_000_000, 6_000_000, 9_000_000],
    note: '每级提高我方命中 1%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-evasion',
    name: '陀螺规避',
    branch: 'battle',
    tier: 2,
    effect: 'whEvasion',
    per: 0.01,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    prereq: { 'mt-battle-hit': 1 },
    note: '每级提高我方回避 1%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-noise',
    name: '信号噪化',
    branch: 'battle',
    tier: 2,
    effect: 'whEnemyHitDown',
    per: 0.01,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    prereq: { 'mt-battle-hit': 1 },
    note: '每级降低敌方命中 1%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-range',
    name: '测距延展',
    branch: 'battle',
    tier: 2,
    effect: 'whRange',
    per: 0.04,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    prereq: { 'mt-battle-hit': 1 },
    note: '每级提高我方全武器射程 4%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-reload',
    name: '装填机构优化',
    branch: 'battle',
    tier: 3,
    effect: 'whReload',
    per: 0.03,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    prereq: { 'mt-battle-range': 1 },
    note: '每级缩短我方武器装填周期 3%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-damage',
    name: '弹丸强化',
    branch: 'battle',
    tier: 3,
    effect: 'whDamage',
    per: 0.03,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    prereq: { 'mt-battle-range': 1 },
    note: '每级提高我方单发伤害 3%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-blind',
    name: '近盲抑制',
    branch: 'battle',
    tier: 3,
    effect: 'whBlindReduce',
    per: 0.05,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    prereq: { 'mt-battle-range': 1 },
    note: '每级降低敌方在近盲带内的伤害比例 5%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-threat-node',
    name: '压制力场增幅',
    branch: 'battle',
    tier: 3,
    effect: 'whThreatNode',
    per: 0.03,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    prereq: { 'mt-battle-noise': 1 },
    note: '每级降低洞内节点战的敌方威胁 3%。',
  },
  {
    id: 'mt-battle-threat-boss',
    name: '守卫解析',
    branch: 'battle',
    tier: 3,
    effect: 'whThreatBoss',
    per: 0.03,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    prereq: { 'mt-battle-noise': 1 },
    note: '每级降低洞内层末守卫的威胁 3%。',
  },
  {
    id: 'mt-battle-drone',
    name: '谐振回收网',
    branch: 'battle',
    tier: 3,
    effect: 'whDroneRecovery',
    per: 0.05,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    prereq: { 'mt-battle-evasion': 1 },
    note: '每级提高被击落无人机的回收率 5%（仅洞内战斗生效）。',
  },
  {
    id: 'mt-battle-repair',
    name: '战地自修',
    branch: 'battle',
    tier: 4,
    effect: 'whFieldRepair',
    per: 0.1,
    maxLevel: 2,
    essence: [30, 60],
    isk: [120_000_000, 240_000_000],
    prereq: { 'mt-battle-drone': 1 },
    note: '每级让战斗结束后的装甲与结构回复 10%（仅洞内战斗生效）。',
  },

  /* ══════════════ C 洞外工业线（3 · 船长 2026-09-19 重做） ══════════════ */
  {
    id: 'mt-industry-unbox',
    name: '货柜拆解技术',
    branch: 'industry',
    tier: 2,
    effect: 'unboxTimeCut',
    per: 0.25,
    maxLevel: 3,
    essence: [5, 10, 15],
    isk: [6_000_000, 12_000_000, 18_000_000],
    note: '每级缩短货柜拆解周期 25%。',
  },
  {
    id: 'mt-industry-void',
    name: '虚空精炼技术',
    branch: 'industry',
    tier: 3,
    effect: 'voidCrystalYield',
    per: 0.1,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    note: '每级提高虚空母矿精炼出的虚空晶数量 10%。',
  },
  {
    id: 'mt-industry-wreck',
    name: '残骸解析技术',
    branch: 'industry',
    tier: 3,
    effect: 'wreckMineralYield',
    per: 0.05,
    maxLevel: 3,
    essence: [10, 20, 30],
    isk: [10_000_000, 20_000_000, 30_000_000],
    note: '每级提高残骸回收的保底原材料产出 5%。',
  },
]

/** 按 id 索引（`ctx.matterTech` 用它；体检校验 id 唯一与前置可解析） */
export function buildMatterTechCatalog(): ReadonlyMap<string, MatterTechNodeDef> {
  const map = new Map<string, MatterTechNodeDef>()
  for (const node of MATTER_TECH_NODES) map.set(node.id, node)
  return map
}
