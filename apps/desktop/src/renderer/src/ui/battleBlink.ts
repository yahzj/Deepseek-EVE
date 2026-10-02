/**
 * **闪现光柱演出件**（2026-10-02 从 `panels/BattleScreen.tsx` 拆出 · 批次 4r · 零行为变化）。
 *
 * 本文件 = 战斗界面的**闪现光柱**：弹种键、光柱计划（确定性伪随机）、SVG 柱体构建与 DOM 同步——
 * 只依赖 @whale/core 与 types。`BattleScreen.tsx` 借回使用（先例：fitted.ts），既有引用零改动。
 */

import type { DamageType } from '@whale/core'

/* 以下为 2026-10-02 批次 4r 从 BattleScreen.tsx 切接过来的整簇（ammoKey ~ syncBlinkPillarDom）。 */

/** ammo 缩写键（与核心引擎一致） */
export function ammoKey(t: DamageType): 'kin' | 'exp' | 'pla' {
  return t === 'kinetic' ? 'kin' : t === 'explosive' ? 'exp' : 'pla'
}

/**
 * **闪现光柱的时长**（真实毫秒）——**必须与三份 `styles*.css` 的 `@keyframes app-bts-blink-pillar` 同值**
 * （420ms）。它同时是"这根柱什么时候从表里摘掉"的判据 ⇒ 界面与 CSS 只要一处改就得两处一起改。
 */
const BLINK_FX_MS = 420

/** 一根待播/在播的闪现光柱（真实毫秒时刻；`el` = 已建出来的 DOM，避免每帧查 DOM） */
export type BlinkPillarFx = { key: string; tag: string; at: number; until: number; el?: SVGSVGElement }

/**
 * 🔴 **排"闪现光柱"**（**船长 2026-10-02 实机报障「闪现特效依旧不存在」后的第二修**）——
 * **纯函数、由 RAF 循环每拍调用**，不经过 React。
 *
 * 数据源 = **引擎自己的时刻表 `battle.foeBlinkQueue`**（**不是** `fx` 事件环）：
 * - `fx` 是**48 条环缓冲**（`pushBattleFx`：`fx.length > 48` 就丢最旧）⇒ 编队战时几十毫秒就能把一条
 *   闪现事件挤出去，界面永远读不到它；而队列项从 `queuedMs` 一直留到 `appearMs`（= 整个 2000ms 过程），
 *   又**本来就是权威时刻表**（`vanishMs` / `moveAtMs` / `appearMs` 三段）⇒ 直接读它最稳。
 * - `seen` = "这段已经排过了"的去重集合（键 `tag:queuedMs`，换战斗时清空）——
 *   本函数每 33ms 被调一次，同一段会连着看见几十次，不去重就会排几十根。
 *
 * ⚠ **两段都要"迟到也能补"**：换算出来的时刻若已过去 ⇒ 钳到 `now` 立刻播（否则会永远排在将来）；
 *   但**①（消失柱）只在位移还没兑现时排**——晚了的话舰体已经在新位置，补一根"旧位置"的柱是**错的**。
 * ⚠ `b.speedX` = 战斗倍速：引擎给的是**游戏毫秒**，动画跑的是**真实毫秒** ⇒ 必须除一下。
 */
export function planBlinkPillars(
  b:
    | {
        foeBlinkQueue?: Record<string, { queuedMs: number; vanishMs: number; moveAtMs: number; appearMs: number }>
        lastTickGameMs?: number
        speedX?: number
      }
    | null
    | undefined,
  seen: Set<string>,
  out: BlinkPillarFx[],
  now: number,
): void {
  const q = b?.foeBlinkQueue
  if (!b || !q) return
  const last = b.lastTickGameMs ?? 0
  const speed = Math.max(0.01, b.speedX ?? 1)
  /** 游戏毫秒 → "从现在起还要等多少真实毫秒"（负数 = 那个节点已经过去了） */
  const toReal = (gameMs: number): number => (gameMs - last) / speed
  for (const [tag, seg] of Object.entries(q)) {
    const key = `${tag}:${seg.queuedMs}`
    if (seen.has(key)) continue
    seen.add(key)
    /**
     * ⚠ **DOM id 与 `url(#…)` 只吃安全字符**：键里带 `:`（tag 与时刻的分隔）会被当成伪类/命名空间
     * ⇒ 渐变与蒙版的 `url(#blink-pillar-line-${key})` 引用会失效（光柱画成纯黑或干脆不画）。
     * 这里统一换成 `-`（tag 本身是 `w0-foe-1` 这类，只可能多出分隔符）。
     */
    const uniq = key.replace(/[^A-Za-z0-9_-]/g, '-')
    /** ① 消失节点（**旧位置**）：只有"还没位移"才排 —— 晚了就跳过，宁可少一根也不画错位置 */
    if (toReal(seg.moveAtMs) > 0) {
      const vanishAt = now + Math.max(0, toReal(seg.vanishMs))
      out.push({ key: `${uniq}-a`, tag, at: vanishAt, until: vanishAt + BLINK_FX_MS })
    }
    /** ② 出现节点（**新位置**）：船长那句「在新位置播放动画同时舰船出现」的"同时" ⇒ 与 `appearMs` 对齐 */
    const appearDelay = toReal(seg.appearMs)
    if (appearDelay > -BLINK_FX_MS) {
      const appearAt = now + Math.max(0, appearDelay)
      out.push({ key: `${uniq}-b`, tag, at: appearAt, until: appearAt + BLINK_FX_MS })
    }
  }
}

