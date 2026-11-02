/**
 * **声效接口（语义层）** —— 2026-09-25 船长令预留接口，**2026-11-02 接入真实播放器**。
 *
 * 职责边界：
 * - 本文件只做"语义 id → 播放器"的分发，**不读素材、不管音量**；
 * - 真正的播放层在 `game/audio/`（`installAudio()` 启动时把播放器注册到这里）；
 * - 语义 id 的**唯一登记处**是 `game/audio/cues.ts` 的 `SFX_CUES`（本文件只引用联合类型）。
 *
 * 三条约定（2026-09-25 立，接入后仍成立）：
 * - `playSfx` **绝不抛错**：没注册播放器 = 静默；播放器自己抛错也在这里吞掉
 *   —— 演出不能因为音频层出事而中断（与"通讯/弹窗让位"那类纪律同源：演出排在游戏逻辑之后）；
 * - `kind` 是**语义 id**，不是文件名（播放层自己映射到资源/本机覆盖）；
 * - **接口层不做节流**：同一 `kind` 可能被连续调用（调试模式反复开局 / 快进）⇒ 防抖与并发由播放层按清单处理。
 */
import type { SfxCueId } from './audio/cues'

/** 语义声效 id（清单见 `game/audio/cues.ts`；游戏侧调用点只用这里） */
export type SfxKind = SfxCueId

/** 播放器签名（`game/audio/index.ts` 在启动时注册；`kind` 见上） */
export type SfxPlayer = (kind: SfxKind) => void

let player: SfxPlayer | null = null

/** **注册播放器**（传 `null` = 注销，回到静默）。声音系统启动时在这一处挂上 */
export function registerSfxPlayer(fn: SfxPlayer | null): void {
  player = fn
}

/** 当前是否已接入播放器（界面/调试面板可读） */
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
