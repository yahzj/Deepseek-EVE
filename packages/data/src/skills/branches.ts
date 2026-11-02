/**
 * **技能书**（技能树页的分支，2026-09-22 船长令「将现有的技能再进行细分」）——
 * 顺序即树页「技能书」导航的显示顺序；名字走 l10n（`ui.labelsText.026~048`，中英齐），本表只登记 id 与所属大类。
 */
export const SKILL_BRANCHES: readonly { readonly id: string; readonly group: string }[] = [
  { id: 'b-fly', group: '舰船' },
  { id: 'b-warship', group: '舰船' },
  { id: 'b-command', group: '舰船' },
  { id: 'b-mine', group: '矿业' },
  { id: 'b-refine', group: '工业' },
  { id: 'b-craft', group: '工业' },
  { id: 'b-probe-assembly', group: '工业' },
  { id: 'b-salvage', group: '工业' },
  { id: 'b-auto', group: '工业' },
  { id: 'b-build', group: '工业' },
  // 2026-09-30 船长令：燃料上限/节拍/收率四条技能进「实验室」书（工业大类下的子标签）
  { id: 'b-lab', group: '工业' },
  { id: 'b-indship', group: '矿业' },
  { id: 'b-weapon', group: '战斗' },
  { id: 'b-aim', group: '战斗' },
  { id: 'b-ammo', group: '战斗' },
  { id: 'b-drone', group: '战斗' },
  { id: 'b-protect', group: '工程' },
  { id: 'b-repair', group: '工程' },
  { id: 'b-ship-recovery', group: '工程' },
  { id: 'b-shipfit', group: '工程' },
  { id: 'b-ai', group: '工程' },
  { id: 'b-learn', group: '工程' },
  { id: 'b-scan', group: '探索' },
  { id: 'b-deep-space', group: '探索' },
  { id: 'b-survive', group: '探索' },
  { id: 'b-market', group: '贸易' },
  { id: 'b-bounty', group: '贸易' },
  { id: 'b-logistics', group: '物流' },
]
