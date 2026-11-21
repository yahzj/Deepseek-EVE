/** 第二阶段独立预览中文注入，正式接入时再落全局本地化表。 */
export const STAGE_LABELS: Readonly<Record<string, string>> = {
  idle: '待命', qualifying: '基础舰员资格', training: '模拟训练', mission: '外派中', guard: '守备中',
  'fire-control': '火控模拟', 'damage-control': '损管模拟', drones: '机群模拟',
  fireControl: '火控', piloting: '操舰', engineering: '工程', command: '指挥',
  patrol: '有限巡逻', clear: '来源清剿', escort: '补给护航',
  outbound: '出发航程', operation: '执行任务', returning: '安全返航',
  victory: '胜利', defeat: '失利', stopped: '已停止', supplies: '补给不足',
  person: '人员不可用或已有安排', ship: '舰船不可用或已有安排', busy: '已有任务安排',
  facility: '设施或资格不足', power: '供电或生活保障不足', requirements: '发展目标尚未齐备',
  completed: '已完成', materials: '所需物资不足', points: '技能点不足', opportunity: '尚无学习机会',
  attributes: '属性未达学习要求', 'invalid-action': '操作无效',
  team: '团队不存在', tier: '资格档位不符或已达当前上限',
  course: '训练舰缺少对应武器、维修或机群配置', skill: '技能不存在或已经学会',
  choice: '没有待回复的培养选择', name: '团队呼号无效', teams: '所选团队或舰船不可用',
  source: '敌对来源不可用', cleared: '来源已经清除', facilities: '生活保障或服务设施不可用',
  unassigned: '尚未安排任务', paused: '已暂停', harassment: '受到袭扰，任务暂停',
}
export function stageLabel(value: string): string { return STAGE_LABELS[value] ?? value }
