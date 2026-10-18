import type { L10nEntry } from '@whale/data'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

let translatedSnapshot: Record<string, L10nEntry> | undefined
function approvedTranslation(id: string): L10nEntry {
  if (!translatedSnapshot) {
    const scope = { exports: {} as { L10N: Record<string, L10nEntry> } }
    const source = execFileSync('git', ['show', 'af94a6af:packages/data/src/l10n/table.ts'], {
      encoding: 'utf8', windowsHide: true, maxBuffer: 8_000_000,
    })
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
    translatedSnapshot = scope.exports.L10N
  }
  if (!translatedSnapshot[id]) throw new Error(`已批准翻译快照缺少${id}`)
  return translatedSnapshot[id]!
}

/** 船长确认MK1改名及扫描叠加规则后，历史词条守恒只放行这些精确变化。 */
export function approvedMk1CopyDelta(id: string, entry: L10nEntry): L10nEntry {
  // 船长已批准完成旧待译项；固定已提交快照逐字保护，不拿当前表反向充当期望值。
  if (entry.enDeferred || ['mod.copy.070', 'ui.shipInfo.074', 'ui.shipInfo.167'].includes(id)) return approvedTranslation(id)
  const names = new Set(['core.consumable.001', 'core.consumable.002', 'core.consumable.003', 'core.consumable.013', 'core.consumable.015',
    'core.consumable.016', 'core.consumable.017', 'ui.boost.013', 'ui.ActivityBar.067'])
  if (id === 'core.consumable.002') return { ...entry, zh: '突触加速剂正在生效中（还剩 {p1} 分钟）：同一时间内只能生效一剂。', en: 'Synaptic Accelerant MK1 is active ({p1} minutes left): only one dose can be active at a time.' }
  if (id === 'core.consumable.003') return { ...entry, zh: '✦ 突触加速剂生效：未来 {p1} 小时内技能训练时长减半。', en: '✦ Synaptic Accelerant MK1 active: skill-training time is halved for the next {p1} hours.' }
  if (names.has(id)) return { ...entry,
    zh: entry.zh.replace('突触加速剂', '突触加速剂 MK1'),
    en: entry.en.replace('Synaptic Accelerant', 'Synaptic Accelerant MK1').replace('A Synaptic Accelerant MK1', 'Synaptic Accelerant MK1') }
  if (id === 'ui.shipInfo.125') return { ...entry,
    zh: '空间内扫描范围 +{p1} 圈；同类舰船取最高，侦察舰与电子舰可相加',
    en: 'Scan range inside the space +{p1} rings; only the highest bonus in each ship class applies, and scout and EW bonuses add together' }
  return entry
}
