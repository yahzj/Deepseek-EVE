/** 只读配对JSON/JSONL，生成分类收益报告；不运行游戏或调整参数。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const directory = path.resolve(process.argv[2] ?? '')
assert(process.argv[2], '用法：node tools/signal-auto-yield-report.cjs <对照输出目录>')
const report = JSON.parse(fs.readFileSync(path.join(directory, 'report.json'), 'utf8'))
assert(report.ok && report.samplesPerCell > 0)
const names = { guns: '四炮击作业队', survey: '四测绘作业队', mixed: '两炮击＋测绘＋后勤', unarmed: '无武装作业队' }
const labels = { commonM3: '普通残骸m³', oreUnits: '母矿单位', ordinaryM3: '普通资源总体积m³', rareM3: '稀有残骸m³', boxes: '货柜件', essence: '谜质枚', cores: '核心枚' }
const keys = Object.keys(labels)
const num = value => value === null ? '无' : Number(value.toFixed(3)).toLocaleString('en-US')
const change = (old, current) => old === 0 ? current === 0 ? '均为0' : '旧为0，不算百分比' : `${(100 * (current / old - 1)).toFixed(1)}%`
const pair = (a, key) => `${num(a.versions.old.metrics[key].mean)} → ${num(a.versions.new.metrics[key].mean)}`
const lines = ['# 信号空间自动探索新旧收益对照', '',
  `每格${report.samplesPerCell}个散布种子，${report.cells.length}个交叉条件，共${report.pairedCount.toLocaleString('en-US')}组配对、${report.settlementCount.toLocaleString('en-US')}次正式结算。`,
  '', '**结论：当前新算法不只是收窄波动，奖励结构和稀有产出均已改变，尚不能作为“收益均值保持不变”的替代。**', '',
  '## 条件与统计', '',
  '- 固定初始舰体满修、全技能5级、MK2合法配装、80%收益系数；低科技只开启自动探索3级，高科技全满。三条路径之间不继承损伤。',
  '- 五族×五原型等权交叉是条件对照，不是自然遭遇权重；同一256种子重复用于所有格，不能声称51,200个独立随机种子。',
  '- P05/P50/P95按线性插值；核心每格只有有限掉落事件，百分比差异不是总体概率结论。货柜未开箱，不折成现金净收益。',
  '- 旧算法原样保留地图原型接线、满仓停止及守卫失败继续循环等行为。守卫诊断只在内存将一条continue改为break，不改生产源码。',
  '- 新末层有部分完成，旧实际访问层与模拟报告层可能不一致；深度不是严格相同量纲的通关数。', '',
  '## 等权分类均值', '',
  '以下每行每版包含6,400次结算，但只有256个配对种子。箭头为旧原样 → 新；普通/稀有残骸单位为m³，不是件数。', '',
  '| 配置 | 科技 | 普通残骸 | 母矿 | 普通总体积变化 | 稀有残骸 | 货柜 | 谜质 | 核心 |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|']
for (const a of report.aggregates) lines.push(`| ${names[a.profile]} | ${a.fullTech ? '满科技' : '仅自动探索3级'} | ${pair(a, 'commonM3')} | ${pair(a, 'oreUnits')} | ${change(a.versions.old.metrics.ordinaryM3.mean, a.versions.new.metrics.ordinaryM3.mean)} | ${pair(a, 'rareM3')} | ${pair(a, 'boxes')} | ${pair(a, 'essence')} | ${pair(a, 'cores')} |`)
lines.push('', '## 同条件波动与守卫诊断', '',
  '先在每个敌族/原型格内求变异系数，再等权平均；不把不同敌族或原型的均值差异冒充随机波动。数值越低波动越小。', '',
  '| 配置 | 科技 | 普通残骸CV旧→新 | 母矿CV旧→新 | 普通总体积CV旧→新 | 旧绕过失败守卫后取货样本 | 普通总体积：旧／只停止守卫／新 |',
  '|---|---|---:|---:|---:|---:|---:|')
for (const a of report.aggregates) {
  const cells = report.cells.filter(c => c.profile === a.profile && c.fullTech === a.fullTech)
  const cv = key => ['old', 'new'].map(mode => num(cells.reduce((n, cell) => n + (cell.summary[mode].metrics[key].cv ?? 0), 0) / cells.length)).join(' → ')
  lines.push(`| ${names[a.profile]} | ${a.fullTech ? '满科技' : '仅自动探索3级'} | ${cv('commonM3')} | ${cv('oreUnits')} | ${cv('ordinaryM3')} | ${a.versions.old.bypassCollected}/${a.samples} | ${['old', 'guardStop', 'new'].map(mode => num(a.versions[mode].metrics.ordinaryM3.mean)).join('／')} |`)
}
lines.push('', '## 代表格：满科技混编、海盗、均衡信号', '',
  '这格不混合敌族和原型，可以直接看单一条件的收益及随机区间。', '',
  '| 指标 | 旧均值 | 新均值 | 变化 | 旧P05／P50／P95 | 新P05／P50／P95 |',
  '|---|---:|---:|---|---|---|')
const example = report.cells.find(c => c.profile === 'mixed' && c.fullTech && c.family === 'A' && c.archetype === 'balanced')
assert(example)
for (const key of keys) {
  const old = example.summary.old.metrics[key], current = example.summary.new.metrics[key]
  lines.push(`| ${labels[key]} | ${num(old.mean)} | ${num(current.mean)} | ${change(old.mean, current.mean)} | ${[old.p05, old.p50, old.p95].map(num).join('／')} | ${[current.p05, current.p50, current.p95].map(num).join('／')} |`)
}
lines.push('', '旧队伍这格全部在第1层满仓，守卫诊断与旧原样收益完全相同；新队伍可计算至第5层，但末层仅约0.9%完成。新算法满仓后仍累计深层特殊收益，旧算法满仓直接结束。这是深层奖励增长的重要结构差异，不能归因于修复守卫。', '',
  '## 证据与验证', '',
  `- ${report.uninstrumentedChecks}个未插桩正式旧入口控制样本与插桩旧结果的奖励、核心、损伤逐项一致。`,
  '- 每个配对样本三版伤损一致；奖励与仓库、核心库存增量一致；未遇到失败守卫时原样旧版与守卫诊断逐项一致。',
  '- 每个结果的实际访问层、失败守卫、逐层产出和地图原型保留在paired-samples.jsonl；每格完整分位数与货柜品种统计保留在report.json。',
  '- 运行前后源码与夹具SHA-256完全一致，不读写个人档，不查Git历史，不调正式参数。', '',
  '## 全部条件分位数', '')
for (const cell of report.cells) {
  lines.push(`### ${names[cell.profile]} · ${cell.fullTech ? '满科技' : '低科技'} · ${cell.family} · ${cell.archetype}`, '',
    '| 指标 | 旧均值 | 新均值 | 旧P05／P50／P95 | 新P05／P50／P95 |', '|---|---:|---:|---|---|')
  for (const key of keys) {
    const old = cell.summary.old.metrics[key], current = cell.summary.new.metrics[key]
    lines.push(`| ${labels[key]} | ${num(old.mean)} | ${num(current.mean)} | ${[old.p05, old.p50, old.p95].map(num).join('／')} | ${[current.p05, current.p50, current.p95].map(num).join('／')} |`)
  }
  lines.push('')
}
const target = path.join(directory, 'comparison.md')
fs.writeFileSync(target, `${lines.join('\n')}\n`, { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ target, cells: report.cells.length, pairs: report.pairedCount }))
