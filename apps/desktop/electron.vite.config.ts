/**
 * Electron + Vite 构建配置。
 *
 * 要点（中文说明）：
 * - main/preload：主进程与安全桥，按标准打包；
 * - renderer：界面进程。内部三个包（core/data/ui）通过别名"源码直连"，
 *   这样开发时改任何一个包的源码，界面都能热更新，无需先编译。
 */
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const alias = {
  '@whale/core': resolve('../../packages/core/src/index.ts'),
  '@whale/data': resolve('../../packages/data/src/index.ts'),
  '@whale/ui': resolve('../../packages/ui/src/index.tsx'),
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    resolve: { alias },
    plugins: [react()],
  },
})
