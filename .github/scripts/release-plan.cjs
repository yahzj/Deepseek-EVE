/** 统一发布的只读版本解析及本地产物清单；不推送、建标签或调用线上API。 */
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const SHA = /^[0-9a-f]{40}$/
const TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/
const MANIFEST = 'release-manifest.json'
const git = (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()

function validRef(name) {
  assert(typeof name === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./+-]*$/.test(name), '版本引用格式非法')
  return name
}

function resolveCommit(cwd, sourceRef) {
  validRef(sourceRef)
  if (SHA.test(sourceRef)) return git(cwd, ['rev-parse', '--verify', `${sourceRef}^{commit}`])
  const names = sourceRef.startsWith('refs/heads/') ? [`refs/remotes/origin/${sourceRef.slice(11)}`]
    : sourceRef.startsWith('refs/tags/') ? [sourceRef]
      : [`refs/remotes/origin/${sourceRef}`, `refs/tags/${sourceRef}`]
  const matches = names.filter(ref => {
    try { git(cwd, ['show-ref', '--verify', ref]); return true } catch { return false }
  })
  assert.equal(matches.length, 1, '版本引用不存在或分支/标签同名，请使用完整引用或40位SHA')
  return git(cwd, ['rev-parse', '--verify', `${matches[0]}^{commit}`])
}

function checkVersion(tagName, version) {
  assert(TAG.test(tagName), 'Windows需要v开头的版本标签，例如v0.2.0')
  assert.equal(tagName, `v${version}`, '版本标签与apps/desktop/package.json不一致')
}

function resolvePlan({ cwd, target, sourceRef, tagName = '', defaultBranch }) {
  assert(['web', 'windows', 'both'].includes(target), '请选择web、windows或both')
  validRef(defaultBranch)
  const sourceSha = resolveCommit(cwd, sourceRef)
  assert(SHA.test(sourceSha), '无法解析完整提交SHA')
  git(cwd, ['merge-base', '--is-ancestor', sourceSha, `refs/remotes/origin/${defaultBranch}`])
  const windows = target !== 'web'
  if (windows || tagName) {
    assert(TAG.test(tagName), 'Windows发布必须提供已推送的v版本标签')
    assert.equal(git(cwd, ['rev-parse', '--verify', `refs/tags/${tagName}^{commit}`]), sourceSha, '版本标签与所选源码不是同一提交')
    const pkg = JSON.parse(git(cwd, ['show', `${sourceSha}:apps/desktop/package.json`]))
    checkVersion(tagName, pkg.version)
  }
  return { schemaVersion: 1, sourceRef, sourceSha, defaultBranch, web: target !== 'windows', windows, tagName }
}

function hashFile(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

function artifactFiles(root, platform) {
  assert(['web', 'windows'].includes(platform), '未知产物平台')
  const files = []
  function walk(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === MANIFEST && !prefix) continue
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      assert(!entry.isSymbolicLink(), '产物不允许符号链接')
      if (entry.isDirectory()) { if (platform === 'web') walk(path.join(directory, entry.name), relative); continue }
      assert(entry.isFile(), '产物包含非普通文件')
      if (platform === 'web' || !prefix && /\.(zip|exe)$/i.test(entry.name)) files.push(relative)
    }
  }
  walk(root)
  if (platform === 'web') assert(files.includes('index.html'), '网页产物缺少index.html')
  else {
    assert(files.some(file => file.endsWith('.zip')), 'Windows产物缺少zip')
    assert(files.some(file => file.endsWith('.exe')), 'Windows产物缺少exe')
  }
  return files.sort()
}

function createManifest({ root, platform, sourceSha, tagName = '', pipelineSha = '' }) {
  assert(SHA.test(sourceSha), '无效的源码SHA')
  assert.equal(git(root, ['rev-parse', 'HEAD']), sourceSha, '产物所属源码检出与发布计划不一致')
  if (platform === 'windows') assert(TAG.test(tagName), 'Windows产物缺少版本标签')
  const files = artifactFiles(root, platform).map(relative => {
    const file = path.join(root, relative)
    return { path: relative, bytes: fs.statSync(file).size, sha256: hashFile(file) }
  })
  const manifest = { schemaVersion: 1, platform, sourceSha, tagName, pipelineSha, files }
  fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return manifest
}

function verifyManifest({ root, sourceSha, tagName }) {
  assert(SHA.test(sourceSha) && TAG.test(tagName), '产物校验缺少有效SHA或版本标签')
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'))
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.platform, 'windows')
  assert.equal(manifest.sourceSha, sourceSha, '下载产物不是本次锁定的源码')
  assert.equal(manifest.tagName, tagName, '下载产物版本不一致')
  assert(Array.isArray(manifest.files) && manifest.files.length >= 2 && manifest.files.length <= 20)
  const names = manifest.files.map(row => {
    assert(typeof row.path === 'string' && row.path === path.basename(row.path) && !/[\\/:\r\n]/.test(row.path) && /\.(zip|exe)$/.test(row.path), '非法产物路径')
    const file = path.join(root, row.path)
    assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(), '下载产物不是普通文件')
    assert.equal(fs.statSync(file).size, row.bytes, '产物大小不符')
    assert.equal(hashFile(file), row.sha256, '产物校验和不符')
    return row.path
  })
  assert.equal(new Set(names.map(name => name.toLowerCase())).size, names.length, '产物清单重复')
  assert.deepEqual(fs.readdirSync(root).sort(), [...names, MANIFEST].sort(), '下载目录存在未登记或缺失文件')
  assert.deepEqual(artifactFiles(root, 'windows'), names.sort())
  return manifest
}

function main() {
  const env = process.env, command = process.argv[2]
  if (command === 'resolve') {
    const plan = resolvePlan({ cwd: process.cwd(), target: env.RELEASE_TARGET, sourceRef: env.RELEASE_SOURCE_REF,
      tagName: env.RELEASE_TAG || '', defaultBranch: env.RELEASE_DEFAULT_BRANCH })
    fs.writeFileSync('publication-plan.json', `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `source_sha=${plan.sourceSha}\nweb=${plan.web}\nwindows=${plan.windows}\ntag_name=${plan.tagName}\n`)
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `## Publication Plan\n\nSource: ${plan.sourceSha}\n\nWeb: ${plan.web}; Windows: ${plan.windows}; Tag: ${plan.tagName || 'none'}\n`)
    console.log(JSON.stringify(plan))
  } else if (command === 'version') {
    const pkg = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
    checkVersion(env.RELEASE_TAG, pkg.version)
  } else if (command === 'manifest') {
    console.log(JSON.stringify(createManifest({ root: path.resolve(process.argv[4]), platform: process.argv[3],
      sourceSha: env.RELEASE_SHA, tagName: env.RELEASE_TAG || '', pipelineSha: env.GITHUB_SHA || '' })))
  } else if (command === 'verify') {
    console.log(JSON.stringify(verifyManifest({ root: path.resolve(process.argv[3]), sourceSha: env.RELEASE_SHA, tagName: env.RELEASE_TAG })))
  } else throw new Error('命令需为resolve、version、manifest或verify')
}

module.exports = { resolvePlan, resolveCommit, checkVersion, createManifest, verifyManifest }
if (require.main === module) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
