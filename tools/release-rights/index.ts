/** 网页与桌面渲染包共用的版权声明构建插件；用途与核查方法见同目录 README.md。 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const RIGHTS_BANNER = '/*! 大鲸鱼-深空放置 | 作者 ya (yahzj) | 授权见 LICENSE.txt；第三方许可见 THIRD-PARTY-NOTICES.txt。 */'
const RUNTIME_PACKAGES = ['react', 'react-dom', 'scheduler', 'lucide-react', '@carbon/icons-react'] as const

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

/** 从当前目标实际安装的依赖取许可证；不要求 web 独立构建安装桌面依赖。 */
export function releaseRightsAssets(dependencyRoot: string): Record<string, string> {
  const license = readFileSync(join(ROOT, 'LICENSE.txt'), 'utf8')
  const require = createRequire(join(resolve(dependencyRoot), 'package.json'))
  const notices = RUNTIME_PACKAGES.map((name) => {
    const packageDir = dirname(require.resolve(`${name}/package.json`))
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string }
    return `===== ${name} ${pkg.version} =====\n\n${readFileSync(join(packageDir, 'LICENSE'), 'utf8')}`
  })
  const pixelLicense = readFileSync(join(ROOT, 'apps/desktop/src/renderer/src/assets/stellar/LICENSE-PixelPlanets.txt'), 'utf8')
  /**
   * **内嵌字体许可**（2026-11-02 船长令嵌入可选界面字体；2026-11-12 复古档由 GNU Unifont 换成
   * Fusion Pixel 12px Mono zh-Hans）：
   * 两枚字体文件随渲染包分发（`assets/fonts/fusion-pixel-12px-mono-zh-hans.otf` /
   * `oxanium-variable.ttf`）⇒ 第三方许可清单必须收录其授权原文。
   * - Fusion Pixel：SIL Open Font License 1.1（版权 2022 TakWolf），
   *   来源 <https://github.com/TakWolf/fusion-pixel-font>（LICENSE-OFL）；
   * - Oxanium：SIL Open Font License 1.1（版权 2019 The Oxanium Project Authors），
   *   来源 <https://fonts.google.com/specimen/Oxanium> / <https://github.com/sevmeyer/oxanium>。
   * 设置面板最下方「许可与授权」弹窗展示的是同一批文本（`assets/licenses/*.txt`）。
   */
  const fusionPixelLicense = readFileSync(
    join(ROOT, 'apps/desktop/src/renderer/src/assets/licenses/fusion-pixel-12px-mono-zh-hans-LICENSE.txt'),
    'utf8',
  )
  const oxaniumLicense = readFileSync(
    join(ROOT, 'apps/desktop/src/renderer/src/assets/licenses/oxanium-LICENSE.txt'),
    'utf8',
  )
  const thirdParty = [
    '第三方许可声明\n\n本文件覆盖当前渲染包的 React、React DOM、Scheduler、Lucide、Carbon 图标、PixelPlanets 素材、Fusion Pixel 字体与 Oxanium 字体的许可。\n桌面运行时另带的 Electron/Chromium 许可文件仍须保留；本声明不替代这些文件。',
    ...notices,
    `===== PixelPlanets / Deep-Fold =====\n\n${pixelLicense}`,
    `===== Fusion Pixel 12px Mono zh-Hans / TakWolf =====\n\nCopyright (c) 2022, TakWolf (https://takwolf.com)\n字体放在 SIL Open Font License 1.1 下分发。授权原文如下（取自 https://github.com/TakWolf/fusion-pixel-font/blob/master/LICENSE-OFL）：\n\n${fusionPixelLicense}`,
    `===== Oxanium / The Oxanium Project Authors =====\n\n${oxaniumLicense}`,
  ].join('\n\n') + '\n'
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
  <title>版权与授权 | 大鲸鱼-深空放置</title>
  <style>body{font-family:system-ui,sans-serif;line-height:1.7;margin:32px auto;padding:0 20px;max-width:72ch;color:#202124;background:#fff}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}a{color:#075b9b}</style>
</head>
<body><main>
  <h1>版权与授权</h1>
  <pre>${escapeHtml(license)}</pre>
  <p><a href="./LICENSE.txt">授权声明原文</a> · <a href="./THIRD-PARTY-NOTICES.txt">第三方许可</a></p>
</main></body>
</html>
`
  return { 'LICENSE.txt': license, 'THIRD-PARTY-NOTICES.txt': thirdParty, 'copyright.html': html }
}

/** Worker 单独打包，只加版权头，不重复输出独立页面和许可文件。 */
export function releaseRightsBannerPlugin() {
  return {
    name: 'whale-release-rights-banner',
    apply: 'build' as const,
    enforce: 'post' as const,
    renderChunk(code: string) {
      return { code: `${RIGHTS_BANNER}\n${code}`, map: null }
    },
  }
}

export function releaseRightsPlugin(dependencyRoot: string) {
  return {
    ...releaseRightsBannerPlugin(),
    name: 'whale-release-rights',
    config() {
      return { build: { sourcemap: false }, esbuild: { legalComments: 'inline' as const } }
    },
    transformIndexHtml() {
      return [
        { tag: 'meta', attrs: { name: 'copyright', content: '大鲸鱼-深空放置 · 作者 ya（yahzj）；授权见 LICENSE.txt' }, injectTo: 'head' as const },
        { tag: 'link', attrs: { rel: 'license', href: './copyright.html' }, injectTo: 'head' as const },
      ]
    },
    generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: string }) => unknown }) {
      for (const [fileName, source] of Object.entries(releaseRightsAssets(dependencyRoot))) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}
