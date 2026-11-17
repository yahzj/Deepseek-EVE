
import { tr } from '../i18n/locale'
import { debugEnabled } from './debugFlag'
import type { BountyWinDiagnostic } from './bountyWinProtocol'
export type PerfBucket = 'idle' | 'battle'

interface CountBox {
  n: number
  sumMs: number
  maxMs: number
}

export interface PerfSegment {
  name: string
  wallMs: number
  ticks: { idle: number; battle: number }
  adv: { idle: CountBox; battle: CountBox }
  notify: { idle: CountBox; battle: CountBox }
  commit: CountBox
  winPreheat: { dispatch: CountBox; compute: CountBox; cancelled: number; errors: number }
  long: CountBox
  fps: { samples: number; avg: number; min: number }
  heapAvgMB: number
}

interface TimePoint {
  at: number
  seg: string
  bucket: PerfBucket
  advMs: number
  notifyMs: number
  commitMs: number
}

class PerfHub {
  recording = false

  private startWall = 0
  private sceneWall = 0
  private segName = ''
  private seg: PerfSegment | null = null
  private totals = this.freshSeg(tr("ui.perf.001"), 0)
  private segments: PerfSegment[] = []
  private timeline: TimePoint[] = []
  private frames = 0
  private fpsLast = 0
  private longObserver: PerformanceObserver | null = null
  private heapSamples: number[] = []
  private lastAdvMs = 0

  private freshSeg(name: string, wallMs: number): PerfSegment {
    return {
      name,
      wallMs,
      ticks: { idle: 0, battle: 0 },
      adv: { idle: { n: 0, sumMs: 0, maxMs: 0 }, battle: { n: 0, sumMs: 0, maxMs: 0 } },
      notify: { idle: { n: 0, sumMs: 0, maxMs: 0 }, battle: { n: 0, sumMs: 0, maxMs: 0 } },
      commit: { n: 0, sumMs: 0, maxMs: 0 },
      winPreheat: { dispatch: { n: 0, sumMs: 0, maxMs: 0 }, compute: { n: 0, sumMs: 0, maxMs: 0 }, cancelled: 0, errors: 0 },
      long: { n: 0, sumMs: 0, maxMs: 0 },
      fps: { samples: 0, avg: 0, min: Infinity },
      heapAvgMB: 0,
    }
  }

  private addBox(box: CountBox, ms: number): void {
    box.n += 1
    box.sumMs += ms
    if (ms > box.maxMs) box.maxMs = ms
  }

