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
import { applyFontScale } from '../ui/uiScale'
import { applyFontChoice, readFontChoice } from '../ui/fontChoice'
import { installAudio, attachAudioEngine } from './audio'
import { probeSaveStorage } from './saveGuard'
import type { GameEngine } from './engine'
import { acquireSaveWriter } from './saveWriter'

/**
 * **首帧渲染之前**必须跑完的动作（两入口共用）：
 * - 两套布局两套样式：只加载玩家选的那一份（两份类名高度重叠，同时生效会互相串味）；
 * - 宇宙背景：启动时抽一张无缝贴图写入 `--space-bg`，免得先闪一下纯色底；
 * - 界面配色：把 `data-theme` 写上，免得先闪一下另一套配色。
 * - **界面字号**（2026-11-02 船长报障修复）：`--ui-fs` 是字阶 `--wui-fs-*` 的系数、必须落在 `<html>`，
 *   只在设置面板里应用会出现「重启后打回原样」⇒ 启动即应用（面板拖动时再写一次）。
 * - **界面字体**（2026-11-02 船长令最终口径）：默认 = 微软雅黑 + Oxanium（英文/数字）；
 *   复古 = 统一 GNU Unifont。选择写 `<html>` 的 `data-ui-font` + `--ui-font`，
 *   本机偏好 ⇒ 启动即应用，免得重启后打回默认。
 */
export function prebootRenderer(): void {
  installLayoutStyles()
  applySpaceBg()
  bootstrapTheme()
  applyFontScale()
  applyFontChoice(readFontChoice())
  /** 声音系统（2026-11-02）：首帧前注册播放器、挂手势解锁、装载本机音效覆盖（异步，不拦启动） */
  installAudio()
}

/**
 * **启动引擎**（两入口共用）：先做**存档存储体检**，再 `engine.start()`。
 *
 * 体检必须在 start 之前跑完：引擎要据此判断"读档失败"是"旧档坏了"还是"这台机器压根写不了存储"
 * （后者不挂起写入、也不劝玩家去点"允许写入"）。体检本身不碰真档
 * （网页版写-读-删一个探针键；桌面端只读）。体检自己出错按"量不到"处理，绝不拦住启动。
 */
export async function startGameEngine(engine: GameEngine): Promise<boolean> {
  if (await acquireSaveWriter() !== 'writer') return false
  try {
    await probeSaveStorage()
  } catch {
    /* 体检失败不拦启动：引擎在读档时自会兜底 */
  }
  await engine.start()
  /** 日志桥 / 生产进度桥（2026-11-02）：只读引擎状态，启动后挂一次 */
  attachAudioEngine(engine)
  return true
}
