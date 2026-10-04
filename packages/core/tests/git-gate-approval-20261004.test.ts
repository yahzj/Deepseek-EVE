import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const gate = createRequire(import.meta.url)(join(root, 'tools/git-gate-approval.cjs')) as {
  snapshot: (cwd: string) => { fingerprint: string; tree: string; gitDir: string; required: string[] }
  recordPaths: (snapshot: object) => { approval: string; pending: string }
  approve: (cwd: string, paths: string[], reason: string) => object
  check: (cwd: string, tree: string) => object
  prepare: (cwd: string, tree: string) => object
  consume: (cwd: string) => boolean
}
const tempRoots: string[] = []
const approvedPath = 'packages/core/src/save.ts'
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim()
}
function write(cwd: string, path: string, content: string): void {
  const target = join(cwd, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content, 'utf8')
}
function repo(hooks = false) {
  const cwd = mkdtempSync(join(tmpdir(), 'whale-gate-test-'))
  tempRoots.push(cwd)
  git(cwd, 'init', '-q')
  git(cwd, 'config', 'user.email', 'gate-test@example.invalid')
  git(cwd, 'config', 'user.name', 'Gate Test')
  git(cwd, 'config', 'core.autocrlf', 'false')
  git(cwd, 'config', 'core.hooksPath', '.githooks')
  write(cwd, 'initial.txt', 'initial\n')
  git(cwd, 'add', '.')
  git(cwd, 'commit', '-qm', 'initial')
  const bin = join(cwd, 'test-bin')
  if (hooks) {
    for (const path of ['.githooks/pre-commit', '.githooks/post-commit', 'tools/git-gate-approval.cjs']) {
      mkdirSync(dirname(join(cwd, path)), { recursive: true })
      copyFileSync(join(root, path), join(cwd, path))
    }
    mkdirSync(bin)
    write(cwd, 'test-bin/npm', '#!/bin/sh\nprintf "%s\\n" "$3" >> gate-test-commands\n' +
      'if [ "${GATE_TEST_FAIL:-}" = "$3" ]; then exit 1; fi\nexit 0\n')
  }
  write(cwd, approvedPath, 'export const value = 1\n')
  git(cwd, 'add', '.')
  const commit = (env: Record<string, string> = {}) => spawnSync('git', ['-C', cwd, 'commit', '-m', 'candidate'], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}`, ...env },
  })
  return { cwd, commit }
}
afterEach(() => {
  for (const cwd of tempRoots.splice(0)) {
    const target = resolve(cwd)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('whale-gate-test-')) throw new Error('测试清理路径越界')
    rmSync(target, { recursive: true, force: true })
  }
})

describe('提交钩子精确审批', () => {
  it('无审批拒绝；明确范围和暂存树匹配时放行', () => {
    const { cwd } = repo()
    const state = gate.snapshot(cwd)
    expect(state.required).toEqual([approvedPath])
    expect(() => gate.check(cwd, state.fingerprint)).toThrow('缺少匹配')
    expect(() => gate.approve(cwd, [approvedPath], '')).toThrow('批准的依据')
    gate.approve(cwd, [approvedPath], '船长明确批准测试改动')
    expect(() => gate.check(cwd, state.fingerprint)).not.toThrow()
  })
  it('通配符、无关路径和部分范围不能放行', () => {
    const { cwd } = repo()
    write(cwd, 'docs/test-saves/example.json', '{}\n')
    git(cwd, 'add', '.')
    expect(() => gate.approve(cwd, ['packages/**'], '批准')).toThrow('精确路径')
    expect(() => gate.approve(cwd, ['initial.txt'], '批准')).toThrow('精确路径')
    gate.approve(cwd, [approvedPath], '批准部分')
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).toThrow('范围不完整')
  })
  it.each(['approved', 'unrelated'])('%s 暂存内容改变后原批准失效', (mode) => {
    const { cwd } = repo()
    gate.approve(cwd, [approvedPath], '批准')
    write(cwd, mode === 'approved' ? approvedPath : 'unrelated.txt', 'changed\n')
    git(cwd, 'add', '.')
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).toThrow('缺少匹配')
  })
  it('基线和分支改变后原批准失效', () => {
    const { cwd } = repo()
    gate.approve(cwd, [approvedPath], '批准')
    git(cwd, 'checkout', '-qb', 'changed-branch')
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).toThrow('缺少匹配')
    gate.approve(cwd, [approvedPath], '批准新分支')
    git(cwd, 'commit', '--allow-empty', '-qm', 'baseline changed', '--only', 'initial.txt')
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).toThrow('缺少匹配')
  })
  it('未暂存的已跟踪变化不能被技术检查代替暂存内容', () => {
    const { cwd } = repo()
    gate.approve(cwd, [approvedPath], '批准')
    write(cwd, approvedPath, 'unstaged\n')
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).toThrow('与暂存区不一致')
  })
  it('检查过程中暂存树变化时不能准备成功回执', () => {
    const { cwd } = repo()
    const before = gate.snapshot(cwd).fingerprint
    gate.approve(cwd, [approvedPath], '批准')
    write(cwd, 'more.txt', 'more\n')
    git(cwd, 'add', '.')
    expect(() => gate.prepare(cwd, before)).toThrow('暂存内容或基线变化')
  })
  it('跨工作树复制审批记录不能放行', () => {
    const { cwd } = repo()
    gate.approve(cwd, [approvedPath], '批准')
    const other = mkdtempSync(join(tmpdir(), 'whale-gate-test-'))
    tempRoots.push(other)
    git(cwd, 'worktree', 'add', '-qb', 'other', other)
    write(other, approvedPath, 'export const value = 1\n')
    git(other, 'add', '.')
    copyFileSync(gate.recordPaths(gate.snapshot(cwd)).approval, gate.recordPaths(gate.snapshot(other)).approval)
    expect(() => gate.check(other, gate.snapshot(other).fingerprint)).toThrow('缺少匹配')
  })
  it('空范围无须批准；B3标定文件仍需批准', () => {
    const { cwd } = repo()
    git(cwd, 'restore', '--staged', approvedPath)
    expect(gate.snapshot(cwd).required).toEqual([])
    write(cwd, 'packages/core/src/balance.ts', 'balance\n')
    git(cwd, 'add', 'packages/core/src/balance.ts')
    expect(gate.snapshot(cwd).required).toEqual(['packages/core/src/balance.ts'])
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).toThrow('缺少匹配')
  })
  it('合并继承的相同B类文件豁免，我方继续修改仍须审批', () => {
    const { cwd } = repo()
    git(cwd, 'restore', '--staged', approvedPath)
    git(cwd, 'checkout', '-qb', 'incoming')
    git(cwd, 'add', approvedPath)
    git(cwd, 'commit', '-qm', 'incoming save change')
    git(cwd, 'checkout', '-')
    write(cwd, 'own.txt', 'own\n')
    git(cwd, 'add', 'own.txt')
    git(cwd, 'commit', '-qm', 'own change')
    git(cwd, 'merge', '--no-commit', '--no-ff', 'incoming')
    expect(gate.snapshot(cwd).required).toEqual([])
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).not.toThrow()
    write(cwd, approvedPath, 'merge own change\n')
    git(cwd, 'add', approvedPath)
    expect(gate.snapshot(cwd).required).toEqual([approvedPath])
  })
  it('损坏的审批记录不会静默放行', () => {
    const { cwd } = repo()
    writeFileSync(gate.recordPaths(gate.snapshot(cwd)).approval, '{broken', 'utf8')
    expect(() => gate.check(cwd, gate.snapshot(cwd).fingerprint)).toThrow('记录损坏')
  })
  it('真实钩子：无审批仍跑全部技术检查并拒绝，批准后成功消费，后续不能复用', () => {
    const { cwd, commit } = repo(true)
    const rejected = commit()
    expect(rejected.status, rejected.stderr + rejected.stdout).not.toBe(0)
    const commands = readFileSync(join(cwd, 'gate-test-commands'), 'utf8')
    for (const command of ['typecheck', 'content:check', 'l10n:check', 'ui:rot-check']) expect(commands).toContain(command)
    gate.approve(cwd, [approvedPath], '船长批准')
    const accepted = commit()
    expect(accepted.status, accepted.stderr + accepted.stdout).toBe(0)
    const files = gate.recordPaths(gate.snapshot(cwd))
    expect(existsSync(files.approval)).toBe(false)
    expect(existsSync(files.pending)).toBe(false)
    write(cwd, approvedPath, 'next change\n')
    git(cwd, 'add', approvedPath)
    expect(commit().status).not.toBe(0)
  }, 20_000)
  it('真实钩子：技术失败即拒绝且不消费审批，修复后才能提交', () => {
    const { cwd, commit } = repo(true)
    gate.approve(cwd, [approvedPath], '船长批准')
    const before = git(cwd, 'rev-parse', 'HEAD')
    const rejected = commit({ GATE_TEST_FAIL: 'typecheck' })
    expect(rejected.status).not.toBe(0)
    expect(git(cwd, 'rev-parse', 'HEAD')).toBe(before)
    expect(existsSync(gate.recordPaths(gate.snapshot(cwd)).approval)).toBe(true)
    const accepted = commit()
    expect(accepted.status, accepted.stderr + accepted.stdout).toBe(0)
    expect(existsSync(gate.recordPaths(gate.snapshot(cwd)).approval)).toBe(false)
  }, 20_000)
  it('提交消息钩子失败不消费批准，成功重试才消费', () => {
    const { cwd, commit } = repo(true)
    write(cwd, '.githooks/commit-msg', '#!/bin/sh\nif [ "${GATE_TEST_MESSAGE_FAIL:-}" = 1 ]; then exit 1; fi\nexit 0\n')
    git(cwd, 'add', '.githooks/commit-msg')
    gate.approve(cwd, [approvedPath], '船长批准')
    expect(commit({ GATE_TEST_MESSAGE_FAIL: '1' }).status).not.toBe(0)
    const files = gate.recordPaths(gate.snapshot(cwd))
    expect(existsSync(files.approval)).toBe(true)
    expect(existsSync(files.pending)).toBe(true)
    expect(gate.consume(cwd)).toBe(false)
    const accepted = commit()
    expect(accepted.status, accepted.stderr + accepted.stdout).toBe(0)
    expect(existsSync(files.approval)).toBe(false)
  }, 20_000)
})