  activate(): boolean {
    if (this.recording) return true
    if (typeof performance === 'undefined' || typeof window === 'undefined') return false
    try {
      this.startWall = performance.now()
      this.segName = '(开场)'
      this.seg = this.freshSeg(this.segName, 0)
      this.recording = true
      this.fpsLast = performance.now()
      const fpsLoop = (): void => {
        if (!this.recording) return
        this.frames += 1
        requestAnimationFrame(fpsLoop)
      }
      requestAnimationFrame(fpsLoop)
      window.setInterval(() => {
        if (!this.recording) return
        const now = performance.now()
        const dt = Math.max(1, now - this.fpsLast)
        const fps = (this.frames / dt) * 1000
        this.frames = 0
        this.fpsLast = now
        for (const s of [this.totals, this.seg].filter((x): x is PerfSegment => x !== null)) {
          s.fps.samples += 1
          s.fps.avg += fps
          if (fps < s.fps.min) s.fps.min = fps
        }
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        if (mem) this.heapSamples.push(mem.usedJSHeapSize / (1024 * 1024))
      }, 500)
      if (typeof PerformanceObserver !== 'undefined') {
        try {
          this.longObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) this.recordLong(entry.duration)
          })
          this.longObserver.observe({ entryTypes: ['longtask'] })
        } catch {
          this.longObserver = null
        }
      }
      return true
    } catch {
      return false
    }
  }

  beginScene(name: string): void {
    if (!this.recording) return
    this.endScene()
    this.segName = name
    this.sceneWall = performance.now()
    this.seg = this.freshSeg(name, 0)
  }

  endScene(): void {
    if (!this.recording || !this.seg) return
    const s = this.seg
    s.wallMs = performance.now() - this.sceneWall
    s.heapAvgMB = this.heapSamples.length > 0 ? this.heapSamples.reduce((a, b) => a + b, 0) / this.heapSamples.length : 0
    if (s.fps.samples > 0) s.fps.avg /= s.fps.samples
    if (!Number.isFinite(s.fps.min)) s.fps.min = 0
    this.segments.push(s)
    this.seg = null
    this.segName = '(间隔)'
  }

  recordAdvance(bucket: PerfBucket, ms: number): void {
    if (!this.recording) return
    this.lastAdvMs = ms
    const s = this.seg
    if (s) {
      s.ticks[bucket] += 1
      this.addBox(s.adv[bucket], ms)
    }
    this.totals.ticks[bucket] += 1
    this.addBox(this.totals.adv[bucket], ms)
  }

  recordNotify(bucket: PerfBucket, ms: number): void {
    if (!this.recording) return
    const s = this.seg
    if (s) this.addBox(s.notify[bucket], ms)
    this.addBox(this.totals.notify[bucket], ms)
    const point: TimePoint = {
      at: Math.round(performance.now() - this.startWall),
      seg: this.segName,
      bucket,
      advMs: this.lastAdvMs,
      notifyMs: ms,
      commitMs: 0,
    }
    this.lastAdvMs = 0
    this.timeline.push(point)
    if (this.timeline.length > 240) this.timeline.splice(0, this.timeline.length - 240)
  }

  recordCommit(ms: number): void {
    if (!this.recording) return
    const s = this.seg
    if (s) this.addBox(s.commit, ms)
    this.addBox(this.totals.commit, ms)
    const last = this.timeline[this.timeline.length - 1]
    const now = performance.now() - this.startWall
    if (last && last.commitMs === 0 && Math.abs(now - last.at) < 500) {
      last.commitMs = ms
    } else {
      this.timeline.push({ at: Math.round(now), seg: this.segName, bucket: 'idle', advMs: 0, notifyMs: 0, commitMs: ms })
      if (this.timeline.length > 240) this.timeline.splice(0, this.timeline.length - 240)
    }
  }

  private recordLong(ms: number): void {
    if (!this.recording) return
    const s = this.seg
    if (s) this.addBox(s.long, ms)
    this.addBox(this.totals.long, ms)
  }

  recordWinPreheat(event: BountyWinDiagnostic): void {
    if (!this.recording) return
    for (const segment of [this.totals, this.seg]) {
      if (!segment) continue
      if (event.kind === 'dispatch') this.addBox(segment.winPreheat.dispatch, event.ms)
      else if (event.kind === 'result') this.addBox(segment.winPreheat.compute, event.ms)
      else if (event.kind === 'cancel') segment.winPreheat.cancelled++
      else segment.winPreheat.errors++
    }
  }

  liveWallMs(): number {
    return this.recording ? performance.now() - this.startWall : 0
  }

  liveTotals(): PerfSegment | null {
    return this.recording ? this.totals : null
  }

  report(): Record<string, unknown> | null {
    if (!this.recording) return null
    this.endScene()
    const segs = [...this.segments]
    this.segName = '(续)'
    this.seg = this.freshSeg(this.segName, 0)
    const t = this.totals
    const finalize = (s: PerfSegment): PerfSegment => {
      if (s.fps.samples > 0) s.fps.avg /= s.fps.samples
      if (!Number.isFinite(s.fps.min)) s.fps.min = 0
      return s
    }
    void finalize(t)
    void finalize(this.seg)
    const heapAvg = this.heapSamples.length > 0 ? this.heapSamples.reduce((a, b) => a + b, 0) / this.heapSamples.length : 0
    return {
      tool: tr("ui.perf.002"),
      iso: new Date().toISOString(),
      recordingMs: Math.round(performance.now() - this.startWall),
      hardware: { cores: navigator.hardwareConcurrency ?? null },
      totals: t,
      heapAvgMB: heapAvg,
      segments: segs,
      timeline: this.timeline.slice(-240),
    }
  }
}

export const perfHub = new PerfHub()

export function perfAutoEnabled(): boolean {
  return debugEnabled()
}
