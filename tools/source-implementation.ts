/** 源码契约读取兼容出口背后的实现；只跟随具名转导出，不扩展到普通依赖。 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

export function readImplementation(file: string, seen = new Set<string>()): string {
  const absolute = resolve(file)
  if (seen.has(absolute)) return ''
  seen.add(absolute)
  const text = readFileSync(absolute, 'utf8')
  const ast = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, true)
  const onlyFacade = ast.statements.length > 0 && ast.statements.every(n => ts.isExportDeclaration(n))
  if (!onlyFacade) return text
  return ast.statements.map(node => {
    const n = node as ts.ExportDeclaration
    if (!n.moduleSpecifier || !ts.isStringLiteral(n.moduleSpecifier) || !n.moduleSpecifier.text.startsWith('.')) return ''
    const base = resolve(dirname(absolute), n.moduleSpecifier.text)
    const target = [base + '.ts', base + '.tsx'].find(existsSync)
    return target ? readImplementation(target, seen) : ''
  }).join('\n')
}
