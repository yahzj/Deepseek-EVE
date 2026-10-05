/** 无人机首次出击错峰隔离预演：不写正式core/data。
 * 用法：npx tsx tools/drone-launch-preview.ts [--seeds N]
 * 产物写入 tools/_ui-artifacts/drone-launch-preview；预演不代表正式玩法已改。
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { DRONE_LAUNCH_PREVIEW_MODES } from './drone-launch-preview-curves'

const root = resolve(process.cwd())
const out = resolve('tools/_ui-artifacts/drone-launch-preview')
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const guarded = execFileSync('git', ['ls-files', '-z', '--', 'packages/core/src', 'packages/data/src'], { encoding: 'utf8' })
  .split('\0').filter(Boolean)
const hashes = () => Object.fromEntries(guarded.map((path) => [path, createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')]))

async function main(): Promise<void> {
  const before = hashes()
  mkdirSync(out, { recursive: true })
  for (const mode of DRONE_LAUNCH_PREVIEW_MODES) {
    let observed = false
    let gated = false
    const output = resolve(out, `worker-${mode}.cjs`)
    await build({
      entryPoints: [resolve('tools/drone-launch-preview-worker.ts')], outfile: output, bundle: true,
      platform: 'node', target: 'node20', format: 'cjs', define: { __DRONE_LAUNCH_MODE__: JSON.stringify(mode) }, logLevel: 'warning',
      plugins: [{ name: 'isolated-drone-launch-gate', setup(builder) {
        builder.onLoad({ filter: /[\\/]combat\.ts$/ }, (args) => {
          const text = readFileSync(args.path, 'utf8')
          const poolLine = '        const poolEntry = b.dronePools?.[dronePoolKey(unit.tag, wi)]'
          assert.equal(text.split(poolLine).length, 2, '无人机池门控锚点漂移')
          const injected = `${poolLine}\n        previewDroneLaunchObserve(__DRONE_LAUNCH_MODE__, b, unit.tag, wi, poolEntry)`
          const rangeAnchor = '      if (!droneHit && !inRange(b.distanceM, w)) continue;'
          assert.equal(text.split(rangeAnchor).length, 2, '无人机射程门控锚点漂移')
          const rangeInjected = `${rangeAnchor}\n      if (w.src === 'drone' && !previewDroneLaunchGate(__DRONE_LAUNCH_MODE__, b, unit.tag, wi, b.dronePools?.[dronePoolKey(unit.tag, wi)])) continue;`
          const importPath = resolve('tools/drone-launch-preview-curves.ts').replace(/\\/g, '/')
          observed = true; gated = true
          return { contents: `import { previewDroneLaunchGate, previewDroneLaunchObserve } from ${JSON.stringify(importPath)}\n` + text.replace(poolLine, injected).replace(rangeAnchor, rangeInjected), loader: 'ts', resolveDir: resolve('packages/core/src') }
        })
      } }],
    })
    assert(observed && gated)
    await new Promise<void>((resolveDone, reject) => {
      const child = spawn(process.execPath, [output, ...process.argv.slice(2)], { cwd: root, windowsHide: true, stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolveDone() : reject(new Error(`${mode}预演退出码${code}`)))
    })
    assert.deepEqual(hashes(), before, '预演修改了正式源码')
  }
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), revision, '预演中Git基线改变')
  console.log(JSON.stringify({ ok: true, out, modes: DRONE_LAUNCH_PREVIEW_MODES, sourceUnchanged: true }))
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
