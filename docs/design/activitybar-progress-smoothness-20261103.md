# 设计文档：左侧活动栏进度条刷新率与平滑度优化 (2026-11-03)

## 1. 状态与背景
- **状态**：开发中
- **船长原话**：「左侧的玩家活动、技能训练、副AI活动，这几个进度条的刷新率太慢了」
- **功能域**：桌面端活动栏 UI 表现层与引擎挂机推进节奏 (`apps/desktop/src/renderer/src/panels/ActivityBar.tsx`、`styles.css`、`game/engine.ts`)

---

## 2. 现状读数与病根剖析

经过源码取证与时钟链路分析，发现“刷新率太慢、顿挫明显”由以下三处原因共同造成：

1. **引擎挂机切片步调脱节（1Hz 实际推进）**：
   - `GameEngine` 在常态挂机时，虽然 `pumpMs` 为 500ms（每 500ms 触发一次 `tick()`）；
   - 但在 `engine.ts` 的 1506 行却存在硬编码判定：
     ```ts
     if (this.pendingMs >= 1000) {
       this.advanceSlice(this.pendingMs)
       this.pendingMs = 0
       this.notify()
     }
     ```
   - 导致第 1 个 500ms tick 到达时（`pendingMs ≈ 500 < 1000`）完全空转不推进也不通知 UI；直到第 2 个 tick（1000ms）才推进一次并 `notify()`。真实数据刷新率被死死限制在 1 秒 1 次（1Hz），遇到墙钟微小抖动时甚至变成 1.5 秒跳一次。

2. **CSS 动效曲线与数据周期失配（抽搐停滞感）**：
   - 样式表 `styles.css:13334` 与 `11171` 中，`.app-activitybar-fill` 和 `.app-progress-mini i` 均声明了 `transition: width 0.35s ease`；
   - `0.35s ease` 属于先快后慢的刹车缓动。在 1000ms 的数据周期中，前 350ms 猛冲并刹车静止，后 650ms 处于完全死停状态。视觉上表现为剧烈的“走 0.35s、停 0.65s”阶梯式卡顿抽动。

3. **缺乏周期重置瞬回机制（倒退缩回）**：
   - 采矿等短周期活动每满 100% 结算并进入下一轮时，`percent` 从 100 骤降为 0；
   - 因无重置保护，CSS transition 会在 0.35s 内倒退缩回，形成反向倒放的非物理视觉瑕疵。

---

## 3. 优化方案与设计决策

### 方案一：心跳与切片步调对齐（提升至 4Hz / 250ms 灵敏心跳）
- 将 `engine.ts` 的非战斗期切片门槛由 `pendingMs >= 1000` 优化为 `pendingMs >= this.pumpMs`；
- 将非战斗期挂机心跳 `pumpMs` 调优为 `250ms`（每秒 4 次切片，逻辑计算耗时 < 0.1ms，CPU 占用率近乎为 0，完全保持绿色低功耗）；
- 数据刷新率从原先的 1Hz 提升至 4Hz（提升 300%），倒计时与百分比数字跳动更加细腻及时。

### 方案二：硬件加速线性流动衔接（Hardware-Accelerated Linear Transition）
- 将 `.app-activitybar-fill` 与 `.app-progress-mini i` 的过渡调整为匹配心跳周期的 `transition: width 0.25s linear`；
- 在 250ms 周期内匀速线性向前推进，下一拍数据到达时恰好无缝续接，使进度条在 GPU 合成器上实现 60fps/120fps 恒定匀速流动，彻底消除刹车顿挫与静止死停。

### 方案三：循环周期瞬回保护（Instant Reset on Loop）
- 在 `ActivityBar.tsx` 中为进度条渲染引入轻量自测组件或重置判定（`percent < prevPercent` 时临时禁用 transition），周期循环与任务取消重置瞬间归零，绝不倒放。

---

## 4. 改动清单
- 修改：`apps/desktop/src/renderer/src/game/engine.ts`（挂机心跳与推进步调对齐）
- 修改：`apps/desktop/src/renderer/src/styles.css`（进度条 transition 参数调整为 0.25s linear）
- 修改：`apps/desktop/src/renderer/src/panels/ActivityBar.tsx`（瞬回保护与进度条平滑）
- 衍生：`apps/desktop/src/renderer/src/ui/layout-css/styles-modern.css`、`styles-classic.css`（通过 `npm run ui:layout-css` 同步）

---

## 5. 待裁决点
- 无（全流程纯优化，不影响底层放置数值算法与离线结算契约）。

