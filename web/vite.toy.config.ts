/** 本地参赛包：普通脚本、内嵌 Worker 与字体，保留全部玩法和声音资源。 */
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { buildInfoDefine } from '../tools/build-info'
import { releaseRightsBannerPlugin, releaseRightsPlugin } from '../tools/release-rights'
import { toyLocalPlugin } from '../tools/toy-build/plugin'

const webRoot = dirname(fileURLToPath(import.meta.url))
const root = resolve(webRoot, '..')

export default defineConfig({
  root: webRoot,
  base: './',
  mode: 'toy',
  plugins: [react(), toyLocalPlugin(), releaseRightsPlugin(webRoot)],
  resolve: {
    alias: {
      '@whale/core': resolve(root, 'packages/core/src/index.ts'),
      '@whale/data': resolve(root, 'packages/data/src/index.ts'),
      '@whale/ui': resolve(root, 'packages/ui/src/index.tsx'),
    },
    dedupe: ['@carbon/icons-react', 'klinecharts', 'lucide-react', 'react', 'react-dom'],
  },
  define: { ...buildInfoDefine(), 'import.meta.env.WHALE_TOY_BUILD': JSON.stringify('1') },
  worker: { format: 'iife', plugins: () => [releaseRightsBannerPlugin()] },
  build: {
    outDir: resolve(root, 'dist/toy'),
    emptyOutDir: true,
    target: 'es2020',
    modulePreload: false,
    // file:// 字体请求受浏览器跨域限制；图片与音频继续使用相邻文件，避免 Base64 膨胀。
    assetsInlineLimit: (filePath) => /\.(?:otf|ttf)$/i.test(filePath),
    rollupOptions: {
      output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'assets/game.js' },
    },
  },
})
