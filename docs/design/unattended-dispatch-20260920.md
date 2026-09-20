# 工作文档：上位技能「无人值守调度学」（离线结算 +40%/级）· 2026-09-20

> **状态：进行中**（实现完成，待船长验收）
>
> **船长原话（照抄）**：「新增离线作业管理学的上位技能：效果为离线结算时长每级 +40%.技能rank4」

## 一、裁定链（五问五答 · 2026-09-20）

| 问 | 船长裁定 |
|---|---|
| 新技能名 | **「无人值守调度学」**（现有「离线作业管理学」已占名，上位技能另起名） |
| 新旧技能关系 | **并存叠加**（8h × (1 + 20%×旧级 + 40%×上级)） |
| +40% 算法 | **加算**（满级 L5 = +200%） |
| 前置 | **无前置**（游戏技能系统本无前置机制） |
| 技能组 | **两个技能都移动到「工程」组**（离线作业管理学原在工业组，一并改） |

## 二、方案要点

- 新技能：`unattended-dispatch`「无人值守调度学」· 工程 · **rank 4** · 每级 +40%（满级 24 小时）。
- 现有 `offline-ops`「离线作业管理学」：group 工业 → **工程**；名字/rank3/+20%/描述不动。
- 离线上限公式（`core/simulation.ts` `simulateOffline`）：
  `capEff = capMs × (1 + 0.2×offline-ops级 + 0.4×unattended-dispatch级)`，两技能各自封顶 5 级。
- 数值表：双 0 = 8h · 旧满 = 16h · 新满 = 24h · **双满 = 32h**。

## 三、落点清单

| 文件 | 改动 |
|---|---|
| `packages/data/src/skills.ts` | 新增技能条目（工程组末尾）· `offline-ops` group 改工程 |
| `packages/core/src/simulation.ts` | 离线上限双技能加算 |
| `packages/data/src/l10n.ts` | EN_SKILLS 补 `unattended-dispatch`（⚠ 三号 verify40 的 ID 制 l10n 在途，合并时按他新制对齐） |
| `tools/content-check.ts` | 技能说明契约 INLINE 表登记 `unattended-dispatch` per 0.4 |
| `packages/core/tests/skills-effects.test.ts` | 新增 3 例（新满 24h · 双满 32h · L2=14.4h 加算钉死） |

## 四、范围与不做

- **不做**：UI 改动（SkillsPage 数据驱动，自动生效）· 存档迁移（trained 缺省 0）· 公告（小修改口径）· 前置技能机制。
- **只影响**：离线结算上限（读档补进度段）；在线心跳/调试快进/工具模拟不受影响。

## 五、验证

- typecheck 四包 · core 全量测试 · content:check（新契约登记）· l10n:check · docs:index。

## 六、待裁决点

- 无（五问已全覆盖）。

---

_维护：本件是工作文档，验收后按 AGENTS §8 归档（关键内容并入 roadmap/词典 → 删文件 → 重跑 docs:index）。_
