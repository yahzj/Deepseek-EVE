/**
 * Git提交审批记录：只放行已明确裁定的B类路径，不能替代技术检查或人的授权。
 * 用法：node tools/git-gate-approval.cjs approve --reason '船长明确批准依据' -- <精确路径...>
 * 查看：node tools/git-gate-approval.cjs status；撤销：node tools/git-gate-approval.cjs revoke。
 * snapshot/check/prepare/consume供钩子调用，记录位于本工作树Git目录，不进入存档或仓库。
 * 版本自检：游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04。
 */
const { execFileSync } = require('node:child_process')
const { existsSync, readFileSync, writeFileSync, unlinkSync } = require('node:fs')
const { resolve } = require('node:path')
const { createHash, randomUUID } = require('node:crypto')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true }).trim()
}

function paths(cwd, args) {
  return execFileSync('git', ['-C', cwd, 'diff', '--no-renames', '--name-only', '-z', ...args],
    { encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean).sort()
}

function snapshot(cwd) {
  const root = git(cwd, ['rev-parse', '--show-toplevel'])
  const gitDir = git(root, ['rev-parse', '--absolute-git-dir'])
  const mergePath = git(root, ['rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'])
  const mergeHeads = existsSync(mergePath) ? readFileSync(mergePath, 'utf8').trim().split(/\r?\n/) : []
  const head = git(root, ['rev-parse', '--verify', 'HEAD'])
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  const tree = git(root, ['write-tree'])
  const staged = paths(root, ['--cached', head])
  // 合并中只审我方相对其他父提交真正改过的路径，不为继承来的相同内容重新请求批准。
  const own = mergeHeads.length ? new Set(mergeHeads.flatMap((parent) => paths(root, ['--cached', parent]))) : new Set(staged)
  const required = staged.filter((p) => own.has(p) && (
    /(^|\/)save\.ts$|test-saves|ironman/.test(p) ||
    /^(tools\/docs-seal\.ts|packages\/core\/src\/balance\.ts)$/.test(p)
  ))
  const fingerprint = createHash('sha256').update(JSON.stringify({ root, gitDir, head, branch, tree, mergeHeads })).digest('hex')
  return { root, gitDir, head, branch, tree, mergeHeads, required, fingerprint }
}

function recordPaths(state) {
  return {
    approval: resolve(state.gitDir, 'whale-gate-approval.json'),
    pending: resolve(state.gitDir, 'whale-gate-pending.json'),
  }
}

function readRecord(path) {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error(`审批记录损坏：${path}`) }
}

function writeRecord(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', flag: 'w' })
}

function removeRecord(path) {
  if (existsSync(path)) unlinkSync(path)
}

function sameBinding(record, state) {
  return record?.version === 1 && record.root === state.root && record.gitDir === state.gitDir &&
    record.head === state.head && record.branch === state.branch && record.tree === state.tree &&
    JSON.stringify(record.mergeHeads) === JSON.stringify(state.mergeHeads)
}

function assertWorktree(cwd) {
  const unstaged = paths(cwd, [])
  if (unstaged.length) throw new Error(`已跟踪工作文件与暂存区不一致，请先整理暂存：\n${unstaged.join('\n')}`)
}

function approve(cwd, approvedPaths, reason) {
  const state = snapshot(cwd)
  assertWorktree(state.root)
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('必须记录船长明确批准的依据')
  const allow = [...new Set(approvedPaths)].sort()
  if (!allow.length || allow.some((p) => !state.required.includes(p))) {
    throw new Error('审批清单只能包含当前需要裁定的精确路径，不能使用通配符或批准无关文件')
  }
  const record = { version: 1, id: randomUUID(), ...state, paths: allow, reason: reason.trim(), createdAt: new Date().toISOString() }
  writeRecord(recordPaths(state).approval, record)
  return record
}

