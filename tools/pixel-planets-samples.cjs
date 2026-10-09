/** PixelPlanets本机原生shader透明样片导出，不调用图片API、不读取玩家档。
 * 用法：node tools/pixel-planets-samples.cjs [EXE绝对路径] [独立输出目录绝对路径]。
 * 默认输出docs/design/assets/stellar-samples-20261009；不覆盖已有样片。
 * 版本自检：Godot3.5 / 游戏v0.1.0 / 档v31，2026-10-09核对。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ROOT = path.resolve(__dirname, '..')
for (const argument of process.argv.slice(2)) assert(path.isAbsolute(argument), '显式输入须为绝对路径')
const exe = path.resolve(process.argv[2] ?? path.join(ROOT, '../PixelPlanetsWindows.exe'))
const output = path.resolve(process.argv[3] ?? path.join(ROOT, 'docs/design/assets/stellar-samples-20261009'))
const sha = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex')
assert.equal(sha, '7f3fed02dd20d21e36c159883b9cface6bc63f0797e53f3828a83fce67153538', '程序指纹变化，请先复核来源和Godot版本')
assert(!fs.existsSync(output), '不覆盖已有样片，请使用新的独立输出目录')
fs.mkdirSync(output, { recursive: true })
const version = spawnSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 10000 })
assert.equal(version.status, 0)
assert(version.stdout.includes('3.5.stable'))
const run = spawnSync(exe, ['--no-window', '--audio-driver', 'Dummy', '--video-driver', 'GLES2', '--script', path.join(ROOT, 'tools/pixel-planets-export.gd')], {
  cwd: output, env: { ...process.env, WHALE_PLANET_SAMPLE_OUT: output }, encoding: 'utf8', windowsHide: true, timeout: 60000,
})
console.log(run.stdout)
if (run.error) throw run.error
assert.equal(run.status, 0, run.stderr)
assert(!/SCRIPT ERROR|Shader compilation failed|ERROR:/i.test(run.stderr), run.stderr)
const parameters = JSON.parse(fs.readFileSync(path.join(output, 'parameters.json'), 'utf8'))
for (const row of parameters) {
  const bytes = fs.readFileSync(path.join(output, `${row.id}.png`))
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
  assert.equal(bytes.readUInt32BE(16), row.width)
  assert.equal(bytes.readUInt32BE(20), row.height)
  assert.equal(bytes[25], 6, '样片应为RGBA PNG')
  row.sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ engine: version.stdout.trim(), executableSha256: sha, sourceRepository: 'https://github.com/Deep-Fold/PixelPlanets', sourceCommit: 'a712f460077119aeb5f3b688c0785021df8cabb3', samples: parameters }, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, samples: parameters.length, output }))