/**
 * 🔴 **闪现特效：竖直光柱**（**船长 2026-10-02 令**：「**特效我更希望接近大鲸鱼根目录的『闪现效果参考.png』**」）
 * ——做成一个**脱离 React 的 DOM 工厂**。
 *
 * ⚠ **为什么必须走 DOM 而不是 JSX**（**2026-10-02 实测踩到**：船长「**我进行了实机测试，并没有看到特效**」）：
 * 本面板的逐帧动画**全部由 RAF 循环直接操作 DOM**（见 `drive`），React 只在"距离变化 ≥ 0.05"等少数时刻重渲染；
 * 而闪现演出期间**双方机动常常都归零**（敌舰刚闪到自己的期望距离、我方也在期望距离上）⇒ 距离不变
 * ⇒ `setSmoothM` 不触发重渲染 ⇒ 把特效"推入 ref 等重渲染"**根本等不到**。
 *
 * 形制（按参考图）：**多道竖直细光柱**——中心最亮（青白）→ 两侧渐深（青 → 深蓝），整根**上下渐隐**。
 * 两个时间点各爆一根：① 消失（旧位置）② 出现（新位置）。
 *
 * ⚠ 竖向与舰体朝向**无关**（`.app-sprite` 的翻转只在它自己的 `svg g` 里，不影响兄弟节点）。
 * ⚠ 渐变/蒙版 id 必须**逐元素唯一**，否则同页多根柱会互相抢 defs。
 * @param size 舰体尺寸（px）——光柱宽高按它换算
 */
export function buildBlinkPillarEl(uniq: string, size: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg'
  const w = Math.max(24, Math.round(size * 0.85))
  const h = Math.max(48, Math.round(size * 2))
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('class', 'app-bts-blink-pillar')
  svg.setAttribute('viewBox', '-50 -95 100 190')
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.style.width = `${w}px`
  svg.style.height = `${h}px`
  svg.style.left = '50%'
  svg.style.top = '50%'
  svg.style.marginLeft = `${-Math.round(w / 2)}px`
  svg.style.marginTop = `${-Math.round(h / 2)}px`
  svg.style.overflow = 'visible'
  const defs = document.createElementNS(NS, 'defs')
  /**
   * 🔴🔴 **两个渐变都必须用 `userSpaceOnUse`**（**2026-10-02 抓到真凶**）：
   * 光柱的 52 道线都是**绝对竖直**的（`x1 === x2`）⇒ 它们的**包围盒宽度为 0**，而渐变缺省走
   * `objectBoundingBox` —— 按 SVG 规范，**引用元素的包围盒只要有一边为 0，该渐变即"不成立"**，
   * 于是**整根线一个像素都不画**（实测：元素在、`opacity 0.999965`、52 条 `<line>` 齐全、
   * `stroke=url(#…)` 引用也对，**截图上柱位置全黑**）。
   * ⇒ 坐标一律改成**用户空间**（`viewBox = -50 -95 100 190`，纵向从 -95 到 95），与线两端逐字对齐。
   */
  const lineGrad = document.createElementNS(NS, 'linearGradient')
  lineGrad.setAttribute('id', `blink-pillar-line-${uniq}`)
  lineGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
  lineGrad.setAttribute('x1', '0')
  lineGrad.setAttribute('y1', '-95')
  lineGrad.setAttribute('x2', '0')
  lineGrad.setAttribute('y2', '95')
  for (const [off, color] of [
    ['0%', '#1a3f9e'],
    ['42%', '#2ea8e0'],
    ['58%', '#3fe0f0'],
    ['100%', '#1a3f9e'],
  ] as const) {
    const st = document.createElementNS(NS, 'stop')
    st.setAttribute('offset', off)
    st.setAttribute('stop-color', color)
    lineGrad.appendChild(st)
  }
  const fadeGrad = document.createElementNS(NS, 'linearGradient')
  fadeGrad.setAttribute('id', `blink-pillar-fade-${uniq}`)
  /** 同上：蒙版的明暗坡也走**用户空间**（与它铺的那块 `-95…95` 的矩形逐字对齐） */
  fadeGrad.setAttribute('gradientUnits', 'userSpaceOnUse')
  fadeGrad.setAttribute('x1', '0')
  fadeGrad.setAttribute('y1', '-95')
  fadeGrad.setAttribute('x2', '0')
  fadeGrad.setAttribute('y2', '95')
  for (const [off, color] of [
    ['0%', '#000'],
    ['25%', '#fff'],
    ['75%', '#fff'],
    ['100%', '#000'],
  ] as const) {
    const st = document.createElementNS(NS, 'stop')
    st.setAttribute('offset', off)
    st.setAttribute('stop-color', color)
    fadeGrad.appendChild(st)
  }
  const mask = document.createElementNS(NS, 'mask')
  mask.setAttribute('id', `blink-pillar-mask-${uniq}`)
  mask.setAttribute('maskUnits', 'userSpaceOnUse')
  mask.setAttribute('x', '-50')
  mask.setAttribute('y', '-95')
  mask.setAttribute('width', '100')
  mask.setAttribute('height', '190')
  const maskRect = document.createElementNS(NS, 'rect')
  maskRect.setAttribute('x', '-50')
  maskRect.setAttribute('y', '-95')
  maskRect.setAttribute('width', '100')
  maskRect.setAttribute('height', '190')
  maskRect.setAttribute('fill', `url(#blink-pillar-fade-${uniq})`)
  mask.appendChild(maskRect)
  defs.append(lineGrad, fadeGrad, mask)
  svg.appendChild(defs)
  const g = document.createElementNS(NS, 'g')
  g.setAttribute('mask', `url(#blink-pillar-mask-${uniq})`)
  const N = 52
  for (let i = 0; i < N; i++) {
    /** 横向位置 -50 → 50；`d` = 离中心多远（0 = 中心最亮） */
    const x = -50 + (i / (N - 1)) * 100
    const d = Math.abs(x) / 50
    const ln = document.createElementNS(NS, 'line')
    ln.setAttribute('x1', String(x))
    ln.setAttribute('y1', '-95')
    ln.setAttribute('x2', String(x))
    ln.setAttribute('y2', '95')
    ln.setAttribute('stroke', `url(#blink-pillar-line-${uniq})`)
    ln.setAttribute('stroke-width', String(0.45 + (1 - d) * 1.05))
    ln.setAttribute('opacity', String(0.12 + Math.pow(1 - d, 1.6) * 0.85))
    g.appendChild(ln)
  }
  svg.appendChild(g)
  return svg
}

