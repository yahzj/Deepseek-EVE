import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

const require = createRequire(import.meta.url)
const { load } = require('js-yaml')
const root = fileURLToPath(new URL('../../../', import.meta.url))
const { resolvePlan, resolveCommit, checkVersion, createManifest, verifyManifest } = require(join(root, '.github/scripts/release-plan.cjs'))
const workflow = (name: string): any => load(readFileSync(join(root, '.github/workflows', `${name}.yml`), 'utf8'))
const publish = workflow('publish'), web = workflow('pages'), windows = workflow('release')

let folder: string, repo: string, first: string, current: string, outside: string
function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-C', repo, ...args],
    { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), 'whale-manual-publish-'))
  repo = join(folder, 'source')
  mkdirSync(join(repo, 'apps/desktop'), { recursive: true })
  git('init', '--initial-branch=main')
  git('config', 'user.name', 'Publication Fixture')
  git('config', 'user.email', 'publication-fixture@example.invalid')
  git('config', 'core.hooksPath', join(folder, 'no-hooks'))
  writeFileSync(join(repo, 'apps/desktop/package.json'), JSON.stringify({ version: '1.2.3' }))
  git('add', '.'); git('commit', '-m', 'fixture-one')
  first = git('rev-parse', 'HEAD')
  git('tag', 'v1.2.3')
  writeFileSync(join(repo, 'apps/desktop/package.json'), JSON.stringify({ version: '1.2.4' }))
  git('add', '.'); git('commit', '-m', 'fixture-two')
  current = git('rev-parse', 'HEAD')
  git('tag', '-a', 'v1.2.4', '-m', 'annotated fixture')
  git('update-ref', 'refs/remotes/origin/main', current)
  git('update-ref', 'refs/remotes/origin/same', current)
  git('tag', 'same', first)
  git('checkout', '-b', 'fixture-other', first)
  writeFileSync(join(repo, 'other.txt'), 'not merged')
  git('add', '.'); git('commit', '-m', 'fixture-unmerged')
  outside = git('rev-parse', 'HEAD')
  git('update-ref', 'refs/remotes/origin/other', outside)
  git('checkout', 'main')
})
afterAll(() => {
  if (!folder) return
  expect(dirname(resolve(folder))).toBe(resolve(tmpdir()))
  expect(folder.startsWith(join(tmpdir(), 'whale-manual-publish-'))).toBe(true)
  expect(realpathSync(folder)).toBe(folder)
  rmSync(folder, { recursive: true })
})

const plan = (overrides: object = {}) => resolvePlan({ cwd: repo, target: 'web', sourceRef: 'main', tagName: '', defaultBranch: 'main', ...overrides })

describe('统一发布版本计划（独立Git仓库，不读项目历史）', () => {
  it('解析分支并固定40位SHA，后续引用移动不改已生成计划', () => {
    const result = plan()
    expect(result).toMatchObject({ sourceSha: current, web: true, windows: false, tagName: '' })
    git('update-ref', 'refs/remotes/origin/temp', first)
    const pinned = plan({ sourceRef: 'temp' })
    git('update-ref', 'refs/remotes/origin/temp', current)
    expect(pinned.sourceSha).toBe(first)
  })
  it.each(['v1.2.3', 'refs/tags/v1.2.3'])('旧标签%s可用于重新部署网页', sourceRef => {
    expect(plan({ sourceRef }).sourceSha).toBe(first)
  })
  it('Windows支持轻量/附注标签，both使用同一SHA并核对包版本', () => {
    expect(plan({ target: 'windows', sourceRef: first, tagName: 'v1.2.3' })).toMatchObject({ web: false, windows: true, sourceSha: first })
    expect(plan({ target: 'both', tagName: 'v1.2.4' })).toMatchObject({ web: true, windows: true, sourceSha: current })
  })
  it('相同名字的分支与标签拒绝猜测，完整引用可消歧', () => {
    expect(() => resolveCommit(repo, 'same')).toThrow(/同名/)
    expect(resolveCommit(repo, 'refs/heads/same')).toBe(current)
    expect(resolveCommit(repo, 'refs/tags/same')).toBe(first)
  })
  it.each(['--help', 'main\nmalicious=true', 'main;echo', 'main^{tree}', ''])('拒绝非法引用%s', sourceRef => {
    expect(() => plan({ sourceRef })).toThrow()
  })
  it('未合入默认分支的提交不得发布', () => {
    expect(() => plan({ sourceRef: outside })).toThrow()
    expect(() => plan({ sourceRef: 'other' })).toThrow()
  })
  it('缺标签、标签指向其他SHA或包版本不符均拒绝', () => {
    expect(() => plan({ target: 'windows' })).toThrow(/版本标签/)
    expect(() => plan({ target: 'both', tagName: 'v1.2.3' })).toThrow(/同一提交/)
    git('tag', 'v9.9.9', current)
    expect(() => plan({ target: 'windows', tagName: 'v9.9.9' })).toThrow(/package.json/)
    expect(() => checkVersion('vv1.2.3', '1.2.3')).toThrow()
    expect(() => plan({ target: 'server' })).toThrow()
  })
})

