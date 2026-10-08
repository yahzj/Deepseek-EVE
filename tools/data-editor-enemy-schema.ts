import fields from '../packages/data/src/static/enemyFields.json'
import ts from 'typescript'
import type { DataDocument, EnemyDataTable, EditorIssue, EditorRow, NumericField } from './data-editor-contract'

export const ENEMY_TABLES: readonly EnemyDataTable[] = ['foeShips', 'foeDrones', 'foeMounts', 'bounties', 'invasionFleets', 'wormholeFleets']
export const isEnemyTable = (table: string): table is EnemyDataTable => ENEMY_TABLES.includes(table as EnemyDataTable)
export interface EnemySourceField { key: string; sourcePath: string; expression: string; source: string }
export interface EnemySourceRow { id: string; name: string; category: string; source: string; fields: EnemySourceField[]; entries?: Array<{ index: number; name: string; id: string; type: string; note: string }>; references?: EditorRow['references']; notes?: string[] }
export const ENEMY_FIELDS = fields as Record<EnemyDataTable, EnemySourceRow[]>
export const ENEMY_FILES: Record<EnemyDataTable, string> = {
  foeShips: 'packages/data/src/static/foeShips.json', foeDrones: 'packages/data/src/static/foeDrones.json',
  foeMounts: 'packages/core/src/static/foeMounts.json', bounties: 'packages/data/src/static/bounties.json',
  invasionFleets: 'packages/data/src/static/invasionFleets.json', wormholeFleets: 'packages/data/src/static/wormholeFleets.json',
}
const LABELS: Record<string, string> = {
  hp: '基础总血', shotDmg: '基础武器组单发', gunCount: '炮数', reloadMs: '装填间隔', hitRate: '命中参数',
  hullClassTier: '舰种档', speedRatio: '舰种速度倍率', rangeMinM: '射程下限', rangeMaxM: '射程上限',
  desireRangeM: '期望交距', falloff: '远端衰减', blindDmgMul: '近盲伤害倍率', evasion: '闪避',
  s: '护盾比例', a: '装甲比例', h: '结构比例', shieldHp: '机体护盾', armorHp: '机体装甲', hullHp: '机体结构',
  kinetic: '动能', explosive: '高爆', plasma: '能量', dmg: '基础单发', maxRangeM: '最大射程',
  hpMul: '血量来源', dmgMul: '火力来源', speedMul: '速度倍率', rangeMul: '射程倍率', count: '数量', wave: '波次（0起）',
  threat: '展示威胁', judgedThreat: '判据威胁', wreckThreat: '残骸经济威胁', rewardIsk: '赏金',
  standingReq: '声望门槛', standingGain: '声望奖励', combatSeconds: '参考战斗秒数',
  firepowerAnchor: '总单发锚点', droneFireShare: '机群火力占比', repairPct: '后勤修理占比',
  shots: '连发数', gapMs: '连发间隔', everyMs: '周期', cooldownMs: '冷却', distanceM: '闪现位移上限',
  stepMs: '装填缩短步长', floorMs: '装填下限', rampMs: '聚焦叠满时间', rangeBonusPct: '射程加成', antiDroneBonusPct: '对无人机伤害加成',
  resistPct: '护盾减伤', lingerMs: '闪现后延续', hullCostPct: '结构上限代价', mul: '倍率', pct: '修正率', add: '加数',
  slowMul: '速度剩余倍率', rangeDownM: '射程降低', delaySec: '呼叫延迟', threatMul: '预算补偿倍率',
  armor: '装甲修复量', hull: '结构修复量', sec: '延迟入场秒数', afterKills: '击毁数量门槛', hpBelow: '残血触发比例',
  stock: '备用机存量', perLaunch: '每次补入数', intervalMs: '补入周期', hpShare: '波血量占比', units: '波单位数',
  delayMs: '生效延迟', damage: '伤害', blastRadiusM: '爆炸半径', initialDelayMs: '初始延迟', cap: '编成上限', durationMs: '持续时间',
  scale: '编队属性倍率', motherHpMul: '巢母血量倍率', hivebackFirepowerAnchor: '背巢单发锚点基数', motherFirepowerAnchor: '巢母单发锚点基数',
  gunDmgMul: '炮台伤害倍率', droneDmgMul: '机群伤害倍率', droneRangeBonusPct: '机群射程加成', perAlly: '每艘友军加成', maxBonusPct: '加成上限', respawnMs: '备用机复位周期',
}
const GROUPS: Record<string, string> = { charge: '冲锋', defense: '机体防御', split: '三层血型', shieldResist: '护盾抗性', armorResist: '装甲抗性', hullResist: '结构抗性', dmgMix: '伤害构成', burst: '连发', acidBurst: '酸液爆炸', droneReserve: '备用机库', waves: '波次', broodControl: '机群控制', hatchery: '孵化巢', fleetSpeedRamp: '编队机动', droneRangeOnHit: '受击机群增程', gunRangeOnHit: '受击炮台增程', web: '捕获网', supportCall: '支援呼叫', evasionBonus: '闪避加成', repairPulse: '修理脉冲', reviveEscort: '复活僚舰', summonEscort: '召唤僚舰', rangeDebuff: '射程压制', blink: '闪现', overlayDrive: '叠光', flashOverload: '闪烁过载', standbyShield: '待机护盾', focusArray: '聚焦阵列' }
export function enemyFieldOf(field: EnemySourceField): NumericField {
  const path = field.sourcePath, last = path.split('.').at(-1)!
  const operand = /_input(\d+)$/.exec(field.key)
  const ratio = /split\.|Resist\.|Pct$|Pct\.|\.pct$|\.add$|^evasion$|\.evasion$|FireShare$|Chance$|hpShare$|hpBelow$/.test(path)
  const fraction = ratio || last === 'falloff' || last === 'hitRate'
  const percent = fraction && !operand
  const integer = !operand && /^(hullClassTier|lairLevel|gunCount|rareWreckDrop)$|Ms$|\.wave$|\.count$|\.shots$|\.units$|afterKills$|\.stock$/.test(path)
  const zeroAllowed = /shotDmg|dmg$|speedRatio|wave$|rewardIsk|standing|split\.|Resist\.|evasion|Chance|Pct|FireShare|hpShare|\.pct$|\.add$|rangeMinM|hpBelow|Hp$|delayMs|rangeDownM|blindDmgMul|afterKills|sec$/.test(path)
  const max = !operand && fraction ? last === 'hitRate' ? 2 : /Resist|evasion/.test(path) ? 0.9 : /BonusPct$/.test(path) ? undefined : 1 : last === 'hullClassTier' ? 5 : /wave$/.test(path) ? 31 : /count$|units$|stock$/.test(path) ? 100 : undefined
  const unit = percent ? '%' : /Ms$/.test(last) ? 'ms' : /Seconds$|Sec$|^sec$/.test(last) ? 's' : /RangeM$|MinM$|MaxM$|distanceM|rangeDownM/.test(last) ? 'm' : /Mul$|Ratio$|^mul$/.test(last) ? 'x' : /Isk$/.test(last) ? '信用点' : ''
  const section = /^ships\.(\d+)\./.exec(path) ?? /^drones\.(\d+)\./.exec(path)
  const group = section ? `${path.startsWith('ships') ? '编队' : '机群'}条目 ${Number(section[1]) + 1}` : path.includes('.') ? GROUPS[path.split('.')[0]!] ?? path.split('.')[0]! : '基础参数'
  const label = `${path.includes('Resist') ? `${GROUPS[path.split('.')[0]!] ?? path.split('.')[0]} · ` : ''}${LABELS[last] ?? last}${operand ? ` · 公式输入${Number(operand[1]) + 1}` : ''}`
  return { path: field.key, label, group, unit, percent, integer, min: /Resist/.test(path) ? -0.9 : zeroAllowed ? 0 : 0.000001, max,
    writable: !['hullClassTier', 'lairLevel'].includes(last), readonlyReason: `来源：${field.source}\n${path} = ${field.expression}${operand ? '\n原公式保留；编辑的是该数字输入，不是最终倍率' : ''}` }
}
function sourceValue(row: Record<string, unknown>, source: EnemySourceField[]): number | undefined {
  if (source.length === 1 && !/_input\d+$/.test(source[0]!.key)) return Number(row[source[0]!.key])
  const ast = ts.createSourceFile('expression.ts', `const value = ${source[0]!.expression}`, ts.ScriptTarget.Latest, true)
  const expr = (ast.statements[0] as ts.VariableStatement).declarationList.declarations[0]!.initializer!
  let index = 0
  const read = (node: ts.Expression): number | undefined => {
    if (ts.isNumericLiteral(node) || ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return Number(row[source[index++]?.key ?? ''])
    if (ts.isParenthesizedExpression(node)) return read(node.expression)
    if (!ts.isBinaryExpression(node)) return undefined
    const a = read(node.left), b = read(node.right)
    if (a === undefined || b === undefined) return undefined
    switch (node.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken: return a + b
      case ts.SyntaxKind.MinusToken: return a - b
      case ts.SyntaxKind.AsteriskToken: return a * b
      case ts.SyntaxKind.SlashToken: return a / b
      case ts.SyntaxKind.AsteriskAsteriskToken: return a ** b
      default: return undefined
    }
  }
  return read(expr)
}
export function enemyRowsOf(table: EnemyDataTable, document: DataDocument): EditorRow[] {
  return Object.entries(document.groups).flatMap(([group, rows]) => rows.map(row => {
    const meta = ENEMY_FIELDS[table].find(item => item.id === row.id)
    return { table, group, id: String(row.id), name: meta?.name ?? String(row.id), category: meta?.category ?? '', values: row,
      tier: typeof row.hullClassTier === 'number' ? row.hullClassTier : undefined,
      fields: (meta?.fields ?? []).map(field => {
        const rule = enemyFieldOf(field)
        const match = /^(ships|drones)\.(\d+)\./.exec(field.sourcePath)
        const entry = match ? meta?.entries?.find(entry => entry.type === match[1] && entry.index === Number(match[2])) : undefined
        return { ...rule, ...(entry ? { group: `${entry.name} · 条目 ${entry.index + 1}`, readonlyReason: `${rule.readonlyReason}\n${entry.note}` } : {}) }
      }),
      references: meta?.references,
      notes: [...(meta?.notes ?? []), '源参数与实际战斗值不同；公式、预算、火力锚点及挂载优先级仍由引擎计算', ...(table === 'foeDrones' && row.id === 'g-bee-shared' ? ['蜂群三弹种共用此参数，修改同时影响三个机型'] : [])],
    }
  }))
}
export function enemyDocumentIssues(value: unknown, table: EnemyDataTable): EditorIssue[] {
  const issues: EditorIssue[] = [], issue = (message: string, id?: string, path?: string) => issues.push({ table, id, path, message })
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ table, message: '敌人参数文档必须为对象' }]
  const doc = value as DataDocument
  if (doc.format !== 'whale-static-data' || doc.version !== 1 || doc.table !== table || !doc.groups || Object.keys(doc.groups).join() !== 'parameters' || !Array.isArray(doc.groups.parameters) || Object.keys(doc).some(key => !['format', 'version', 'table', 'groups'].includes(key))) return [{ table, message: '敌人源参数格式/分组不匹配' }]
  const seen = new Set<string>()
  for (const row of doc.groups.parameters) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { issue('参数行须为对象'); continue }
    const id = String(row.id), meta = ENEMY_FIELDS[table].find(item => item.id === id)
    if (!meta || seen.has(id)) { issue('未知或重复参数主键', id); continue }
    seen.add(id)
    const allowed = new Set(['id', ...meta.fields.map(field => field.key)])
    if (Object.keys(row).some(key => !allowed.has(key))) issue('未知参数字段', id)
    for (const field of meta.fields) {
      const v = row[field.key], rules = enemyFieldOf(field)
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > Number.MAX_SAFE_INTEGER || rules.integer && !Number.isSafeInteger(v)) issue('须为有限数值，整数字段不可有小数', id, field.key)
      else if (rules.min !== undefined && v < rules.min || rules.max !== undefined && v > rules.max) issue(`值域${rules.min ?? '-∞'}～${rules.max ?? '∞'}`, id, field.key)
    }
    const sources = new Map<string, EnemySourceField[]>()
    for (const field of meta.fields) sources.set(field.sourcePath, [...(sources.get(field.sourcePath) ?? []), field])
    const values = new Map([...sources].map(([path, source]) => [path, sourceValue(row, source)]))
    for (const [path, source] of sources) {
      const value = values.get(path)
      if (value === undefined) continue
      const rule = enemyFieldOf({ ...source[0]!, key: path.replace(/\./g, '_') })
      if (!Number.isFinite(value) || rule.integer && !Number.isSafeInteger(value) || rule.min !== undefined && value < rule.min || rule.max !== undefined && value > rule.max) issue('源公式结果超出字段值域', id, source[0]!.key)
    }
    const waveCounts = [...values].filter(([path]) => /^ships\.\d+\.wave$/.test(path))
    const waves = [...values].filter(([path]) => /^waves\.\d+\.units$/.test(path))
    for (const [path, wave] of waveCounts) if (waves.length && wave !== undefined && wave >= waves.length) issue('编队波次超出已登记波数', id, sources.get(path)![0]!.key)
    if (waves.length) {
      const shares = [...values].filter(([path]) => /^waves\.\d+\.hpShare$/.test(path)).map(([, value]) => value)
      if (shares.every(value => value !== undefined) && Math.abs(shares.reduce<number>((sum, value) => sum + value!, 0) - 1) > 1e-8) issue('波血量占比之和须为1', id)
      for (const [wavePath, count] of waves) {
        const wave = Number(wavePath.split('.')[1])
        const slots = [...new Set([...values.keys()].map(path => /^ships\.(\d+)\./.exec(path)?.[1]).filter(Boolean))].filter(index => (values.get(`ships.${index}.wave`) ?? 0) === wave)
        if (slots.length && count !== slots.reduce((sum, index) => sum + (values.get(`ships.${index}.count`) ?? 1), 0)) issue('波单位数与编队条目数量不一致', id, sources.get(wavePath)![0]!.key)
      }
    }
    for (const prefix of ['', ...new Set(meta.fields.map(field => field.sourcePath.replace(/[^.]+$/, '')))]) {
      const rangeMin = meta.fields.find(field => field.sourcePath === prefix + 'rangeMinM' && !field.key.includes('_input'))
      const rangeMax = meta.fields.find(field => field.sourcePath === prefix + 'rangeMaxM' && !field.key.includes('_input'))
      if (rangeMin && rangeMax && Number(values.get(prefix + 'rangeMinM')) >= Number(values.get(prefix + 'rangeMaxM'))) issue('射程下限须小于上限', id, rangeMax.key)
      if (prefix.endsWith('split.')) {
        const parts = ['s', 'a', 'h'].map(key => meta.fields.find(field => field.sourcePath === prefix + key))
        if (parts.every(Boolean) && Math.abs(['s', 'a', 'h'].reduce((n, key) => n + Number(values.get(prefix + key)), 0) - 1) > 1e-8) issue('三层血比例之和须为1', id, parts[0]!.key)
      }
    }
  }
  for (const meta of ENEMY_FIELDS[table]) if (!seen.has(meta.id)) issue('缺少源参数行', meta.id)
  return issues
}
