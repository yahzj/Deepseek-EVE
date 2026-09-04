/**
 * 网页版（GitHub Pages）构建：把桌面 renderer（React + core/data/ui 源码直连）打包为纯静态站。
 * 持久化由 renderer/game/storage.ts 自动降级 localStorage（浏览器无 window.whale）；
 * base './' 使产物可部署在仓库子路径下。
 */
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const alias = {
  '@whale/core': resolve('../../packages/core/src/index.ts'),
  '@whale/data': resolve('../../packages/data/src/index.ts'),
  '@whale/ui': resolve('../../packages/ui/src/index.tsx'),
}

export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  plugins: [react()],
  resolve: { alias },
  build: {
    outDir: resolve('dist-web'),
    emptyOutDir: true,
    target: 'es2020',
    assetsInlineLimit: 0,
  },
})
