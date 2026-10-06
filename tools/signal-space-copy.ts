/** 信号空间改名词表与ID生成。只读已登记文本，按批准范围修改唯一表，不碰历史公告。
 * 用法：npx tsx tools/signal-space-copy.ts；重复运行不会覆盖原历史文本。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const path = 'packages/data/src/l10n/table.ts'
const source = readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
const entries: Array<{ id: string; zh: string; en: string }> = []
function visit(node: ts.Node): void {
  if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isObjectLiteralExpression(node.initializer)) {
    const values = new Map(node.initializer.properties.filter(ts.isPropertyAssignment).map(p => [p.name.getText(ast), ts.isStringLiteral(p.initializer) ? p.initializer.text : '']))
    if (values.has('zh') && values.has('en')) entries.push({ id: node.name.text, zh: values.get('zh')!, en: values.get('en')! })
  }
  ts.forEachChild(node, visit)
}
visit(ast)
const replacements: Record<string, { zh: string; en: string }> = {
  'ui.MapPage.007': { zh: '扫描信号空间', en: 'Scan for Signal Spaces' },
  'ui.MatterTechTab.001': { zh: '信号空间探索', en: 'Signal Space Exploration' },
  'ui.Expedition.005': { zh: '信号空间', en: 'Signal Space' },
  'ui.WormholeScan.010': { zh: '开始扫描信号空间', en: 'Start Signal Space Scan' },
  'ui.WormholeScan.015': { zh: '返回信号空间', en: 'Return to Signal Space' },
  'ui.WormholeScan.016': { zh: '已发现的信号空间 ·', en: 'Discovered Signal Spaces ·' },
  'ui.Wormhole.015': { zh: '✕ 关闭（暂停探索）', en: '✕ Close (Pause Exploration)' },
  'ui.Wormhole.065': { zh: '已进入信号空间。', en: 'Entered Signal Space.' },
  'ui.comms.040': { zh: '信号空间扫描权限已开通', en: 'Signal Space Scanning Access Granted' },
  'ui.commsWhunlock.001': { zh: '飞行员，你累计取得的协会声望已达到40，信号空间扫描权限已开通。入口在星图的「扫描信号空间」。', en: 'Pilot, your total earned Association standing has reached 40. Signal Space scanning access is now available under Scan for Signal Spaces on the star map.' },
  'ui.commsWhunlock.002': { zh: '阵列扫描完成会记录一处信号空间，随后继续扫描。基础能保存五处，星图记录学可以增加容量；列表满了，扫描会停下。', en: 'Each completed scan records one Signal Space, then scanning continues. Base capacity is five; Star Chart Records can increase it. Scanning stops when the list is full.' },
  'ui.commsWhunlock.003': { zh: '先看坐标上的敌情和资源，再决定是否进入。编队要带采集器与打捞器，矿脉、遗迹和残骸都要用到这些工具。', en: 'Check the enemy and resource information at the coordinates before deciding to enter. Bring mining lasers and salvagers in the squad for ore veins, ruins and wreckage.' },
  'ui.commsWhunlock.004': { zh: '扫描期间遇袭不会清掉已有进度，但空间内交战不能随意撤退。准备好武器、防护和补给后再出发。', en: 'An ambush during scanning does not erase scan progress, but combat inside a Signal Space does not allow a free retreat. Prepare weapons, defenses and supplies before departure.' },
}
function outsideParams(text: string, change: (part: string) => string): string {
  return text.split(/(\{[^}]*\})/).map(part => part.startsWith('{') ? part : change(part)).join('')
}
function rename(zh: string, en: string) {
  return {
    zh: zh.replaceAll('虫洞谜质', '信号谜质').replaceAll('虫洞', '信号空间').replaceAll('洞内', '空间内').replaceAll('洞外', '空间外').replaceAll('洞里', '空间内').replaceAll('进洞', '进入信号空间').replaceAll('入洞', '进入信号空间').replaceAll('出洞', '离开信号空间'),
    en: outsideParams(en, part => part.replace(/Wormhole Enigma/g, 'Signal Enigma').replace(/wormholes/gi, 'Signal Spaces').replace(/wormhole/gi, 'Signal Space')),
  }
}
const selected = entries.filter(e => !e.id.startsWith('ano.') && !e.id.startsWith('ui.whExpedition.') && !e.id.startsWith('ui.explorationName.') && !e.id.startsWith('core.explorationStatus.') && !e.id.includes('.signalSpace.') && (e.id in replacements || /虫洞|洞内|洞外|洞里|进洞|入洞|出洞|wormhole/i.test(e.zh + e.en)))
const counters = new Map<string, number>()
const existingMappings = new Map<string, string>()
const mapPath = 'packages/core/src/explorationText.ts'
try {
  const oldMap = ts.createSourceFile(mapPath, readFileSync(mapPath, 'utf8'), ts.ScriptTarget.Latest, true)
  function collect(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isStringLiteral(node.name) && ts.isStringLiteral(node.initializer)) existingMappings.set(node.name.text, node.initializer.text)
    ts.forEachChild(node, collect)
  }
  collect(oldMap)
  for (const id of existingMappings.values()) counters.set(id.split('.')[0]!, Math.max(counters.get(id.split('.')[0]!) ?? 0, Number(id.split('.').at(-1))))
} catch { /* 首次生成没有映射文件。 */ }
const mappings: Array<[string, string]> = []
const lines: string[] = []
for (const entry of selected) {
  const domain = entry.id.split('.')[0]!
  let id = existingMappings.get(entry.id)
  if (!id) {
    const n = (counters.get(domain) ?? 0) + 1
    counters.set(domain, n)
    id = `${domain}.signalSpace.${String(n).padStart(3, '0')}`
  }
  mappings.push([entry.id, id])
  const value = replacements[entry.id] ?? rename(entry.zh, entry.en)
  lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(value)},`)
}
const marker = source.lastIndexOf('\n}')
if (marker < 0) throw new Error('唯一表结束位置缺失')
const generatedStart = source.indexOf('\n  // ⟪文案调整 2026-10-06⟫ 旧玩法信号空间；原ID保留历史与未来虫洞。')
writeFileSync(path, source.slice(0, generatedStart >= 0 ? generatedStart : marker) + '\n  // ⟪文案调整 2026-10-06⟫ 旧玩法信号空间；原ID保留历史与未来虫洞。\n' + lines.join('\n') + source.slice(marker), 'utf8')
const map = `/** 信号空间的已审文本ID映射；由tools/signal-space-copy.ts生成。 */\nexport const SIGNAL_SPACE_TEXT_IDS: Readonly<Record<string, string>> = {\n${mappings.map(([from, to]) => `  ${JSON.stringify(from)}: ${JSON.stringify(to)},`).join('\n')}\n}\n\nexport function signalSpaceTextId(id: string, rules?: number): string {\n  return rules === 2 ? id : SIGNAL_SPACE_TEXT_IDS[id] ?? id\n}\n`
writeFileSync('packages/core/src/explorationText.ts', map, 'utf8')
console.log(JSON.stringify({ originalRetained: selected.length, newEntries: lines.length, mapEntries: mappings.length }))
