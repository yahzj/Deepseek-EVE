/** 小船隔离预演结果汇总，读取真实worker报告，不重算命中或战斗。
 * 用法：npx tsx tools/small-ship-preview-report.ts；输出同目录comparison.json及comparison.md。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir=resolve('tools/_ui-artifacts/small-ship-preview')
interface Cell {
  curve:string;candidate:string;name:string;tier:number;level:number;withPlates:boolean;
  target:{id:string;depth:number;family:string};
  budget:{hull:number;modules:number;drones:number;plugBlackboxReference:number};
  admission:{totalMass:number;turnBudget:number};
  summary:{winRate:number;candidateDeathRate:number;candidateSurvivalSeconds:number;candidateAliveShare:number;candidateHpFraction:number;candidateDamage:number;fleetLosses:number;seconds:number;rangeSuppressionSeconds:number;supportEligibleSeconds:number;ammoUsed:number;dronesLost:number;averageDistance:number};
}
const reports=JSON.parse(readFileSync(resolve(dir,'summary.json'),'utf8')) as {unchanged:boolean;reports:{curve:string;seeds:number[];cells:Cell[]}[]}
assert(reports.unchanged)
const key=(c:Cell)=>`${c.candidate}/${c.level}/${c.withPlates}/${c.target.id}/${c.target.depth}`
const lookup=new Map(reports.reports[0]!.cells.map(c=>[key(c),c]))
for(const report of reports.reports.slice(1))for(const cell of report.cells) {
  const base=lookup.get(key(cell))!
  assert(base)
  assert.deepEqual(cell.budget,base.budget)
  assert.deepEqual(cell.admission,base.admission)
  assert.deepEqual((cell as any).loadouts,(base as any).loadouts)
}
const average=(cells:Cell[],field:keyof Cell['summary'])=>cells.reduce((n,c)=>n+c.summary[field],0)/Math.max(1,cells.length)
const aggregate=reports.reports.map(report=>{
  const selected=report.cells.filter(c=>c.tier<=2&&c.withPlates)
  const byTarget=[...new Set(selected.map(c=>`${c.target.id}/${c.target.depth}`))].map(target=>{
    const rows=selected.filter(c=>`${c.target.id}/${c.target.depth}`===target)
    return {target,winRate:average(rows,'winRate'),deathRate:average(rows,'candidateDeathRate'),aliveShare:average(rows,'candidateAliveShare'),seconds:average(rows,'seconds'),ammo:average(rows,'ammoUsed')}
  })
  return {curve:report.curve,cells:report.cells.length,battles:report.cells.length*report.seeds.length,selectedCount:selected.length,
    winRate:average(selected,'winRate'),deathRate:average(selected,'candidateDeathRate'),seconds:average(selected,'seconds'),ammo:average(selected,'ammoUsed'),byTarget}
})
const changed=reports.reports.slice(1).flatMap(report=>report.cells.filter(c=>c.tier<=2&&c.withPlates).map(c=>{
  const old=lookup.get(key(c))!
  return {key:key(c),curve:c.curve,deltaWin:c.summary.winRate-old.summary.winRate,deltaDeath:c.summary.candidateDeathRate-old.summary.candidateDeathRate,
    secondsRatio:c.summary.seconds/old.summary.seconds,current:c.summary,old:old.summary}
})).filter(c=>Math.abs(c.deltaWin)>=0.2||Math.abs(c.deltaDeath)>=0.2).sort((a,b)=>a.deltaWin-b.deltaWin)
const selectedIds=['sh-wh-a-frigate','sh-wh-c-frigate','sh-wh-d-destroyer','sh-wh-e-frigate','sh-wh-g-destroyer']
const examples=reports.reports.flatMap(report=>report.cells.filter(c=>c.withPlates&&c.level===3&&selectedIds.includes(c.candidate)&&
  (c.target.depth===8||['ink-raid','ink-main','corona-split'].includes(c.target.id))))
const focusPath=resolve(dir,'summary-focus.json')
const focus=existsSync(focusPath)?JSON.parse(readFileSync(focusPath,'utf8')) as {unchanged:boolean;reports:{curve:string;seeds:number[];cells:Cell[]}[]}:undefined
if(focus)assert(focus.unchanged)
const focusRows=focus?.reports.flatMap(r=>r.cells.map(c=>({curve:r.curve,candidate:c.candidate,name:c.name,level:c.level,target:c.target,...c.summary})))??[]
const json={aggregate,changed,examples,focusRows,scope:'四船真实引擎合成预演，不代表同总价、不代表整趟虫洞、五种子单格仅20百分点粒度；重点复核单格20种子仍不冒称统计显著'}
writeFileSync(resolve(dir,'comparison.json'),JSON.stringify(json,null,2),'utf8')
const lines=['# 命中曲线与插件小船预演对照','', '工具数据来自独立bundle，正式core/data未改。单格五种子，胜率20百分点粒度，不冒称统计显著。', '',
  '| 曲线 | 插件T1/T2混编平均胜率 | 末位船死亡率 | 平均战斗秒 | 平均耗弹 |','|---|---:|---:|---:|---:|']
for(const a of aggregate)lines.push(`| ${a.curve} | ${(a.winRate*100).toFixed(2)}% | ${(a.deathRate*100).toFixed(2)}% | ${a.seconds.toFixed(2)} | ${a.ammo.toFixed(1)} |`)
lines.push('','## 场景分组','', '| 曲线 | 场景/层深 | 平均胜率 | 末位船死亡率 | 战斗秒 | 耗弹 |','|---|---|---:|---:|---:|---:|')
for(const a of aggregate)for(const t of a.byTarget)lines.push(`| ${a.curve} | ${t.target} | ${(t.winRate*100).toFixed(1)}% | ${(t.deathRate*100).toFixed(1)}% | ${t.seconds.toFixed(1)} | ${t.ammo.toFixed(1)} |`)
lines.push('','## 代表性小船','', '| 曲线 | 舰型 | 对局 | 胜率 | 本舰死亡率 | 本舰存活秒 | 战斗秒 | 剩余血 |','|---|---|---|---:|---:|---:|---:|---:|')
for(const c of examples)lines.push(`| ${c.curve} | ${c.name} | ${c.target.id}/${c.target.depth} | ${(c.summary.winRate*100).toFixed(0)}% | ${(c.summary.candidateDeathRate*100).toFixed(0)}% | ${c.summary.candidateSurvivalSeconds.toFixed(1)} | ${c.summary.seconds.toFixed(1)} | ${(c.summary.candidateHpFraction*100).toFixed(1)}% |`)
if(focusRows.length) {
  lines.push('','## 二十种子重点复核','', '| 曲线 | 舰型 | 技能 | 场景 | 胜率 | 本舰死亡率 | 战斗秒 | 耗弹 |','|---|---|---:|---|---:|---:|---:|---:|')
  for(const c of focusRows)lines.push(`| ${c.curve} | ${c.name} | ${c.level} | ${c.target.id}/${c.target.depth} | ${(c.winRate*100).toFixed(0)}% | ${(c.candidateDeathRate*100).toFixed(0)}% | ${c.seconds.toFixed(1)} | ${c.ammoUsed.toFixed(1)} |`)
}
lines.push('','预算仅为目录参考估值与插件通用黑匣主料参照，不等于实际获取成本。','支援字段是船存活时的能力资格时间，不是实际治疗量；当前指挥增伤/射程压制读取编队清单，未在预演中改变死亡后的效力。')
writeFileSync(resolve(dir,'comparison.md'),lines.join('\n')+'\n','utf8')
console.log(JSON.stringify({aggregate,largeChanges:changed.length,out:dir},null,2))
