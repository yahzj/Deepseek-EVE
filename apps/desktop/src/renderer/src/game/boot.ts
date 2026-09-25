/**
 * **两个入口共用的启动动作**（2026-09-25 立）。
 *
 * 起因（真事）：本仓有**两个入口**——桌面 `apps/desktop/src/renderer/src/main.tsx` 与
 * 网页版 `web/src/main.tsx`（后者只 import 前者的 App/引擎，启动序列自己写一份）。
 * 2026-09-25 修「MacBook · Safari 关掉游戏后存档丢失」时，存档存储体检（`probeSaveStorage`）
 * 只加在了桌面入口 ⇒ **网页版（正是 Safari 玩家走的那条路）等于没体检**，设置里显示"没量到"。
 * 那个入口文件里本来就写着「网页版有自己的入口：桌面入口改了这里也必须改」——已经漏过一次。
 * ⇒ 把「首帧前的固定动作」和「引擎启动（含体检）」收成这里各一个函数，两个入口都只调它们，
 *   以后新增启动动作只改本文件，不存在"改了一边忘了另一边"。
 */
import { installLayoutStyles } from '../ui/layoutStyles'
import { applySpaceBg } from '../ui/spaceBg'
import { bootstrapTheme } from '../ui/theme'
import { probeSaveStorage } from './saveGuard'
import type { GameEngine } from './engine'

/**
 * **首帧渲染之前**必须跑完的动作（两入口共用）：
 * - 两套布局两套样式：只加载玩家选的那一份（两份类名高度重叠，同时生效会互相串味）；
 * - 宇宙背景：启动时抽一张无缝贴图写入 `--space-bg`，免得先闪一下纯色底；
 * - 界面配色：把 `data-theme` 写上，免得先闪一下另一套配色。
 */
export function prebootRenderer(): void {
  installLayoutStyles()
  applySpaceBg()
  bootstrapTheme()
}

/**
 * **启动引擎**（两入口共用）：先做**存档存储体检**，再 `engine.start()`。
 *
 * 体检必须在 start 之前跑完：引擎要据此判断"读档失败"是"旧档坏了"还是"这台机器压根写不了存储"
 * （后者不挂起写入、也不劝玩家去点"允许写入"）。体检本身不碰真档
 * （网页版写-读-删一个探针键；桌面端只读）。体检自己出错按"量不到"处理，绝不拦住启动。
 */
export async function startGameEngine(engine: GameEngine): Promise<void> {
  try {
    await probeSaveStorage()
  } catch {
    /* 体检失败不拦启动：引擎在读档时自会兜底 */
  }
  await engine.start()
}
