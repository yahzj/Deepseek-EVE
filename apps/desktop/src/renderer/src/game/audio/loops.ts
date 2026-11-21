interface Slot {
  el: HTMLAudioElement
  url: string
  level: number
  target: number
  dying: boolean
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

  get currentUrl(): string | null {
    const live = this.slots.find((s) => !s.dying)
    return live?.url ?? null
  }

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
      const dyingSame = this.slots.find((s) => s.dying && s.url === url)
      for (const slot of [...this.slots]) {
        if (slot.dying && slot !== dyingSame) this.dropSlot(slot)
      }
      if (current !== undefined) {
        current.dying = true
        current.target = 0
        current.step = fadeStep
      }
      if (dyingSame !== undefined) {
        dyingSame.dying = false
        dyingSame.target = vol
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
    }
  }

  private dropSlot(slot: Slot): void {
    try {
      slot.el.pause()
      slot.el.src = ''
    } catch {
    }
    const i = this.slots.indexOf(slot)
    if (i >= 0) this.slots.splice(i, 1)
  }

  setVolume(volume: number): void {
    const live = this.slots.find((s) => !s.dying)
    if (live === undefined) return
    live.target = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0))
    live.step = this.stepFor(this.volumeFadeMs)
    this.ensureTimer()
  }

  pause(): void {
    this.paused = true
    this.clearTimer()
    for (const slot of this.slots) {
      try {
        slot.el.pause()
      } catch {
      }
    }
  }

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
      }
    }
    this.ensureTimer()
  }

  destroy(): void {
    this.clearTimer()
    for (const slot of this.slots) {
      try {
        slot.el.pause()
        slot.el.src = ''
      } catch {
      }
    }
    this.slots = []
  }

  private resetFade(slot: Slot): void {
    slot.level = Math.min(1, Math.max(0, slot.el.volume))
    slot.step = this.stepFor(this.volumeFadeMs)
  }

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
      }
      if (slot.dying) busy = true
      else if (Math.abs(slot.target - slot.level) > 0.001) busy = true
    }
    for (const slot of this.slots.filter((s) => s.dying && s.level <= 0.001)) {
      try {
        slot.el.pause()
        slot.el.src = ''
      } catch {
      }
    }
    this.slots = this.slots.filter((s) => !(s.dying && s.level <= 0.001))
    if (!busy) this.clearTimer()
  }
}
