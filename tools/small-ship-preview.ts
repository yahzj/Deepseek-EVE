/** 插件小船与三条命中曲线隔离预演，不写正式core/data、不读取个人档。
 * 用法：npx tsx tools/small-ship-preview.ts [--quick] [--seeds N]；--focus用于20种子深层难局复核。
 * bundle与报告落tools/_ui-artifacts/small-ship-preview，不把夹具预演当正常游玩。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-05。
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import ts from 'typescript'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { PREVIEW_CURVES } from './small-ship-curves'

const root = resolve(process.cwd()), out = resolve('tools/_ui-artifacts/small-ship-preview')
const revision = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const guarded = execFileSync('git',['ls-files','-z','--','packages/core/src','packages/data/src'],{encoding:'utf8'}).split('\0').filter(Boolean)
const hashes = () => Object.fromEntries(guarded.map((p) => [p, createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]))
async function main() {
  const before = hashes()
  const suffix = process.argv.includes('--focus') ? '-focus' : process.argv.includes('--quick') ? '-quick' : ''
  mkdirSync(out, { recursive: true })
  for (const curve of PREVIEW_CURVES) {
    let replacedMath = false, replacedPD = false
    const output = resolve(out, `worker-${curve}.cjs`)
    await build({ entryPoints: [resolve('tools/small-ship-preview-worker.ts')], outfile: output, bundle: true, platform: 'node', target: 'node20', format: 'cjs',
      define: { __PREVIEW_CURVE__: JSON.stringify(curve) },
      plugins: [{ name: 'isolated-hit-curve', setup(builder) {
        if (curve === 'current') return
        builder.onLoad({ filter: /[\\/]combatMath\.ts$/ }, (args) => {
          const text = readFileSync(args.path,'utf8')
          const source = ts.createSourceFile(args.path,text,ts.ScriptTarget.Latest,true)
          const fn = source.statements.find((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === 'hitChance')
          assert(fn?.body)
          const body = `{
            const df = dfOverride ?? distFactor(dist, weapon)
            const aim = (weapon.hitRate + attacker.hitBonus) * (weapon.eqHitMul ?? 1) * (attacker.hitMul ?? 1)
            return clamp(bal.hitMin, bal.hitMax, previewProbability(${JSON.stringify(curve)}, aim, defender.evasion, df))
          }`
          const importPath = resolve('tools/small-ship-curves.ts').replace(/\\/g,'/')
          replacedMath = true
          return { contents: `import { previewProbability } from ${JSON.stringify(importPath)}\n` + text.slice(0,fn.body.getStart(source)) + body + text.slice(fn.body.end), loader: 'ts', resolveDir: resolve('packages/core/src') }
        })
        builder.onLoad({ filter: /[\\/]combatDrones\.ts$/ }, (args) => {
          const text = readFileSync(args.path,'utf8'), old = 'const pHit = clamp(bal.pdHitFloor ?? 0, 1, shot.acc - pool.evasion)'
          assert.equal(text.split(old).length,2,'敌近防替换锚漂移')
          replacedPD = true
          const importPath = resolve('tools/small-ship-curves.ts').replace(/\\/g,'/')
          return { contents: `import { previewProbability } from ${JSON.stringify(importPath)}\n` + text.replace(old,`const pHit = clamp(bal.pdHitFloor ?? 0, 1, previewProbability(${JSON.stringify(curve)}, shot.acc, pool.evasion, 1))`), loader: 'ts', resolveDir: resolve('packages/core/src') }
        })
      } }], logLevel: 'warning' })
    if (curve !== 'current') assert(replacedMath && replacedPD,'曲线未覆盖双方命中与敌近防')
    await new Promise<void>((r,j) => {
      const child = spawn(process.execPath,[output,...process.argv.slice(2)],{cwd:root,windowsHide:true,stdio:'inherit'})
      child.on('error',j);child.on('exit',(code)=>code===0?r():j(new Error(`${curve}预演退出码${code}`)))
    })
    assert.deepEqual(hashes(),before,'预演修改了正式源码')
  }
  const reports = PREVIEW_CURVES.map((curve) => JSON.parse(readFileSync(resolve(out,`report-${curve}${suffix}.json`),'utf8')))
  assert(reports.every((r) => r.cells.length === reports[0].cells.length))
  for (const report of reports.slice(1)) for (let i=0;i<report.cells.length;i++) {
    const base=reports[0].cells[i], current=report.cells[i]
    assert.deepEqual([current.candidate,current.level,current.withPlates,current.target,current.budget,current.admission,current.loadouts],
      [base.candidate,base.level,base.withPlates,base.target,base.budget,base.admission,base.loadouts],'候选曲线配装/预算/质量发生变化')
  }
  const after = hashes()
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),revision,'预演中Git基线改变')
  writeFileSync(resolve(out,`summary${suffix}.json`),JSON.stringify({ revision,scope:'仅隔离预演，正式曲线及舰船数值未改',sourceHashes:after,unchanged:true,reports },null,2),'utf8')
  console.log(JSON.stringify({ ok:true,out,curves:PREVIEW_CURVES,sourceUnchanged:true,cellsPerCurve:reports[0].cells.length }))
}
main().catch((e)=>{console.error(e);process.exitCode=1})
