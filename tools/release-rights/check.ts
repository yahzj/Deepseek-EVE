/** 只读检查生产产物，不构建、不联网、不读取游戏存档；用法见同目录 README.md。 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RIGHTS_BANNER, releaseRightsAssets } from './index'

function filesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? filesIn(path) : entry.isFile() ? [path] : []
  })
}

export function auditReleaseRights(outDir: string, dependencyRoot: string, scanRoot = outDir): string[] {
  const errors: string[] = []
  if (!existsSync(outDir) || !existsSync(scanRoot)) return [`缺少产物：${outDir}；请先构建。`]
  for (const [fileName, expected] of Object.entries(releaseRightsAssets(dependencyRoot))) {
    const path = join(outDir, fileName)
    if (!existsSync(path) || readFileSync(path, 'utf8') !== expected) errors.push(`缺失或过期的声明：${fileName}`)
  }
  const htmlPath = join(outDir, 'index.html')
  const html = existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : ''
  if (!/<link\b[^>]*rel="license"[^>]*href="\.\/copyright\.html"/.test(html)) errors.push('index.html 缺少版权页链接。')
  const rendererJs = filesIn(outDir).filter((path) => path.endsWith('.js'))
  if (rendererJs.length === 0) errors.push('没有渲染包 JavaScript，不能视为有效游戏产物。')
  for (const path of rendererJs) {
    if (!readFileSync(path, 'utf8').includes(RIGHTS_BANNER)) errors.push(`缺少版权头：${relative(outDir, path)}`)
  }
  for (const path of filesIn(scanRoot)) {
    if (/\.map$/i.test(path)) errors.push(`产物包含源码映射：${relative(scanRoot, path)}`)
    if (/\.(?:js|css)$/i.test(path) && /(?:\/\/[@#]|\/\*[@#])\s*sourceMappingURL\s*=/.test(readFileSync(path, 'utf8'))) {
      errors.push(`产物包含源码映射链接：${relative(scanRoot, path)}`)
    }
  }
  return errors
}

function main(): void {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
  const targets = {
    web: { output: join(root, 'web/dist'), dependencies: join(root, 'web'), scan: join(root, 'web/dist') },
    desktop: { output: join(root, 'apps/desktop/out/renderer'), dependencies: join(root, 'apps/desktop'), scan: join(root, 'apps/desktop/out') },
  }
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--web' && arg !== '--desktop')) throw new Error('用法：npm run release:rights:check -- [--web | --desktop]；无参数检查两端。')
  for (const [name, target] of Object.entries(targets)) {
    if (args.length > 0 && !args.includes(`--${name}`)) continue
    const errors = auditReleaseRights(target.output, target.dependencies, target.scan)
    for (const error of errors) console.error(`${name}: ${error}`)
    if (errors.length > 0) process.exitCode = 1
    else console.log(`${name}: 版权声明、第三方许可、入口链接、全部渲染 JS 版权头及无源码映射检查通过。`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
