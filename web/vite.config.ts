/**
 * 网页版（GitHub Pages）构建：入口复用桌面 renderer 全部源码（App/GameEngine/样式），
 * @whale/* 源码直连（与桌面 electron-vite 同 alias）；持久化在浏览器无 window.whale 时
 * 自动降级 localStorage（renderer/game/storage.ts）。
 * base './'：产物可部署在仓库子路径（<user>.github.io/<repo>/）。
 *
 * **两套布局两套样式**（2026-09-25 船长令：「默认旧档采用旧界面」＋「旧版 = main 上当前使用的界面」）：
 * 外壳有两份（`ui/AppShell.tsx` 的 modern / classic），样式也拆成两份
 * （`apps/desktop/src/renderer/src/ui/layout-css/styles-*.css`，入库的生成件，
 * 由 `tools/layout-css-split.ts` 生成）—— 两份类名高度重叠，同时加载必然互相串味
 * ⇒ 由 `ui/layoutStyles.ts` 按布局**只加载一份**（`?url` 各自打成独立 CSS，PostCSS 照跑）。
 */
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
/** 客户端版本三件套（版本号 / 构建 sha / 构建时刻）——与桌面构建**共用同一份**（见该文件头注） */
import { buildInfoDefine } from '../tools/build-info'

const alias = {
  '@whale/core': resolve('../packages/core/src/index.ts'),
  '@whale/data': resolve('../packages/data/src/index.ts'),
  '@whale/ui': resolve('../packages/ui/src/index.tsx'),
}

export default defineConfig({
  base: './',
  plugins: [react()],
  // 共享源码位于 web 外，第三方渲染依赖统一从 web 根解析，不借用桌面工作区安装。
  resolve: { alias, dedupe: ['react', 'react-dom', 'lucide-react'] },
  /** **2026-10-02 船长令**（「否则无法判断玩家当前版本」）：构建时把版本注入界面（设置页最上方那一行） */
  define: buildInfoDefine(),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
})