function check(cwd, expectedSnapshot) {
  const state = snapshot(cwd)
  assertWorktree(state.root)
  if (expectedSnapshot && expectedSnapshot !== state.fingerprint) throw new Error('技术检查期间暂存内容或基线变化，必须重新检查并批准')
  if (!state.required.length) return { state, approval: null }
  const record = readRecord(recordPaths(state).approval)
  if (!sameBinding(record, state)) {
    throw new Error(`缺少匹配当前工作树/基线/暂存树的批准记录：\n${state.required.join('\n')}`)
  }
  if (!Array.isArray(record.paths) || state.required.some((p) => !record.paths.includes(p))) {
    throw new Error(`批准范围不完整：\n${state.required.filter((p) => !record.paths?.includes(p)).join('\n')}`)
  }
  return { state, approval: record }
}

function prepare(cwd, fingerprint) {
  const { state, approval } = check(cwd, fingerprint)
  const pending = { version: 1, root: state.root, gitDir: state.gitDir, branch: state.branch,
    baseHead: state.head, tree: state.tree, approvalId: approval?.id ?? null,
    parents: [state.head, ...state.mergeHeads], amendParents: git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1) }
  writeRecord(recordPaths(state).pending, pending)
  return pending
}

function consume(cwd) {
  const state = snapshot(cwd)
  const files = recordPaths(state)
  const pending = readRecord(files.pending)
  if (!pending) return false
  const committedTree = git(cwd, ['rev-parse', 'HEAD^{tree}'])
  const parents = git(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)
  const sameParents = JSON.stringify(parents) === JSON.stringify(pending.parents) ||
    (pending.parents?.length === 1 && JSON.stringify(parents) === JSON.stringify(pending.amendParents))
  if (pending.version !== 1 || pending.root !== state.root || pending.gitDir !== state.gitDir ||
      pending.branch !== state.branch || pending.baseHead === state.head || pending.tree !== committedTree || !sameParents) return false
  const record = readRecord(files.approval)
  if (pending.approvalId && record?.id === pending.approvalId && record.tree === committedTree) removeRecord(files.approval)
  removeRecord(files.pending)
  return true
}

function main(argv) {
  const [command, ...args] = argv
  const cwd = process.cwd()
  if (command === 'approve') {
    const split = args.indexOf('--')
    if (split !== 2 || args[0] !== '--reason' || !args[1]) throw new Error('用法：approve --reason <批准依据> -- <精确文件路径...>')
    const record = approve(cwd, args.slice(split + 1), args[1])
    console.log(`已记录一次性审批：${record.paths.join('、')}\n暂存树：${record.tree}\n依据：${record.reason}`)
  } else if (command === 'snapshot') {
    assertWorktree(cwd)
    console.log(snapshot(cwd).fingerprint)
  } else if (command === 'check' || command === 'prepare') {
    if (args.length !== 2 || args[0] !== '--snapshot' || !/^[a-f0-9]{64}$/.test(args[1])) throw new Error('必须传入检查开始时的--snapshot指纹')
    if (command === 'check') {
      const result = check(cwd, args[1])
      console.log(result.approval ? '已批准的B类路径与本次暂存内容一致' : '本次无需要新增批准的B类路径')
    } else prepare(cwd, args[1])
  } else if (command === 'consume') consume(cwd)
  else if (command === 'status') {
    const state = snapshot(cwd)
    console.log(JSON.stringify({ required: state.required, tree: state.tree, approval: readRecord(recordPaths(state).approval) }, null, 2))
  } else if (command === 'revoke') {
    const files = recordPaths(snapshot(cwd))
    removeRecord(files.approval)
    removeRecord(files.pending)
    console.log('本工作树一次性审批已撤销')
  } else throw new Error('命令：approve / status / revoke；snapshot / check / prepare / consume由钩子调用')
}

module.exports = { snapshot, recordPaths, approve, check, prepare, consume }
if (require.main === module) {
  try { main(process.argv.slice(2)) } catch (error) { console.error(`提交审批：${error.message}`); process.exitCode = 1 }
}
