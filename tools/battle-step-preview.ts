/** 战斗步长隔离分析：npx tsx tools/battle-step-preview.ts。
 * 仅内存替换步长/步数预算、导出测试步进；不修改正式core/data、不读个人存档。
 * 输出tools/_ui-artifacts/battle-step-preview-20261008，核对全体正式源码哈希。
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd())
const out = resolve('tools/_ui-artifacts/battle-step-preview-20261008-implementation')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const paths = execFileSync('git', ['ls-files', '-z', '--', 'packages/core/src', 'packages/data/src'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const hashes = () => Object.fromEntries(paths.map(p => [p, createHash('sha256').update(readFileSync(resolve(root, p))).digest('hex')]))
const modes = [
  { step: 100, max: 40_000 }, { step: 50, max: 40_000 }, { step: 10, max: 40_000 }, { step: 10, max: 400_000 },
]

async function main() {
  const before = hashes()
  mkdirSync(out, { recursive: true })
  for (const mode of modes) {
    let injected = false
    const file = resolve(out, `worker-${mode.step}-${mode.max}.cjs`)
    await build({ entryPoints: [resolve('tools/battle-step-preview-worker.ts')], outfile: file, bundle: true,
      platform: 'node', target: 'node20', format: 'cjs', logLevel: 'warning',
      define: { __STEP_PREVIEW_MS__: String(mode.step), __STEP_PREVIEW_MAX__: String(mode.max) },
      plugins: [{ name: 'isolated-battle-step', setup(builder) {
        builder.onLoad({ filter: /[\\/]combat\.ts$/ }, args => {
          let text = readFileSync(args.path, 'utf8')
          const stepLine = text.match(/export const BATTLE_STEP_MS = [\d_]+/)?.[0]
          const maxLine = text.match(/export const BATTLE_MAX_STEPS = [\d_]+/)?.[0]
          assert(stepLine && maxLine, '生产步长常量缺失')
          for (const [from, to] of [
            [stepLine, `export const BATTLE_STEP_MS = ${mode.step}`],
            [maxLine, `export const BATTLE_MAX_STEPS = ${mode.max}`],
            ['function stepBattle(', 'export function stepBattle('],
          ]) {
            assert.equal(text.split(from!).length, 2, `隔离锚点漂移:${from}`)
            text = text.replace(from!, to!)
          }
          injected = true
          return { contents: text, loader: 'ts', resolveDir: resolve('packages/core/src') }
        })
      } }],
    })
    assert(injected)
    await new Promise<void>((done, reject) => {
      const child = spawn(process.execPath, [file], { cwd: root, windowsHide: true, stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', code => code === 0 ? done() : reject(new Error(`步长${mode.step}/${mode.max}退出码${code}`)))
    })
    assert.deepEqual(hashes(), before, '隔离分析修改了正式源码')
  }
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), revision)
  console.log(JSON.stringify({ ok: true, revision, modes, sourceUnchanged: true, out }))
}
main().catch(e => { console.error(e); process.exitCode = 1 })
