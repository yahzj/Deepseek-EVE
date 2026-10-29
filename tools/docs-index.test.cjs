/** 文档工具隔离回归：node --test tools/docs-index.test.cjs，不读取仓库归档正文。 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join, resolve, sep } = require('node:path')

const root = resolve(__dirname, '..')
const typescript = require.resolve('typescript')

function fixture(run) {
  const cwd = fs.mkdtempSync(join(tmpdir(), 'whale-docs-test-'))
  const write = (path, text) => {
    const target = join(cwd, path)
    fs.mkdirSync(require('node:path').dirname(target), { recursive: true })
    fs.writeFileSync(target, text)
  }
  try {
    write('AGENTS.md', '# Current Rules\n')
    write('docs/catalog.md', '# Current Catalog\nroadmap.md\n')
    write('docs/roadmap.md', '# Current Roadmap\n')
    write('docs/design/current.md', '# Current Design\n> 状态：待船长确认\n')
    write('docs/archive/old.md', '# FORBIDDEN_ARCHIVE\n')
    write('docs/design/archive/old.md', '# FORBIDDEN_DESIGN_ARCHIVE\n')
    write('packages/private.ts', 'SOURCE_MUST_NOT_BE_SCANNED')
    run(cwd, write)
  } finally {
    const target = resolve(cwd)
    if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('whale-docs-test-')) {
      throw new Error('测试清理路径越界')
    }
    fs.rmSync(target, { recursive: true, force: true })
  }
}

function execute(cwd, file, args = []) {
  // 只要工具触碰archive路径或源码语料目录就抛错，避免仅靠输出缺失判断“未读取”。
  const bootstrap = `
    const fs = require('node:fs');
    const path = require('node:path');
    const ts = require(${JSON.stringify(typescript)});
    const Module = require('node:module');
    let forbiddenRead = false;
    process.on('exit', () => { if (forbiddenRead) process.exitCode = 91; });
    for (const method of ['readFileSync', 'readdirSync', 'statSync']) {
      const original = fs[method];
      fs[method] = function(target, ...args) {
        const rel = path.relative(process.cwd(), String(target)).split(path.sep).join('/');
        if (rel.split('/').includes('archive') || ['packages', 'apps', 'web'].includes(rel.split('/')[0])) {
          forbiddenRead = true;
          throw new Error('Forbidden history/source access: ' + rel);
        }
        return original.call(this, target, ...args);
      };
    }
    const filename = ${JSON.stringify(join(root, file))};
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    process.argv = [process.execPath, filename, ...${JSON.stringify(args)}];
    mod._compile(output, filename);
  `
  return spawnSync(process.execPath, ['-e', bootstrap], { cwd, encoding: 'utf8', windowsHide: true })
}

test('索引在读取前跳过两类归档，不扫描全仓源码，生成可重复并检查过期', () => {
  fixture((cwd, write) => {
    const generated = execute(cwd, 'tools/docs-index.ts')
    assert.equal(generated.status, 0, generated.stderr)
    const index = fs.readFileSync(join(cwd, 'docs/INDEX.md'), 'utf8')
    assert.match(index, /Current Design/)
    assert.match(index, /Current Catalog/)
    assert.doesNotMatch(index, /FORBIDDEN_|docs\/archive\/old|docs\/design\/archive\/old/)
    assert.equal(execute(cwd, 'tools/docs-index.ts', ['--check']).status, 0)
    assert.equal(execute(cwd, 'tools/docs-index.ts').status, 0)
    assert.equal(fs.readFileSync(join(cwd, 'docs/INDEX.md'), 'utf8'), index)
    write('docs/new.md', '# New Current Document\n')
    const outdated = execute(cwd, 'tools/docs-index.ts', ['--check'])
    assert.equal(outdated.status, 1)
    assert.match(outdated.stderr, /已过期/)
    assert.equal(fs.readFileSync(join(cwd, 'docs/INDEX.md'), 'utf8'), index)
  })
})

test('stats不写索引；旧封存命令失败退出且不改roadmap', () => {
  fixture((cwd) => {
    assert.equal(execute(cwd, 'tools/docs-index.ts', ['--stats']).status, 0)
    assert.equal(fs.existsSync(join(cwd, 'docs/INDEX.md')), false)
    const before = fs.readFileSync(join(cwd, 'docs/roadmap.md'))
    const retired = execute(cwd, 'tools/docs-seal.ts', ['--dry-run'])
    assert.equal(retired.status, 1)
    assert.match(retired.stderr, /已退役/)
    assert.deepEqual(fs.readFileSync(join(cwd, 'docs/roadmap.md')), before)
  })
})
