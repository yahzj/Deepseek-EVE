/**
 * 网页版（GitHub Pages）构建：入口复用桌面 renderer 全部源码（App/GameEngine/样式），
 * @whale/* 源码直连（与桌面 electron-vite 同 alias）；持久化在浏览器无 window.whale 时
 * 自动降级 localStorage（renderer/game/storage.ts）。
 * base './'：产物可部署在仓库子路径（<user>.github.io/<repo>/）。
 *
 * **两套布局两套样式**（2026-09-25 船长令：「默认旧档采用旧界面」＋「旧版 = main 上当前使用的界面」）：
 * 外壳有两份（`ui/AppShell.tsx` 的 modern / classic），样式也拆成两份（`styles/styles-*.css`），
 * 两份类名高度重叠，同时加载必然互相串味 ⇒ 由 `ui/layoutStyles.ts` 按布局**只加载一份**，
 * 两份都走 `?url` 各自打成独立 CSS 文件（PostCSS 照跑），本配置无需额外插件。
 */
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const alias = {
  '@whale/core': resolve('../packages/core/src/index.ts'),
  '@whale/data': resolve('../packages/data/src/index.ts'),
  '@whale/ui': resolve('../packages/ui/src/index.tsx'),
  // 两套布局的样式（**生成件**，见 tools/_ui-artifacts/scripts/_split-layout-css.mjs；
  // 放源码树之外是为了不被源码体检扫到）。桌面端 electron.vite.config.ts 有同名别名，两处要一起改。
  '@layout-css': resolve('../tools/_ui-artifacts/layout-css'),
}

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
})
