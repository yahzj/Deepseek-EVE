import type { DataEditorApi, EditorProject, EditorRow, NumericField } from './model'

const field = (path: string, label: string, group: string, unit: string, extra: Partial<NumericField> = {}): NumericField => ({ path, label, group, unit, min: 0, writable: true, ...extra })
const rows: EditorRow[] = [
  ...['巡洋舰样例 A', '巡洋舰样例 B', '货运舰样例 C'].map((name, index): EditorRow => ({
    id: `demo-ship-${index + 1}`, name, category: index === 2 ? '货运舰' : '武装舰', tier: 3, table: 'ships', group: 'ships',
    values: { shield: 1800 + index * 200, armor: 1200, hull: 900, cpu: 180, cargo: index === 2 ? 18000 : 2400, resist: { kinetic: index === 1 ? 0 : 0.2 } },
    fields: [field('shield', '护盾', '防御', 'HP'), field('armor', '装甲', '防御', 'HP'), field('hull', '结构', '防御', 'HP'), field('resist.kinetic', '动能抗性', '防御', '', { percent: true, max: 1 }), field('resist.energy', '能量抗性', '防御', '', { percent: true, max: 1 }), field('cpu', 'CPU', '装配', '', { integer: true }), field('cargo', '货仓', '容量', 'm³'), field('derivedSlots', '派生插件槽', '装配', '格', { writable: false })],
  })),
  { id: 'demo-module', name: '装填模块样例', category: '武器', tier: 2, table: 'modules', group: 'modules', values: { cpu: 24, reloadMs: 3200, damage: 1.4 }, fields: [field('cpu', 'CPU', '装配', '', { integer: true }), field('reloadMs', '装填间隔', '武器', 'ms', { integer: true }), field('damage', '伤害倍率', '武器', '倍')] },
  { id: 'demo-plug', name: '护盾插件样例', category: '防御', tier: 1, table: 'plugs', group: 'plugs', values: { shieldBonus: 0.12 }, fields: [field('shieldBonus', '护盾增益', '防御', '', { percent: true })] },
  { id: 'demo-item', name: '无人机样例', category: '无人机', table: 'items', group: 'items', values: { unitM3: 5, damage: 12 }, fields: [field('unitM3', '单位体积', '容量', 'm³'), field('damage', '单发伤害', '武器', '')] },
  { id: 'demo-market', name: '商品样例', category: '舰船', table: 'market', group: 'market', values: { basePrice: 12000000, stock: 0 }, fields: [field('basePrice', '基准价', '价格', '信用点', { integer: true }), field('stock', '目标库存', '供需', '件', { integer: true })] },
]
const project: EditorProject = { root: 'mock://readonly', branch: '只读演示', head: 'demo', writable: false, fingerprint: 'readonly-demo', rows, warnings: ['演示数据不是项目数据，所有写入与执行操作均不可用。'] }
const denied = async () => ({ ok: false, message: '只读演示没有桌面桥接，未执行任何操作。' })
export const devApi: DataEditorApi = {
  chooseProject: async () => null,
  openProject: async () => structuredClone(project),
  preview: async () => ({ token: '', changes: [], issues: [{ message: '只读演示不可保存' }], warnings: [] }),
  save: denied, restore: denied, check: denied, build: denied,
  exportChanges: async () => false,
  setDirty: () => {},
}
