/** 保存外壳测试：运行真实 TypeScript 模块，只有文件系统、桥与 Electron 外部依赖被替换。 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

export const ROOT = resolve(__dirname, '../../../..')
const nativeRequire = createRequire(resolve(ROOT, 'package.json'))

export function runSaveModule<T>(relative: string, mocks: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const modules = new Map<string, { exports: unknown }>()
  function load(file: string): unknown {
    const cached = modules.get(file)
    if (cached) return cached.exports
    const module = { exports: {} }
    modules.set(file, module)
    let source = readFileSync(file, 'utf8')
    if (relative === 'apps/desktop/src/main/index.ts' && file === resolve(ROOT, relative)) {
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const windowFn = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'createWindow')
      if (!windowFn) throw new Error('主进程注册入口不存在')
      source = source.slice(0, windowFn.getFullStart()) + '\nregisterSaveHandlers()'
    }
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    runInNewContext(js, {
      exports: module.exports, module, console, Buffer, ...globals,
      require: (id: string) => {
        if (id in mocks) return mocks[id]
        if (id.startsWith('.')) return load(resolve(dirname(file), id + '.ts'))
        return nativeRequire(id)
      },
    }, { timeout: 2000 })
    return module.exports
  }
  return load(resolve(ROOT, relative)) as T
}

export function gameSaveMethods(names: string[], bindings: Record<string, unknown>): Record<string, unknown> {
  const file = resolve(ROOT, 'apps/desktop/src/renderer/src/game/engine.ts')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const methods = new Map<string, string>()
  function visit(node: ts.Node): void {
    if (ts.isMethodDeclaration(node)) methods.set(node.name.getText(source), node.getText(source))
    ts.forEachChild(node, visit)
  }
  visit(source)
  // 兼容修复前入口，确保红测试测到行为，而不是缺少新方法。
  const text = names.filter((name) => methods.has(name)).map((name) => methods.get(name)).join('\n')
  const js = ts.transpileModule(`class Probe { ${text} }\nglobalThis.probe = new Probe()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const context = { ...bindings, console, probe: undefined }
  runInNewContext(js, context, { timeout: 2000 })
  return context.probe as unknown as Record<string, unknown>
}

export function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}

export async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}
