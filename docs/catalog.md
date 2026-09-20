# 文档目录（指路 · 开工先读）

> **这份是什么**：仓库的「按任务类型指路 ＋ 权威文档清单 ＋ 检索查证顺序」。`AGENTS.md` §0 开工顺序里说的
> 「目录」就是本文件——**开工先读它，只读本次任务需要的那几份，不必通读全部文档**。
>
> **与 `docs/INDEX.md` 的分工**：本文件是**手写指路**（该读哪份、按什么顺序读）；`docs/INDEX.md` 是
> **机器生成的全仓清册**（249 份文档的路径 / 标题 / 状态 / 日期 / 体量 / 被引，`npm run docs:index` 重跑、禁手改）。
> 查"有哪些文档"用清册，查"这次该读哪份"用本文件。

## 一、权威文档清单（用途一览）

- `AGENTS.md` — **开工必读**的可执行精简版约定（协作铁律速查版；细则冲突以 `docs/development-conventions.md` 为准并回报船长）。
- `docs/development-conventions.md` — 约定**权威正文**（一~十五章）；第十六章只留变更记录指针。
- `docs/development-conventions-changelog.md` — 约定与 AGENTS.md 的历次变更记录（最新在前；干活不必读）。
- `docs/architecture.md` — 架构与模块边界。
- `docs/glossary.md` — **术语权威**；新术语先登记再用（词条登记属"例外清单"，可随时写）。
- `docs/roadmap.md` — 路线图：**待办活面** ＋ **最近批次滚动窗口** ＋ **封存卷索引**（更早批次在 `docs/archive/`）。
- `docs/INDEX.md` — 全仓文档清册（机器生成，禁手改）；`docs/archive/` — 封存卷（冻结件，只读不改）。
- `docs/design/*` — 各系统设计稿（以 `docs/INDEX.md` 为准）＋ 公告待审稿 `announcement-draft-*.md` ＋ 交接件 `handoff-*.md` / `handover-*.md`。
- `docs/test-saves/` — 可复现测试档说明；`packages/data/src/announcements.ts` — 公告数据（仅经船长批准后写入）。

## 二、按任务类型指路

| 任务类型 | 先读这些（按序） |
|---|---|
| **任何改动** | `AGENTS.md` §2 四步闸门 · §3 验证闭环 · §4 工作区与合入纪律 |
| **记一件工作 / 写文档** | `AGENTS.md` §8（工作文档 → 归档）＋ `docs/development-conventions.md` **§十五**；**先建工作文档，别改旧文档** |
| 改 UI / 页面 / 视觉物件 | `docs/development-conventions.md` **§九**（UI 与视觉一致性）＋ **§十四**（表现层实现与性能纪律）＋ 同级相似界面代码 |
| 改战斗 / 表现层 / 动画 | §九 ＋ §十四 ＋ `docs/design/` 里对应设计稿（如 `drone-combat-animation-20260910.md`） |
| 改数值 / 经济 / 平衡 | §一（闸门）§二（验证）§八 ＋ 对应设计稿 ＋ `tools/*`（校准脚本，如 `battle:calibrate`） |
| 改存档结构 / 迁移 | §八 ＋ `docs/architecture.md` ＋ 只读真档或先备份 |
| 写 / 改玩家可见文案 | §十三（文案纯净与设定）§十一（术语）＋ `docs/glossary.md`；**双语与 id 制见 §十一之三**（新文案**先取 id、再写表**：`packages/data/src/l10n/table.ts`）＋ `docs/glossary-en.md`（英文术语权威） |
| 准备更新公告 | §十二（公告与发布审核）＋ `docs/design/announcement-draft-*.md`（待审稿） |
| 新建 / 收尾工具 | §十（工具纪律：正式入库 / `_` 临时探针收尾处置） |
| 多 agent 并行 / 合入 / 推送 | §三（工作区与合入纪律、推送闸门） |
| 交接 / 续接 / 被压缩后 | §六 ＋ `docs/roadmap.md`（最近批次与状态）＋ 本文件 §三 |
| 查历史决策与旧口径 | `docs/roadmap.md` 底部封存卷索引 → `docs/archive/roadmap-<日期>.md` → `git log -S "<关键词>"` |
| 交付可测存档 | §八 ＋ `docs/test-saves/` ＋ `tools/make-test-save.ts` |

## 三、检索与查证顺序（先查、后精读）

1. **术语 / 名词** → 先查 `docs/glossary.md`（权威；新术语先登记再用；压缩遗忘查词典即可恢复）。
2. **「这功能当时怎么定的 / 做过没有 / 哪份文档管」** → 先查 `docs/INDEX.md`（状态列一眼看出"已确认 / 待裁定 / 未标注"；过期先 `npm run docs:index` 重跑再查）。
3. **查历史决策与旧口径** → `docs/roadmap.md` 底部封存卷索引 → `docs/archive/roadmap-<日期>.md`；再深挖用 `git log -S "<关键词>"`。
4. **开新会话接力** → 先读 `AGENTS.md` → 本文件 → 相关设计稿 → 续接卡 / 变更记录，再动代码。
5. **船长问「下一步 / 新工作流 / 继续做什么」** → 先读 `docs/roadmap.md` 再讨论。

## 四、文档工作流速览（一条线）

- 一件工作 = 建**工作文档** `docs/design/<主题>-<YYYYMMDD>.md`（状态：进行中）→ 工作期间**只改它** → 船长验收 ＋ 合入 main 后**当批归档**（关键内容并入老文档 → **删工作文档** → 重跑 `npm run docs:index`）。
- 例外清单（这几份随时可改）：`AGENTS.md` · `docs/development-conventions.md` · changelog · 词典新术语登记 · `docs/INDEX.md` / 封存卷。
- 细则 = `docs/development-conventions.md` **§十五**。

---

_维护：本文件是"指路目录"，导航变了就更新，属**例外清单**（不受"工作期间不改旧文档"约束）；改动当天顺手重跑 `npm run docs:index`（清册会把本文件收录）。_
