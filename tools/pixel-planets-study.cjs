/** PixelPlanets原生分辨率/分层研究：12预设共26张，128/1024本体像素。
 * 用法：node tools/pixel-planets-study.cjs <不存在的工程内tools/_ui-artifacts输出目录绝对路径>。
 * 不覆盖原素材或个人档；Godot3.5/游戏v0.1.0/档v31，2026-10-10核对。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const exe = path.resolve(root, '../PixelPlanetsWindows.exe')
if (process.argv[2]) assert(path.isAbsolute(process.argv[2]), '输出参数须为绝对路径')
const output = path.resolve(process.argv[2] ?? path.join(root, 'tools/_ui-artifacts/pixel-planets-study-20261010'))
assert(output.startsWith(path.join(root, 'tools/_ui-artifacts') + path.sep), '输出仅限本树忽略目录')
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'), '7f3fed02dd20d21e36c159883b9cface6bc63f0797e53f3828a83fce67153538')
assert(!fs.existsSync(output), '不覆盖已有研究输出')
fs.mkdirSync(output, { recursive: true })
const run = spawnSync(exe, ['--no-window', '--audio-driver', 'Dummy', '--video-driver', 'GLES2', '--script', path.join(__dirname, 'pixel-planets-study-export.gd')], {
  cwd: output, env: { ...process.env, WHALE_PLANET_STUDY_OUT: output, WHALE_PLANET_STUDY_PARAMETERS: path.join(root, 'apps/desktop/src/renderer/src/assets/stellar/parameters.json') },
  encoding: 'utf8', windowsHide: true, timeout: 120000,
})
console.log(run.stdout)
if (run.error) throw run.error
assert.equal(run.status, 0, run.stderr)
assert(!/SCRIPT ERROR|Shader compilation failed|ERROR:/i.test(run.stderr), run.stderr)
const parameters = JSON.parse(fs.readFileSync(path.join(output, 'parameters.json'), 'utf8'))
assert.equal(parameters.length, 26)
assert.equal(new Set(parameters.map(row => row.id)).size, 12)
console.log(JSON.stringify({ ok: true, samples: parameters.length, presets: 12, output }))
