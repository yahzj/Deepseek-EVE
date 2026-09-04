/**
 * 网页版（GitHub Pages）构建：入口复用桌面 renderer 全部源码（App/GameEngine/样式），
 * @whale/* 源码直连（与桌面 electron-vite 同 alias）；持久化在浏览器无 window.whale 时
 * 自动降级 localStorage（renderer/game/storage.ts）。
 * base './'：产物可部署在仓库子路径（<user>.github.io/<repo>/）。
 */
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

const alias = {
  '@whale/core': resolve('../packages/core/src/index.ts'),
  '@whale/data': resolve('../packages/data/src/index.ts'),
  '@whale/ui': resolve('../packages/ui/src/index.tsx'),
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