/**
 * **把"到点的闪现光柱"建出来 / 把过期的删掉**（RAF 里每次调用；**不经过 React**）。
 *
 * - 建：按 `at` 到点的项，**按该舰此刻的几何**在列盒里插一根柱；
 * - 删：`until` 过期的项，摘掉 DOM 并出表。
 *
 * 🔴 **为什么挂在列盒（`.app-bts-col`）而不是单位元素里**（**船长 2026-10-02 第二次报障的第二个根因**）：
 * 单位在"等待段"挂着 `.is-blink-hidden { opacity: 0 }`（整段的 2/3，400ms 旋钮下是 267ms），
 * 而**子元素的不透明度 = 父级 × 自身** ⇒ 挂在里面的光柱**恒为全透明**，怎么调都看不见。
 * 挂到列盒当兄弟节点 ⇒ 不吃单位那层透明度，也顺带不再被单位的 `z-index`/动画上下文影响。
 *
 * ⚠ 位置用 `offsetLeft/offsetTop/offsetWidth/offsetHeight`（**布局像素**，与列盒同一坐标系），
 * 不用 `getBoundingClientRect()`——后者带入场动画 `app-bts-foe-in` 的 `scale(.81)` 与舞台缩放，
 * 拿它算会把光柱画小、画偏（实测踩到：`rectW=89 / offsetWidth=110`）。
 * ⚠ 表里记 `el` 引用（不查 DOM），避免每帧 querySelector。
 */
export function syncBlinkPillarDom(fxList: BlinkPillarFx[], root: HTMLElement | null, now: number): void {
  for (let i = fxList.length - 1; i >= 0; i--) {
    const fx = fxList[i]!
    if (now >= fx.until) {
      fx.el?.remove()
      fxList.splice(i, 1)
      continue
    }
    if (fx.el || now < fx.at || !root) continue
    /** tag 里可能有 `w0-foe-1` 这类字符（连字符/数字都安全），但保险起见按属性值转义 */
    const host = root.querySelector<HTMLElement>(`[data-tag="${CSS.escape(fx.tag)}"]`)
    if (!host) continue
    const w = host.offsetWidth || 96
    const h = host.offsetHeight || 96
    const el = buildBlinkPillarEl(fx.key, Math.max(w, h))
    /** 居中到该舰此刻的位置（列盒 = 定位祖先；`buildBlinkPillarEl` 已给 `-w/2 / -h/2` 的外负边距） */
    el.style.left = `${host.offsetLeft + w / 2}px`
    el.style.top = `${host.offsetTop + h / 2}px`
    root.appendChild(el)
    fx.el = el
  }
}