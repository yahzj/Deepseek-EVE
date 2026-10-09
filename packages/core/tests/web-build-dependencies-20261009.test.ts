import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ROOT } from './helpers/save-shell'

const json = (path: string) => JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'))

function runtimePackages(dir: string, packages = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      runtimePackages(path, packages)
      continue
    }
    if (!/\.tsx?$/.test(path)) continue
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    const add = (value: string): void => {
      if (value.startsWith('.') || value.startsWith('@whale/') || value.startsWith('node:')) return
      packages.add(value.startsWith('@') ? value.split('/').slice(0, 2).join('/') : value.split('/')[0]!)
    }
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause
        const bindings = clause?.namedBindings
        const onlyTypes = !clause?.name && bindings && ts.isNamedImports(bindings)
          && bindings.elements.length > 0 && bindings.elements.every(binding => binding.isTypeOnly)
        if (!onlyTypes) add(node.moduleSpecifier.text)
      } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        add(node.moduleSpecifier.text)
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        add(node.arguments[0].text)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return packages
}

describe('独立网页工程构建依赖', () => {
  it('共享 renderer 与源码包的第三方运行时导入均在 web 显式声明', () => {
    const packages = runtimePackages(resolve(ROOT, 'apps/desktop/src/renderer/src'))
    for (const name of ['core', 'data', 'ui']) runtimePackages(resolve(ROOT, `packages/${name}/src`), packages)
    const dependencies = json('web/package.json').dependencies
    expect([...packages].filter(name => !dependencies[name]).sort()).toEqual([])
    expect(dependencies.electron).toBeUndefined()
  })

  it('网页声明与独立锁文件一致，图标库沿用桌面版本且可由 npm ci 安装', () => {
    const web = json('web/package.json'), lock = json('web/package-lock.json')
    expect(lock.packages[''].dependencies).toEqual(web.dependencies)
    expect(web.dependencies['lucide-react']).toBe(json('apps/desktop/package.json').devDependencies['lucide-react'])
    for (const name of Object.keys(web.dependencies)) expect(lock.packages[`node_modules/${name}`]?.version).toBeTruthy()
  })

  it('真实 Vite 配置将工程外源码的渲染依赖统一解析到 web 根目录', () => {
    const source = readFileSync(resolve(ROOT, 'web/vite.config.ts'), 'utf8')
    const scope = {
      exports: {} as { default: { resolve: { dedupe: string[] }; build: { rollupOptions?: { external?: unknown } } } },
      require: (id: string) => {
        if (id === 'vite') return { defineConfig: (config: unknown) => config }
        if (id === '@vitejs/plugin-react') return { default: () => ({ name: 'react' }) }
        if (id === 'node:path') return { resolve }
        if (id === '../tools/build-info') return { buildInfoDefine: () => ({}) }
        throw new Error(`未声明的配置依赖：${id}`)
      },
    }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope)
    const config = scope.exports.default
    expect([...config.resolve.dedupe].sort()).toEqual(Object.keys(json('web/package.json').dependencies).sort())
    expect(config.build.rollupOptions?.external).toBeUndefined()
  })
})
