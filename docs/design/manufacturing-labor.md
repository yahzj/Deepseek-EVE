# 组装机劳动者制（2026-09-08 已确认）

> 状态：已确认并实现（main 提交 fb5af67 之前的工作由本设计定稿）；与精炼炉机制完全相同的第二处理层。

## 背景

船长反馈：组装机的并行与精炼炉不一致——精炼炉每台炉需要劳动者（主控/AI 核心），
而组装机此前"无线作业"可无限并线（v21 2026-09-05 定稿：制造不占主控、与出海作业并行）。
船长拍板：**装配的生产也应占据主控或核心，两者机制完全相同，只是分别代表不同处理层**
（精炼炉处理矿物/残骸层、组装机处理蓝图制造层）。

## 定稿规则（与精炼炉逐条对齐）

1. **每条制造线必须有劳动者**：`worker = 'pilot'（主控亲自）| AiCoreType（一枚 AI 核心驱动一条线）`；
   同一蓝图可多条、不同蓝图不限，皆受劳动者数量约束——并行上限 = 1 条主控线 + 各型核心库存。
2. **主控手动位全局共用**：亲自开着的精炼炉 / 回收炉 / 制造线三者互斥，同一时间只能手动干一个站内作业；
   AI 核心驱动不受此限（可同时挂炉与开线）。
3. **主控手动制造 = 占主控工作位**：反向封锁与手动精炼一致——采矿/打捞/远征/扫描/掩护巡逻/离港
   在手动制造线运行中全部拒绝（location/mining/salvaging/expedition/explore 五处既有 pilot 判定
   各补一条组装线判定）。
4. **AI 线耗时链与 AI 炉同一套**：`duration = calcBuildDurationMs ÷ aiEfficiency(核心效率) ×
   (1 − 0.05 × 工业自动化等级)`（下限 0.6）；基础核心效率 0.4 → 2.5 倍时长，无人值守换慢速。
   主控线维持原公式（工业理论 × 批量生产学，开工锁定）。
5. **AI 核心占用/归还**：开工出库占用（occupyAiCore），取消/到点完成自动归还（releaseAiCore）；
   核心库与 AI 副船任务、精炼炉共用同一库存，天然全局竞争。
6. **开工前置**：组装机在母港才能开工（isAtHome，同炉）。
7. **旧作业豁免（无存档版本号提升）**：`ManufacturingRunState.worker` 为可选字段；老档在跑线
   无 worker = 「旧作业」：不占劳动者位、照常跑到自然完成/被取消、可随时取消（无核心可退），
   之后新开工必须带劳动者。视图 worker=null、workerLabel='旧作业'。
8. **技能文案**：「工业自动化」描述更新为覆盖精炼炉与组装机 AI 驱动。

## 涉及文件

- `packages/core/src/state.ts`（ManufacturingRunState.worker 可选 + 注释）
- `packages/core/src/manufacturing.ts`（开工/取消/完成/视图劳动者化、manufacturingManualActive 导出）
- `packages/core/src/industry.ts`（开炉 pilot 补查制造线，共享手动位）
- `packages/core/src/{location,mining,salvaging,expedition,explore}.ts`（反向封锁各补一条）
- `packages/core/src/activity.ts`（制造活动卡带劳动者文案）
- `packages/data/src/skills.ts`（工业自动化描述）
- `apps/desktop/src/renderer/src/panels/Industry.tsx`（组装机卡对齐精炼炉卡：名册行劳动者+取消；
  手动制造 + AI 核心下拉/AI 制造按钮；核心选择与忙因提示同炉卡）
- `apps/desktop/src/renderer/src/pages/IndustryPage.tsx`（炉卡手动忙因补组装线）
- 测试：`manufacturing.test.ts`（重写）、`t1.test.ts`、`debugQuick.test.ts` 适配

## 关联

- 精炼炉劳动者模型：`docs/design/refine-cycles.md` / `industry.ts`
- 制造多工位 v21：state.ts v21 注释
