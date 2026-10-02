# 首发黑匣通讯「谜质 → 装备」用词修正（工作文档）

- **状态：进行中**（2026-10-01 开工；代码改动与闸门已完成，待船长验收与合入）
- 经办：三号（worktree `Deepseek-EVE-verify`，分支 `verify`）
- 归档时：关键结论并入 `docs/roadmap.md` 一条精简条目后删除本文件（§十五 文档工作流）

## 1. 船长原话（照抄）

> 「玩家第一获得黑匣的通讯标题出现了错误。'插件和谜质一样，装上就拆不下来、也换不了别的'改为'插件和装备一样，装上就拆不下来、也换不了别的'」

## 2. 范围 / 不做

**做**

- `msg-blackbox-plug-unlock`（玩家拿到第一个黑匣时发的那封通讯）正文第 2 段的**用词**：拿谜质打比方 → 改拿**装备**打比方。
- 该篇英文覆盖（`COMMS_BODY_EN`）同句同步，避免英文界面下留着同一个错。

**不做**

- 不改标题（`subject`「工业通报：黑匣可以换舰船插件了」核过，没写错；船长说的"标题"落在正文那句上）。
- 不改该篇第 1、3 段，不改 `hint` 落款，不动触发条件（`blackboxSeen`）与任何机制、数值、存档字段。
- 不改其它通讯、不改 `docs/design/copy-audit-20260930.md`（那是**已收尾的旧工作文档**，按 §十五 第 2 条不动）。

## 3. 改动清单

| 文件 | 位置 | 原 → 新 |
|---|---|---|
| `packages/data/src/messages.ts` | `msg-blackbox-plug-unlock` body[1] | 「插件**和谜质一样**，装上就拆不下来、也换不了别的——…」→「插件**和装备一样**，装上就拆不下来、也换不了别的——…」（整句其余一字未动）；句上方加 `⟪文案调整 2026-10-01⟫` 记号（§十三） |
| `apps/desktop/src/renderer/src/ui/commsText.ts` | `COMMS_BODY_EN['msg-blackbox-plug-unlock']` 第 2 段 | `A ship plug is a device as remarkable as Enigma.` → `A ship plug is equipment like any other:`；**仍是三段**（该表按行数对齐，行数不符会整段回落中文） |

**英文措辞的依据**：本仓英文口径里「装备」= **module / equipment**（`docs/glossary-en.md` 第 58 行「装备库 → Module Storage」；`apps/desktop` 导航与市场一级类型用 `Equipment`）⇒ 取 `equipment like any other` 承接原句的"和…一样"结构。

## 4. 行为变化 / 影响面

- 纯文案：零机制、零数值、零存档字段、零迁移。老档与已读过的档不受影响（通讯正文渲染时读数据表，重建后重看即为新句）。
- **无英文覆盖的其它落点核过一遍**：同篇没有别处提"谜质"；插件族的说明与日志（`core.equipment.030` / `core.plug.*` / `ui.FitPage.*`）本来就没拿谜质打比方。

## 5. 验证（2026-10-01）

- `npm run content:check` ✅ 内容体检通过（无死引用、无新增告警）。
- `npm run l10n:check` ✅ 无死引用 · 占位符对齐 · 无残留中日韩字符（读数里 `commsText.ts` 的未译条数是"中文即键的简介表"既有读数，与本批无关）。
- `npm run l10n:params` ✅ 明确漏喂 0 处。
- `npm run typecheck` ✅ core / data / ui / desktop 四包全绿。
- `ui:rot-check` 未跑：没碰界面结构与样式，改的是数据表里的字符串（§十四 适用面之外）。

## 6. ⟪文案调整台账⟫（§十三）

| 日期 | id / 位置 | 原 → 新 | 依据 |
|---|---|---|---|
| 2026-10-01 | `msg-blackbox-plug-unlock` body[1]（中文 `packages/data/src/messages.ts` · 英文 `apps/desktop/.../ui/commsText.ts` 的 `COMMS_BODY_EN`） | 「插件**和谜质一样**」→「插件**和装备一样**」；英文 `A ship plug is a device as remarkable as Enigma.` → `A ship plug is equipment like any other:` | 船长原话（见 §1，照抄） |

## 7. 待裁决点

1. **英文改动要不要保留**：船长原话只点了中文；我按"玩家可见文案中英双语"（`AGENTS.md` §1）一并改了英文。若要改回或换说法，说一声。
2. **提交与合入**：本工作树当前有另一批在途改动（`IndustryPage.tsx` / `core/marks.ts` / `core/save.ts` / `core/state.ts` / `marks.test.ts` / `l10n/table.ts` / `docs/INDEX.md` / `lab-card-jump-20260930.md` / `tools/_probe-lab-jump.mts`）⇒ 本批三个文件**未提交**，等船长定：单独提交本批，还是等实验室那批一并走。

## 8. 违规与整改记录（自查，2026-10-01）

- **违规**：第一次落地时，我把台账写进了 **`docs/design/copy-audit-20260930.md`（旧工作文档）**，违反 §十五 第 2 条「工作期间只改这份工作文档」与 `AGENTS.md` §8（起因同 §二「汇报与文档纪律」里 2026-09-27 那次）。
- **整改**：`git restore -- docs/design/copy-audit-20260930.md` 还原（已核该文件不再含本次痕迹）＋ 按 §十五 第 1 条新建本文件 ＋ 把台账挪进 §6，代码注释里的指向也一并改指本文件。
