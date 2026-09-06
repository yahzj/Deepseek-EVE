# 游戏内置性能监测与本地自动采集（2026-09-08 已确认）

> 背景：玩家反馈"运行游戏后主机高速运转"（场景：电脑浏览器/Electron·战斗中）。
> 船长决策：①内置隐形性能监测（玩家可一键导出快照）；②本机自动跑分采集数据，
> 以决定是否实施"第二包：战斗渲染隔离"。第一包（挂机心跳 100ms→500ms）已合入。

## 采集内容（perfHub）

- **引擎推进耗时**（挂机/战斗分桶）：每次 advanceGame 的 CPU 毫秒（avg/max/次数）；
- **整树刷新开销**（挂机/战斗分桶）：每次 notify（含 React 提交路径）毫秒；
- **React commit 耗时**：诊断激活时 `<Profiler>` 上报 actualDuration（未激活零开销）；
- **FPS**（rAF 计数 500ms 一拍）、**长任务**（longtask 观察器，>50ms 卡顿）、**JS 堆**采样；
- **分场景切片**（地图挂机/工业页/市场页/战斗）+ 最近 240 条通知时间线（推进+刷新+提交同拍配对）。

## 激活方式

- 玩家/开发：DevTools 执行 `localStorage.setItem('whale-idle:debug','1')` 后刷新 →
  顶栏出现「⇄ 调试」与「⏱ 性能」；性能 HUD 右下角悬浮，可「复制报告」粘贴回传。
- 本机自动跑分：Electron 环境变量 `WHALE_AUTOPERF=<场景JSON>` + `WHALE_PERF_USERDATA=<临时目录>`
  （存档目录隔离，绝不碰真实存档），跑完把 `AUTOPERF_REPORT_BEGIN/END` JSON 打到 stdout。

## 一键跑分

```
powershell -File tools/run-autoperf.ps1
# 产物 out/autoperf-<时间戳>/run.log；解析两端标记之间为完整报告
```

默认场景：地图挂机 60s → 工业页 60s → 市场页 60s → 战斗 ≈90s（战斗段自动补开远征）。

## 涉及文件

- `apps/desktop/src/renderer/src/game/perf.ts`：性能 Hub（隐形采集、分桶、场景切片、报告导出）
- `apps/desktop/src/renderer/src/game/autoPerf.ts`：自动采集驱动器（场景执行/开战/输出/自退）
- `apps/desktop/src/renderer/src/game/engine.ts`：tick 推进与 notify 埋点
- `apps/desktop/src/renderer/src/App.tsx`：PerfShell(Profiler 边界) + PerfHud(调试 HUD)
- `apps/desktop/src/main/index.ts` / `src/preload/index.ts`：userData 隔离 + WHALE_AUTOPERF 注入
- `tools/make-autoperf-save.ts`（干净初始存档）/ `tools/run-autoperf.ps1`（一键跑分）
- `styles.css`：`.app-perf-hud` 样式

## 读数口径提示

- 未激活时零开销（单次布尔判断，无定时器/观察器）；激活后仪器自身有少量开销，
  对比用同一构建同一机器数据。
- 战斗分桶 = expedition 处于 battle 相位；心跳在战斗期 100ms、其余 500ms（第一包降频后）。
- 生产构建中 React `<Profiler>` 不触发 onRender → 采集激活时引擎订阅改用 `flushSync`
  把整树刷新压成同步并实测（`commit` 字段 = 真实渲染提交耗时；正常路径仍为异步渲染）。

## 本机跑分结果（2026-09-07，32 核开发机 · 生产构建 · 自动采集四场景）

> 环境无交互桌面，自动模式已禁用 Chromium 后台/遮挡节流（WHALE_AUTOPERF 开关），
> 帧率 ≈60fps；仅测 JS 主线程（advance/notify/commit），GPU 合成/绘画不在此列。
> 原始报告：out/autoperf-20260907-074027/run.log。

| 场景 | 引擎推进/拍 | 整树刷新(commit)/次 | 频率 | 折合单核占用 |
|---|---|---|---|---|
| 地图挂机 60s | ≈0.12ms（峰 1.4） | ≈0.64ms（峰 1.0） | 1Hz | <0.1% |
| 工业页 60s | ≈0.12ms | ≈0.45ms（峰 0.9） | 1Hz | <0.1% |
| 市场页 60s | ≈0.08ms | ≈4.1ms（峰 5.8） | 1Hz | ≈0.4% |
| 战斗 90s | ≈0.09ms（峰 2.8） | ≈3.7ms（峰 6.5） | 10Hz ×901拍 | ≈3.7% |

长任务（>50ms）：0 次。结论：**JS 主线程开销很小**（战斗最重 ≈单核 4%），
不足以独自让风扇起飞 → 玩家高占用更可能来自 GPU/合成/动画绘制或浏览器侧因素
（多实例、硬件加速关闭等）；已可让玩家用 debug HUD「复制报告」在真机对照。
