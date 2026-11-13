/**
 * **循环音频通道（BGM / 环境底噪共用的交叉淡变引擎）** —— 2026-11-02 追加批；
 * 2026-11-04 调试批：换曲淡变时长可配（BGM 2.5s / 环境底噪 1.5s），同曲调音量改走短淡变（250ms）。
 * **2026-11-13 重叠修复**（船长问「BGM 有重叠播放的问题吗」）：同通道实例上限真正落实为
 * 「一个正在淡出 + 一个当前」；切回正在淡出的同一首时**复活旧实例**而不是新建一份——
 * 快速来回切场景/反复开关战场不再叠出 3 个以上实例或同一首双份（相位错开像回声）。
 *
 * 做法：同一通道最多两个 `HTMLAudioElement`（`loop=true`）——旧曲淡出、新曲淡入（`fadeMs`），
 * 用 40ms 定时器线性推音量；同一 URL 再设置只调音量、不重启（切场景来回不打断）。
 * 不用 Web Audio：桌面打包后页面是 `file://`，`decodeAudioData` 取不到字节；`<audio>` 两端同款。
 *
 * 自动播放被拒（网页首次无手势）：`play()` 的 promise 会被吞掉，由上层 `music.ts` 挂一次性手势重试；
 * 本类不抛错（与 `player.ts` 同一纪律：音频层事故不许影响游戏）。
 */
interface Slot {
  el: HTMLAudioElement
  url: string
  level: number
  target: number
  dying: boolean
  /** 每 tick 的音量步长（换曲 = 长淡变，同曲调音量 = 短淡变） */
  step: number
}

const TICK_MS = 40

export class LoopChannel {
  private slots: Slot[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private paused = false

  constructor(
    private readonly fadeMs = 1200,
    private readonly volumeFadeMs = 250,
  ) {}

  /** 当前正在（或正在淡入）的 URL */
  get currentUrl(): string | null {
    const live = this.slots.find((s) => !s.dying)
    return live?.url ?? null
  }

  /** 切到某个 URL（null = 淡出停止），并设目标音量 0–1 */
  set(url: string | null, volume: number): void {
    try {
      this.paused = false
      const vol = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0))
      const current = this.slots.find((s) => !s.dying)
      const fadeStep = this.stepFor(this.fadeMs)
      if (url === null) {
        for (const slot of this.slots) {
          slot.dying = true
          slot.target = 0
          slot.step = fadeStep
        }
        this.ensureTimer()
        return
      }
      if (current !== undefined && current.url === url) {
        current.target = vol
        this.resetFade(current)
        this.ensureTimer()
        return
      }
      // 切回"正在淡出"的同一首：复活旧实例，不再新建第二份（否则同一首双份、相位错开像回声）
      const dyingSame = this.slots.find((s) => s.dying && s.url === url)
      // 同通道最多「一个淡出 + 一个当前」：先清掉此前就在途的淡出实例（保留要复活的这首）
      for (const slot of [...this.slots]) {
        if (slot.dying && slot !== dyingSame) this.dropSlot(slot)
      }
      // 当前曲开始淡出（保留为唯一的淡出实例）
      if (current !== undefined) {
        current.dying = true
        current.target = 0
        current.step = fadeStep
      }
      if (dyingSame !== undefined) {
        dyingSame.dying = false
        dyingSame.target = vol
        // 从当前实际音量接着淡入，避免复活瞬间音量跳变
        dyingSame.level = Math.min(1, Math.max(0, dyingSame.el.volume))
        dyingSame.step = this.stepFor(this.volumeFadeMs)
        const p = dyingSame.el.play()
        if (p !== undefined && typeof p.catch === 'function') p.catch(() => undefined)
        this.ensureTimer()
        return
      }
      const el = new Audio(url)
      el.loop = true
      el.preload = 'auto'
      el.volume = 0
      const next: Slot = { el, url, level: 0, target: vol, dying: false, step: fadeStep }
      this.slots.push(next)
      const p = el.play()
      if (p !== undefined && typeof p.catch === 'function') p.catch(() => undefined)
      this.ensureTimer()
    } catch {
      /* 忽略：音频层不打断游戏 */
    }
  }

  /** 立刻停掉并摘除一个实例（不吃淡变，用于把并发实例压回上限） */
  private dropSlot(slot: Slot): void {
    try {
      slot.el.pause()
      slot.el.src = ''
    } catch {
      /* 忽略 */
    }
    const i = this.slots.indexOf(slot)
    if (i >= 0) this.slots.splice(i, 1)
  }

  /** 只调音量（设置拖动时；不重启播放，走短淡变） */
  setVolume(volume: number): void {
    const live = this.slots.find((s) => !s.dying)
    if (live === undefined) return
    live.target = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0))
    live.step = this.stepFor(this.volumeFadeMs)
    this.ensureTimer()
  }

  /** 隐藏/最小化暂停（保留播放位置，恢复时接着放） */
  pause(): void {
    this.paused = true
    this.clearTimer()
    for (const slot of this.slots) {
      try {
        slot.el.pause()
      } catch {
        /* 忽略 */
      }
    }
  }

  /** 恢复播放（浏览器拒绝时静默；上层会挂手势重试）。淡出中的旧实例直接停掉，不跟着复活。 */
  resume(): void {
    this.paused = false
    for (const slot of [...this.slots]) {
      if (slot.dying) {
        this.dropSlot(slot)
        continue
      }
      try {
        const p = slot.el.play()
        if (p !== undefined && typeof p.catch === 'function') p.catch(() => undefined)
      } catch {
        /* 忽略 */
      }
    }
    this.ensureTimer()
  }

  /** 立即销毁（测试/卸载用） */
  destroy(): void {
    this.clearTimer()
    for (const slot of this.slots) {
      try {
        slot.el.pause()
        slot.el.src = ''
      } catch {
        /* 忽略 */
      }
    }
    this.slots = []
  }

  /** 同曲调音量：把 level 拉回当前实际音量，避免从错误起点插值；并改用短淡变步长 */
  private resetFade(slot: Slot): void {
    slot.level = Math.min(1, Math.max(0, slot.el.volume))
    slot.step = this.stepFor(this.volumeFadeMs)
  }

  /** 某个时长（毫秒）对应的每 tick 步长（至少 1 tick 完成） */
  private stepFor(ms: number): number {
    return 1 / Math.max(1, ms / TICK_MS)
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.paused) return
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    let busy = false
    for (const slot of this.slots) {
      const delta = slot.target - slot.level
      if (Math.abs(delta) <= slot.step) slot.level = slot.target
      else slot.level += Math.sign(delta) * slot.step
      try {
        slot.el.volume = Math.min(1, Math.max(0, slot.level))
      } catch {
        /* 忽略 */
      }
      // 淡出中的实例要继续 tick 到归零才能清理；淡入/稳态只看是否还在变
      if (slot.dying) busy = true
      else if (Math.abs(slot.target - slot.level) > 0.001) busy = true
    }
    // 清的清、撤的撤
    for (const slot of this.slots.filter((s) => s.dying && s.level <= 0.001)) {
      try {
        slot.el.pause()
        slot.el.src = ''
      } catch {
        /* 忽略 */
      }
    }
    this.slots = this.slots.filter((s) => !(s.dying && s.level <= 0.001))
    if (!busy) this.clearTimer()
  }
}
