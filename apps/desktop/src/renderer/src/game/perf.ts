/**
 * 隐形性能监测 Hub（2026-09-08 诊断工具，船长批准的"游戏内性能监测"方案）。
 *
 * 采集内容（仅诊断需要，玩家无感知）：
 * - 引擎推进耗时（挂机/战斗分桶）：每次 advanceGame 的实际 CPU 毫秒；
 * - 通知开销（挂机/战斗分桶）：每次 notify（含 React 提交路径）的实际毫秒；
 * - React commit 耗时：诊断激活时由 App 的 <Profiler> 上报 actualDuration；
 * - FPS（rAF 帧计数）、长任务（PerformanceObserver longtask）、JS 堆内存；
 * - 分场景（地图挂机/工业页/市场页/战斗）切片 + 最近 240 条通知时间线。
 *
 * 激活方式（未激活时全部为一次布尔判断，零定时器/观察器/额外开销）：
 * - localStorage 'whale-idle:debug' = '1'（与既有调试入口同开关；玩家可被引导开启后导出快照）；
 * - 或自动采集模式 window.__AUTOPERF__（Electron 环境变量 WHALE_AUTOPERF，本机跑分用）。
 */

export type PerfBucket = 'idle' | 'battle'

/** 一个计量段（全局总量或单个场景切片的形态一致） */
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
  /** 是否正在采集（activation() 成功后为 true） */
  recording = false

  private startWall = 0
  private sceneWall = 0
  private segName = ''
  private seg: PerfSegment | null = null
  private totals = this.freshSeg('总览', 0)
  private segments: PerfSegment[] = []
  private timeline: TimePoint[] = []
  private fpsTimer: number | null = null
  private rafId: number | null = null
  private frames = 0
  private fpsLast = 0
  private longObserver: PerformanceObserver | null = null
  private heapSamples: number[] = []
  /** 最近一次引擎推进耗时（给紧邻的 notify 时间线点配对上，方便看"推进+渲染"同拍） */
  private lastAdvMs = 0

  private freshSeg(name: string, wallMs: number): PerfSegment {
    return {
      name,
      wallMs,
      ticks: { idle: 0, battle: 0 },
      adv: { idle: { n: 0, sumMs: 0, maxMs: 0 }, battle: { n: 0, sumMs: 0, maxMs: 0 } },
      notify: { idle: { n: 0, sumMs: 0, maxMs: 0 }, battle: { n: 0, sumMs: 0, maxMs: 0 } },
      commit: { n: 0, sumMs: 0, maxMs: 0 },
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

  /** 尝试激活采集（幂等；失败静默返回 false） */
  activate(): boolean {
    if (this.recording) return true
    if (typeof performance === 'undefined' || typeof window === 'undefined') return false
    try {
      this.startWall = performance.now()
      this.segName = '(开场)'
      this.seg = this.freshSeg(this.segName, 0)
      this.recording = true
      // 帧率 + 堆采样（500ms 一拍，只在激活期运行）
      this.fpsLast = performance.now()
      const fpsLoop = (): void => {
        if (!this.recording) return
        this.frames += 1
        this.rafId = requestAnimationFrame(fpsLoop)
      }
      this.rafId = requestAnimationFrame(fpsLoop)
      this.fpsTimer = window.setInterval(() => {
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
      // 长任务观察（Chromium 均有；找不到则跳过）
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

  /** 标记场景开始（报告里按场景切片；同名的连续 begin 会先自动封段） */
  beginScene(name: string): void {
    if (!this.recording) return
    this.endScene()
    this.segName = name
    this.sceneWall = performance.now()
    this.seg = this.freshSeg(name, 0)
  }

  /** 封存当前场景段 */
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

  /** 引擎推进耗时上报（engine.tick 调用；挂机/战斗分桶） */
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

  /** 通知开销上报（engine.notify 调用；自动把上一次推进耗时配到同一点上） */
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

  /** React commit 耗时上报（App <Profiler> onRender；紧邻的 notify 点会原地合并） */
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

  /** 已采集墙钟秒数（HUD 用；未激活返回 0） */
  liveWallMs(): number {
    return this.recording ? performance.now() - this.startWall : 0
  }

  /** 实时累计量引用（HUD 直读；未激活返回 null） */
  liveTotals(): PerfSegment | null {
    return this.recording ? this.totals : null
  }

  /** 生成可导出报告（JSON 化对象；未激活返回 null） */
  report(): Record<string, unknown> | null {
    if (!this.recording) return null
    this.endScene()
    const segs = [...this.segments]
    // 重新打开一段，避免 endScene 后失去现场（不参与本报告）
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
      tool: '大鲸鱼·性能快照（perfHub 2026-09-08）',
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

/** 全局性能 Hub 单例 */
export const perfHub = new PerfHub()

/** 判断诊断开关是否应激活采集（localStorage whale-idle:debug=1；浏览器降级安全） */
export function perfAutoEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('whale-idle:debug') === '1'
  } catch {
    return false
  }
}
