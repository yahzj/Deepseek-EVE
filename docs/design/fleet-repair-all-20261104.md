# 舰队全部修理

## 状态

实施完成，待船长验收

## 经办信息

- 经办：二号
- 分支：`d2/workspace`
- 日期：2026-11-04

## 用户原话

> 我希望在‘我的舰队’里添加一个全部修理的按钮。
>
> 确定

## 已确认方案

- 在「我的舰队」页面增加「全部修理」按钮。
- 首次确认前汇总并展示：可修理船只数量、健康船只跳过数、出勤或不可操作船只跳过数、总费用。
- 用户确认后按最新舰队状态重新计算；重新计算的整批结果原子执行，不允许部分修理。
- 余额不足时整批不执行。
- 费用和修理结果沿用现有单船修理规则，不修改修理公式。
- 实现范围：`core`、`renderer`、本地化及专项测试。
- UI 沿用现有舰队筛选条与模态框样式和交互。

## 不在本次范围

- 市场、修理组件或材料获取流程。
- 改变舰船出勤方式或增加绕过出勤限制的操作。
- 调整单船修理规则、修理公式或其他舰队操作。

## 验收与交付

- 本次涉及文件：`packages/core/src/shipyard.ts`、`packages/core/src/index.ts`、`packages/core/tests/fleet-repair-20261104.test.ts`、`apps/desktop/src/renderer/src/game/engine.ts`、`apps/desktop/src/renderer/src/pages/ShipPage.tsx`、`packages/data/src/l10n/table.ts`、`docs/l10n-pending.md`。
- 专项测试：1 个文件、4 项通过。
- 最新 `npm run typecheck`：通过。
- `npm run content:check`：通过。
- `npm run l10n:check`：通过，6966 条表/源码 id 一致，待译项已登记。
- `npm run build`：最终 `ShipPage` 调整后重跑通过；存在 `perf.ts` 既有动静态导入警告。
- `npm run ui:rot-check`：未完成。沙箱首跑报 `ENOMEM`，提权申请被审批策略拒绝；按要求不再运行。桌面 typecheck/build 与手工源码检查作为其余证据，但 UI 护栏检查仍未完成。
- 观感验收：未完成，不记为通过。
- `git diff --check`：通过（涉及工作区现有跟踪变更中的本批路径）。
- 待船长验收。
- 不提交、不合入、不推送。
