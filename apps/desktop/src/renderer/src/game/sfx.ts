/**
 * **声效接口（占位骨架）** —— **船长 2026-09-25 令**：「**这里预留一个声效的接口，用于之后接入警报声。**」
 *
 * 本批**不放任何音频资源、不做音量设置**，只做两件事：
 * 1. 把**调用点接好**（入侵警报 / 入侵结束庆祝两处，见 `App.tsx` 的警报与烟火）；
 * 2. 留一个**可注册播放器**的骨架：将来的音频模块在启动时 `registerSfxPlayer(fn)`，
 *    两处演出就自动出声，**调用点零改动**。
 *
 * 三条约定：
 * - `playSfx` **绝不抛错**：没注册播放器 = 静默；播放器自己抛错也在这里吞掉
 *   —— 演出不能因为音频层出事而中断（与"通讯/弹窗让位"那类纪律同源：演出排在游戏逻辑之后）；
 * - `kind` 是**语义 id**，不是文件名（音频模块自己映射到资源）：
 *   `'invasion-alarm'` = 入侵警报（开局与旗舰现身各一次）· `'invasion-end'` = 入侵结束庆祝；
 * - **接口层不做节流**：同一 `kind` 可能被连续调用（调试模式反复开局 / 快进）⇒ 要不要防抖由播放器决定。
 */
export type SfxKind = 'invasion-alarm' | 'invasion-end'

/** 播放器签名（音频模块实现它并注册；`kind` 见上） */
export type SfxPlayer = (kind: SfxKind) => void

let player: SfxPlayer | null = null

/** **注册播放器**（传 `null` = 注销，回到静默）。音频模块接进来时在这一处挂上即可 */
export function registerSfxPlayer(fn: SfxPlayer | null): void {
  player = fn
}

/** 当前是否已接入播放器（界面/调试面板可读；本批恒 `false`） */
export function sfxReady(): boolean {
  return player !== null
}

/** 播一个语义声效（未接播放器时静默；实现见文件头注） */
export function playSfx(kind: SfxKind): void {
  if (player === null) return
  try {
    player(kind)
  } catch {
    /* 音频层的事故不许影响演出与游戏 */
  }
}