function artifacts() {
  const dir = mkdtempSync(join(repo, 'windows-fixture-'))
  writeFileSync(join(dir, 'game.zip'), 'independent zip fixture')
  writeFileSync(join(dir, 'game.exe'), 'independent exe fixture')
  return dir
}
const manifest = (dir: string) => createManifest({ root: dir, platform: 'windows', sourceSha: current, tagName: 'v1.2.4' })
const verify = (dir: string) => verifyManifest({ root: dir, sourceSha: current, tagName: 'v1.2.4' })

describe('本地产物清单及篡改拒绝', () => {
  it('记录检出SHA、文件大小和校验和，重复清单拒绝覆盖', () => {
    const dir = artifacts(), result = manifest(dir)
    expect(verify(dir)).toEqual(result)
    expect(result.files).toHaveLength(2)
    expect(() => manifest(dir)).toThrow()
  })
  it('源码SHA不符不生成可发布清单', () => {
    expect(() => createManifest({ root: artifacts(), platform: 'windows', sourceSha: first, tagName: 'v1.2.3' })).toThrow(/检出/)
  })
  it('拒绝文件篡改、缺失和额外未登记文件', () => {
    const a = artifacts(); manifest(a)
    writeFileSync(join(a, 'game.zip'), 'changed')
    expect(() => verify(a)).toThrow()
    const b = artifacts(); manifest(b)
    rmSync(join(b, 'game.exe'))
    expect(() => verify(b)).toThrow()
    const c = artifacts(); manifest(c)
    writeFileSync(join(c, 'extra.zip'), 'unregistered')
    expect(() => verify(c)).toThrow(/未登记/)
  })
  it('拒绝错误平台、版本、目录逃逸和重复路径', () => {
    for (const mutate of [
      (m: any) => { m.sourceSha = first },
      (m: any) => { m.tagName = 'v1.2.3' },
      (m: any) => { m.files[0].path = '../game.exe' },
      (m: any) => { m.files[1] = { ...m.files[0] } },
      (m: any) => { m.platform = 'web' },
    ]) {
      const dir = artifacts(), m = manifest(dir)
      mutate(m)
      writeFileSync(join(dir, 'release-manifest.json'), JSON.stringify(m))
      expect(() => verify(dir)).toThrow()
    }
  })
  it('Windows两种产物必须齐全；网页要求index并包含嵌套静态资产', () => {
    const dir = mkdtempSync(join(repo, 'web-fixture-'))
    expect(() => createManifest({ root: dir, platform: 'windows', sourceSha: current, tagName: 'v1.2.4' })).toThrow(/zip/)
    expect(() => createManifest({ root: dir, platform: 'web', sourceSha: current })).toThrow(/index/)
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    writeFileSync(join(dir, 'assets/game.js'), 'fixture')
    expect(createManifest({ root: dir, platform: 'web', sourceSha: current }).files.map((f: any) => f.path)).toEqual(['assets/game.js', 'index.html'])
  })
})

