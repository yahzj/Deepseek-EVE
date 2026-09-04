# T1 顶部活动窗口（状态：已确认）

> 来源：船长测试反馈单 T1（roadmap 置顶，批次 B→A 拆分）。2026-09-04 确认后实现。
> 关联：`docs/roadmap.md` T1–T11 清单、`docs/architecture.md` 里程碑表。

## 需求与澄清结果

- 原句：顶部（总菜单下）加"活动窗口"= 展示玩家当前正在做什么（训练/采矿/制造/远征/扫描/AI），
  窗口内提供终止按钮，使所有进行中活动都可主动停止；
- 澄清"移除其他内的玩家互动窗口指什么"→ 结论：**不做新弹窗**，顶栏加一条常驻"活动"横条
  （ActivityBar），并把原来散落在各页的状态区/停止按钮收敛进来；旧"其他"页的互动入口不再另起窗口。

## 已确认设计

1. **统一活动视图**（core `activity.ts`，纯只读查询）：`activityOverview(state, ctx)` 把进行中活动
   归一为活动条目——种类（train/mining/scan/manufacture/expedition/ai）、标签/副文案、
   进度百分比与剩余毫秒（可算的才有）、是否可停与该停法（ActivityStopKind + stopParam）。
2. **统一终止语义**（core 各自指令，UI 只转发）：
   - train → `removeQueueAt(0)`；
   - mining → `stopMining`；scan → `stopScan`（进度保存可续扫，沿用 V14 语义）；
   - manufacture → 新增 `cancelManufacturing`：材料全额退回仓库、制造费不退（含日志）；
   - expedition → 新增 `recallExpedition`：仅在"途中/返航"可召回（战斗阶段拒绝），舰队回母港；
   - ai → 按 stopParam 取消对应副船任务、AI 核心归还。
3. **界面收敛**：顶栏菜单下 `ActivityBar` 常驻显示全部活动（无活动时不占位）；
   各页原运行状态区与"停止"按钮迁至活动条，页内只留只读状态/收敛提示。
4. 存档无结构变化（cancel/recall 是纯运行指令），无版本迁移。

## 涉及文件

- `packages/core/src/activity.ts`（新增）+ index 导出；`manufacturing.ts`/`expedition.ts` 各加取消指令；
- UI：`panels/ActivityBar.tsx`（新增）、顶部导航布局（App.tsx）、各页状态区收敛
  （MapPage/Expedition/ShipPage/Industry 等）、styles.css 活动条样式；
- 测试：`packages/core/tests/t1.test.ts`（取消制造退款、召回限制、活动视图形状）。

## 验证

- core 测试全绿（含 t1.test.ts）；typecheck/build 通过；Electron 冒烟正常。
