import { TABLES } from './content-schema'
import ships from '../packages/data/src/static/ships.json'
import modules from '../packages/data/src/static/modules.json'
import plugs from '../packages/data/src/static/plugs.json'
import items from '../packages/data/src/static/items.json'
import market from '../packages/data/src/static/market.json'
import { staticDocumentIssues } from '../packages/data/src/staticData'
import type { StaticFieldTypes } from '../packages/data/src/staticData'
import type { DataDocument, DataRow, DataTable, EditorChange, EditorIssue, EditorRow, NumericEdit, NumericField } from './data-editor-contract'
import { ENEMY_FILES, isEnemyTable, enemyRowsOf, enemyDocumentIssues } from './data-editor-enemy-schema'

export const BASE_TABLES = ['ships', 'modules', 'plugs', 'items', 'market'] as const
export const TABLE_FILES: Record<DataTable, string> = { ...Object.fromEntries(BASE_TABLES.map(table => [table, `packages/data/src/static/${table}.json`])), ...ENEMY_FILES } as Record<DataTable, string>
const TITLES: Record<string, string> = {
  tier: '舰船级别', cargoM3: '货仓容量', cycleSeconds: '采集周期', oreUnitsPerCycle: '每周期产量', priceIsk: '定义价格', agility: '动力',
  powerBonus: '武器伤害加成', shieldHp: '护盾', armorHp: '装甲', hullHp: '结构', cpu: 'CPU总量', cpuUse: 'CPU占用',
  'slots.high': '高槽', 'slots.mid': '中槽', 'slots.low': '低槽', droneBayM3: '无人机舱', maxSpeedMps: '最高速度', warpSpeedAus: '跃迁速度',
  massKg: '质量', lockRangeM: '锁定范围', signatureM: '信号半径', scanResMm: '扫描分辨率', evasion: '闪避', hitBonus: '命中加成',
  bonus: '产量或容量加成', reloadMs: '装填间隔', dmgMult: '单发倍率', maxRangeM: '最大射程', minRangeM: '最小射程', hitRate: '命中率', falloff: '距离衰减',
  droneDmgBonus: '无人机伤害加成', baseSellPriceIsk: '基础估值', unitM3: '单位体积', dmg: '单发伤害',
  basePrice: '商品基准价', poolTarget: '目标库存', supplyFlow: '每窗供应流量', supplyMultiplier: '供应价倍率', demandMultiplier: '收购价倍率',
  limitedSupplyCap: '出售额度上限', limitedSupplyEveryMs: '补货周期', limitedSupplyUnits: '每次补货量', standingReq: '声望门槛',
  'defense.shieldHp': '机体护盾', 'defense.armorHp': '机体装甲', 'defense.hullHp': '机体结构', 'defense.evasion': '机体闪避',
  workEfficiency: '作业效率加成', shieldHpAdd: '护盾固定增加', armorHpAdd: '装甲固定增加', hullHpAdd: '结构固定增加',
  speedPenaltyMps: '速度降低', speedAddMps: '速度固定增加', plugSlots: '插件槽', gunCount: '炮数',
  speedBonusPct: '战斗速度加成',
  rareQtyMul: '稀有订单批量倍率', rareWeightMul: '稀有订单权重倍率', absorbQtyPerWindow: '每窗吸收量',
  stealthCpuMul: '隐秘装置CPU倍率', foeRangeDebuffPct: '敌方射程削减', weaponRangeBonusPct: '武器射程加成', fleetDamageBonusPct: '编队伤害加成',
}
const baseDocs = { ships, modules, plugs, items, market } as unknown as Record<DataTable, DataDocument>
export function registerStaticDocuments(documents: Partial<Record<DataTable, DataDocument>>): void { Object.assign(baseDocs, documents) }
export function getValue(row: DataRow, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' && !Array.isArray(value) ? (value as DataRow)[key] : undefined, row)
}
function setValue(row: DataRow, path: string, value: number): void {
  const keys = path.split('.')
  let object = row
  for (const key of keys.slice(0, -1)) { if (!object[key] || typeof object[key] !== 'object') object[key] = {}; object = object[key] as DataRow }
  object[keys.at(-1)!] = value
}
function numbersOf(row: DataRow, prefix = ''): string[] {
  return Object.entries(row).flatMap(([key, value]) => typeof value === 'number' ? [prefix + key] : value && typeof value === 'object' && !Array.isArray(value) ? numbersOf(value as DataRow, `${prefix}${key}.`) : [])
}
function fieldOf(table: DataTable, path: string): NumericField {
  const column = TABLES.find(spec => spec.name === table)?.cols.find(col => col.p === path && ['num', 'obj'].includes(col.k))
  const percent = /Resist|Pct$|Bonus$|(?:^|\.)(?:agility|evasion|hitRate|falloff)$|^bonus$|^workEfficiency$/.test(path) && !/cpuBonus|speedAdd|BonusM3/.test(path)
  const last = path.split('.').at(-1)!
  const unit = percent ? '%' : /Ms$/.test(last) ? 'ms' : /Seconds$/.test(last) ? 's' : /M3$/.test(last) ? 'm3' : /Mps$/.test(last) ? 'm/s' : /Aus$/.test(last) ? 'AU/s' : /Kg$/.test(last) ? 'kg' : /RangeM$|signatureM/.test(last) ? 'm' : /Price|priceIsk|CostIsk/.test(last) ? '信用点' : /Mul|Mult/.test(last) ? 'x' : ''
  const group = /Price|priceIsk|pool|Flow|Supply|Multiplier/.test(path) ? '价格与供应' : /Resist|Hp|evasion/.test(path) ? '防御' : /cpu|slots|Bay|cargo|plugSlots/.test(path) ? '装配与货仓' : /Speed|speed|agility|mass/.test(path) ? '机动' : '效果与作业'
  const resist = /^(?:(defense)\.)?(shield|armor|hull)Resist(?:Add)?\.(kinetic|explosive|plasma)$/.exec(path)
  const resistLabel = resist ? `${{ shield: '护盾', armor: '装甲', hull: '结构' }[resist[2]!]}${{ kinetic: '动能', explosive: '爆破', plasma: '能量' }[resist[3]!]}抗性` : undefined
  return { path, label: TITLES[path] ?? resistLabel ?? column?.head.split(/[（(]/)[0] ?? path, group, unit, percent,
    min: column?.min ?? (/Penalty|damage|Dmg|Hp|cpu|slots|Bay|cargo|Price|speed|Speed|Range|Mult/.test(path) ? 0 : undefined),
    max: column?.max, integer: column?.int ?? /slots\.|Slots|gunCount|Ms$/.test(path), writable: path !== 'tier' && path !== 'plugSlots' }
}
export function rowsOf(table: DataTable, document: DataDocument): EditorRow[] {
  if (!document) return []
  if (isEnemyTable(table)) return enemyRowsOf(table, document)
  return Object.entries(document.groups).flatMap(([group, rows]) => rows.map(row => ({
    table, group, id: String(row.id ?? row.key), name: String(row.name ?? row.id ?? row.key), tier: typeof row.tier === 'number' ? row.tier : undefined,
    category: String(row.role ?? row.slot ?? row.kind ?? group), values: row,
    fields: [...new Set(numbersOf(row))].map(path => ({ ...fieldOf(table, path), writable: fieldOf(table, path).writable && typeof getValue(row, path) === 'number' })),
  })))
}
export function validateDocument(value: unknown, table: DataTable, contract?: StaticFieldTypes): EditorIssue[] {
  if (isEnemyTable(table)) return enemyDocumentIssues(value, table)
  const issues: EditorIssue[] = staticDocumentIssues(value, contract).map(message => ({ message, table }))
  const issue = (message: string, id?: string, path?: string) => issues.push({ message, table, id, path })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ message: '数据文件必须是对象', table }]
  const doc = value as DataDocument
  if (doc.format !== 'whale-static-data' || doc.version !== 1 || doc.table !== table || !doc.groups || typeof doc.groups !== 'object' || Array.isArray(doc.groups)) return [{ message: '数据文件格式、版本或表名不匹配', table }]
  const ids = new Set<string>()
  for (const [group, rows] of Object.entries(doc.groups)) {
    if (!Array.isArray(rows)) { issue(`分组${group}必须为数组`); continue }
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) { issue('条目必须为对象'); continue }
      const id = row.id ?? row.key
      if (typeof id !== 'string' || !id || ids.has(id)) { issue('主键无效或重复', String(id)); continue }
      ids.add(id)
      const walk = (item: unknown, path: string): void => {
        if (typeof item === 'number') {
          const field = fieldOf(table, path)
          if (!Number.isFinite(item) || (field.integer && !Number.isSafeInteger(item))) issue('数值必须有限，整数不得超出安全范围', id, path)
          if (field.min !== undefined && item < field.min && !(path === 'basePrice' && item === 0 && row.unreleased === true)) issue(`不得小于${field.min}`, id, path)
          if (field.max !== undefined && item > field.max) issue(`不得大于${field.max}`, id, path)
        } else if (item && typeof item === 'object') {
          for (const [key, child] of Object.entries(item)) { if (['__proto__', 'constructor', 'prototype'].includes(key)) issue('禁止的字段名', id, path); walk(child, path ? `${path}.${key}` : key) }
        } else if (item === null) issue('未设置须省略字段，不能写null', id, path)
      }
      walk(row, '')
      if (typeof row.minRangeM === 'number' && typeof row.maxRangeM === 'number' && row.minRangeM > row.maxRangeM) issue('最小射程不得超过最大射程', id, 'minRangeM')
      const baseline = baseDocs[table]?.groups[group]?.find(before => (before.id ?? before.key) === id)
      if (baseline) {
        const types = (current: DataRow, original: DataRow, path = ''): void => {
          for (const [key, before] of Object.entries(original)) {
            const at = path ? `${path}.${key}` : key, after = current[key]
            if (after !== undefined && typeof after !== typeof before) issue('字段类型与定义不一致', id, at)
            if (before && typeof before === 'object' && !Array.isArray(before) && after && typeof after === 'object') types(after as DataRow, before as DataRow, at)
          }
        }
        types(row, baseline)
      }
    }
  }
  return issues
}
export function planDocuments(documents: Record<DataTable, DataDocument>, edits: NumericEdit[], contract?: StaticFieldTypes): { documents: Record<DataTable, DataDocument>; changes: EditorChange[]; issues: EditorIssue[]; warnings: string[] } {
  const next = structuredClone(documents), issues: EditorIssue[] = [], changes: EditorChange[] = [], warnings: string[] = []
  const targets = new Set<string>()
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object' || !Object.prototype.hasOwnProperty.call(TABLE_FILES, edit.table) || typeof edit.id !== 'string' || typeof edit.path !== 'string' || typeof edit.value !== 'number' || !Number.isFinite(edit.value) || Math.abs(edit.value) > Number.MAX_SAFE_INTEGER) {
      issues.push({ message: '修改请求的表、主键、字段或数值无效' }); continue
    }
    const key = `${edit.table}:${edit.id}:${edit.path}`
    if (targets.has(key)) { issues.push({ ...edit, message: '同一字段重复修改' }); continue }
    targets.add(key)
    const found = rowsOf(edit.table, next[edit.table]).find(row => row.id === edit.id)
    const field = found?.fields.find(f => f.path === edit.path)
    if (!found || !field?.writable || typeof getValue(found.values, edit.path) !== 'number') { issues.push({ ...edit, message: '字段不存在或为只读派生字段' }); continue }
    const before = getValue(found.values, edit.path) as number
    if (before === edit.value) continue
    setValue(found.values, edit.path, edit.value)
    changes.push({ ...edit, before, file: TABLE_FILES[edit.table] })
  }
  // 同物两价只联动确定同值且原值相同的静态锚；其他配方/书价不猜测修改。
  for (const change of [...changes]) {
    if (!['basePrice', 'priceIsk', 'baseSellPriceIsk'].includes(change.path)) continue
    const market = rowsOf('market', next.market).find(row => change.table === 'market' ? row.id === change.id : row.values.refId === change.id)
    const related: { table: DataTable; path: string }[] = change.table === 'market' ? [{ table: 'ships', path: 'priceIsk' }, { table: 'items', path: 'baseSellPriceIsk' }] : [{ table: 'market', path: 'basePrice' }]
    for (const link of related) {
      const relatedId = link.table === 'market' ? market?.id : String(market?.values.refId ?? change.id)
      const found = rowsOf(link.table, next[link.table]).find(row => row.id === relatedId)
      if (!found || (link.table === 'ships' && market?.values.playerBuyable === false)) continue
      const original = rowsOf(link.table, documents[link.table]).find(row => row.id === relatedId)
      const before = original ? getValue(original.values, link.path) : undefined
      if (typeof before !== 'number' || before !== change.before || before === 0) continue
      const key = `${link.table}:${relatedId}:${link.path}`
      if (targets.has(key)) { if (getValue(found.values, link.path) !== change.value) issues.push({ message: '关联价格修改相互冲突', ...link, id: relatedId }); continue }
      setValue(found.values, link.path, change.value)
      targets.add(key)
      changes.push({ table: link.table, id: relatedId!, path: link.path, before, value: change.value, linked: true, file: TABLE_FILES[link.table] })
    }
    if (change.table === 'market' && market?.values.kind === 'blueprint') issues.push({ ...change, message: '蓝图书价尚在代码中，不能只改市场一处；须同时按现有蓝图规则处理' })
    warnings.push(`${change.id}：基准价不是实时成交价；配方/书价与既有标定仍须通过内容检查`)
  }
  for (const table of Object.keys(next) as DataTable[]) issues.push(...validateDocument(next[table], table, contract))
  return { documents: next, changes, issues, warnings: [...new Set(warnings)] }
}