describe('工作流触发、依赖和发布权限契约', () => {
  it('仅统一入口手动触发，所有工作流没有push/tag/schedule部署触发', () => {
    expect(Object.keys(publish.on)).toEqual(['workflow_dispatch'])
    for (const child of [web, windows]) expect(Object.keys(child.on)).toEqual(['workflow_call'])
    expect(publish.on.workflow_dispatch.inputs.target.options).toEqual(['web', 'windows', 'both'])
    expect(publish.concurrency).toEqual({ group: 'production-publish', 'cancel-in-progress': false })
  })
  it('内部构建只有只读权限、不部署不发布且锁定同一个源码SHA', () => {
    for (const child of [web, windows]) {
      expect(child.permissions).toEqual({ contents: 'read' })
      expect(child.jobs.build.steps.some((s: any) => s.with?.ref === '${{ inputs.source_sha }}' && s.with?.path === 'source')).toBe(true)
      expect(child.jobs.build.steps.some((s: any) => /deploy-pages|action-gh-release/.test(s.uses ?? ''))).toBe(false)
    }
    for (const name of ['build-web', 'build-windows']) expect(publish.jobs[name].with.source_sha).toBe('${{ needs.resolve.outputs.source_sha }}')
    expect(publish.jobs['publish-web'].permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' })
    expect(publish.jobs['publish-windows'].permissions).toEqual({ contents: 'write' })
    expect(publish.jobs.resolve.steps.some((s: any) => s.env?.WORKFLOW_REF && s.run?.includes('refs/heads/$DEFAULT_BRANCH'))).toBe(true)
  })
  it('网页/Windows/both全部所选构建成功才过ready，失败、取消或错误跳过均拦住', () => {
    const expression = publish.jobs.ready.if.trim().slice(3, -2)
    for (const target of ['web', 'windows', 'both']) {
      const needs = { resolve: { result: 'success', outputs: { web: String(target !== 'windows'), windows: String(target !== 'web') } },
        checks: { result: 'success' }, 'build-web': { result: target === 'windows' ? 'skipped' : 'success' },
        'build-windows': { result: target === 'web' ? 'skipped' : 'success' } }
      const passes = (cancelled = false) => runInNewContext(expression, { needs, always: () => true, cancelled: () => cancelled })
      expect(passes()).toBe(true)
      expect(passes(true)).toBe(false)
      for (const name of ['checks', 'build-web', 'build-windows'] as const) {
        const original = needs[name].result
        for (const result of ['failure', 'cancelled', original === 'success' ? 'skipped' : 'success']) {
          needs[name].result = result
          expect(passes()).toBe(false)
        }
        needs[name].result = original
      }
    }
  })
  it('发布任务只依赖ready成功，Windows先验清单再上传草稿，最后复核标签发布', () => {
    for (const name of ['publish-web', 'publish-windows']) {
      expect(publish.jobs[name].needs).toContain('ready')
      expect(publish.jobs[name].if).toContain("needs.ready.result == 'success'")
    }
    expect(publish.jobs.ready.steps.some((s: any) => s.if?.includes('windows') && s.with?.script?.includes('listReleases'))).toBe(true)
    const steps = publish.jobs['publish-windows'].steps
    const draft = steps.findIndex((s: any) => s.uses?.startsWith('softprops/action-gh-release'))
    const verify = steps.findIndex((s: any) => s.run?.includes('release-plan.cjs verify'))
    expect(verify).toBeLessThan(draft)
    expect(steps[draft].with.draft).toBe(true)
    expect(steps[draft].with.fail_on_unmatched_files).toBe(true)
    expect(steps.at(-1).with.script).toContain('object.sha !== process.env.RELEASE_SHA')
    expect(steps.at(-1).with.script).toContain('draft: false')
    expect(publish.jobs.summary.if).toBe('always()')
  })
})
