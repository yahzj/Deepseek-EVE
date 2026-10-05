/** 汇总无人机首次出击错峰隔离预演，不重算战斗。 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DRONE_LAUNCH_PREVIEW_MODES } from './drone-launch-preview-curves'

const dir = resolve('tools/_ui-artifacts/drone-launch-preview')
const reports = DRONE_LAUNCH_PREVIEW_MODES.map((mode) => JSON.parse(readFileSync(resolve(dir, `report-${mode}.json`), 'utf8')) as { mode: string; cells: any[] })
assert(reports.every((report) => report.cells.length === reports[0]!.cells.length))
const key = (cell: any) => `${cell.config}/${cell.target}`
const base = new Map(reports[0]!.cells.map((cell) => [key(cell), cell]))
for (const report of reports.slice(1)) for (const cell of report.cells) {
  const original = base.get(key(cell))!
  assert(original)
  assert.deepEqual(cell.config, original.config)
  assert.deepEqual(cell.target, original.target)
}
const rows = reports.flatMap((report) => report.cells.map((cell) => ({ mode: report.mode, config: cell.config, name: cell.name, target: cell.target, ...cell.summary })))
const json = { scope: '首次出击错峰隔离预演；哨戒机与无人机攻击间隔保持不变；不代表正式落码', rows }
writeFileSync(resolve(dir, 'comparison.json'), JSON.stringify(json, null, 2), 'utf8')
const lines = [
  '# 无人机首次出击错峰预演对照', '',
  '只隔离首次出击：普通无人机按500ms或460ms错峰，攻击间隔保持原值；哨戒无人机不参加错峰。', '',
  '| 模式 | 配置 | 目标 | 胜率 | 战斗秒 | 前5秒伤害 | 前10秒伤害 | 前20秒伤害 | 整场伤害 | 机群损失 | 击落事件 |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
]
for (const row of rows) lines.push(`| ${row.mode} | ${row.name} | ${row.target} | ${(row.winRate * 100).toFixed(0)}% | ${row.seconds.toFixed(1)} | ${row.droneDamage5.toFixed(1)} | ${row.droneDamage10.toFixed(1)} | ${row.droneDamage20.toFixed(1)} | ${row.droneDamageTotal.toFixed(1)} | ${row.droneLost.toFixed(2)} | ${row.enemyDroneDownEvents.toFixed(2)} |`)
lines.push('', '击落事件来自敌方点防实际造成的 droneDown；现有引擎不把敌方点防每次判定单独写成FX。预演工具通过内存替换注入门控；正式 core/data 未修改。')
writeFileSync(resolve(dir, 'comparison.md'), `${lines.join('\n')}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, rows: rows.length, out: dir }))
