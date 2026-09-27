# 开发流程规范：取数与派生纪律 ＋ 第 20 道护栏 `arch:guard`（2026-09-27 · 三号 verify）

> **状态：进行中**（三号 · 分支 `verify` · 2026-09-27）
>
> **船长原话（照抄）**：
> ① 「**现在的开发流程挺混乱的，各种代码都是地方单独调用，我们能否商量下，进行开发流程规范？是否有skill能完成这个？**」
> ② （选型）「**全仓一条线管到底（取数 + 页面 + 工具 + 文档）**」·「**规范文档 + 可执行护栏**」·「**先出清单让你挑，挑中的才改**」
> ③ 「**现有本机的SKILL做不了，你找找有无其他skill能完成**」→ ④ 「**将这3个skill网址贴出，我去看下**」
> ⑤ （定稿）「**照抄它的思路、用本仓的风格写护栏。然后回归到之前的你的建议规范那**」→ 「**按你推荐来，做完后跑一次英文和中文的全量测试下**」
>
> **参照物（只是思路来源，未安装、未执行其脚本）**：
> `pattern-enforcement`（jagreehal/jagreehal-claude-skills）——核心口径 = **「Documentation is a ritual. Rules are enforcement.」**
> 手法 = `no-restricted-imports` 封跨层直读 ＋ 分层方向规则 ＋ **先 warn 后 error 的增量迁移**。

## 范围（本批做什么）

1. **规范**：`docs/development-conventions.md` 新增一章「取数与派生纪律」（三条正文 ＋ 与既有章节的分工）。
2. **索引**：新建 `docs/single-source.md`（单点索引：关注点 · 唯一实现 · 护栏）。
3. **护栏**：新建 `tools/arch-guard.ts` ＋ `npm run arch:guard`（四项检查 F1~F4，本仓风格：只读源码、零新依赖）。
4. **清单**：新建 `docs/review/arch-guard-baseline-20260927.md`（存量重复实现与越层直读清单，供船长挑）。
5. **结果**：规范/索引/护栏/清单 ＋ changelog 一条 ＋ `package.json` 一个 script。

## 不做（本批边界）

- **不动任何业务代码**（零行为变化、零数值、零存档）；存量收口是**第二批**，等船长从清单里点名。
- **不新增依赖**（本仓实测无 `eslint`/`lint`，不引入 ESLint）。
- **不搬第三方 skill 文件**（船长选定"只取思路"）。
- **不改根 `AGENTS.md`**（该文件仅船长特批可改）。
- **本批不合并 main**（前车之鉴：先交船长验收）。

## 与既有护栏的分工（防两套口径打架）

`ui-subs-check.ts` 的 **Check 2「本地化直读契约」已经管了"中文标签表/函数"**（`RACK_LABELS` / `SLOT_LABELS` …，理由＝英文界面会漏中文）。
⇒ `arch-guard` **只管"游戏数据表"**（`SHIPS` / `ITEMS` / `MODULES` / `BLUEPRINTS` / `SKILLS` / `BELTS` / `GALAXIES` / `FOE_SHIPS` …），
**标签类符号一律不重复管**，头部注释写清指回 `ui-subs-check`。

## 待裁决点（要船长定的）

1. 护栏挂法：独立 `npm run arch:guard`（现行做法）／并进 `ui:rot-check` 链。
2. F4（取数口契约：页面必须从 `ctx` 取数）本批做还是缓做。
3. 索引的维护节奏（是否随 §十五 列为"例外清单"里的活文档）。

## 船长裁决与落地结果（2026-09-27 ·「按你推荐来」）

| 项 | 我的推荐 | 落地 |
|---|---|---|
| ① 护栏挂法 | **独立 `npm run arch:guard`**（约 1 秒级，不并链、减少耦合） | ✅ 已是独立 script |
| ② 两组重复收口 | **A1 收（逐字同源）· A2 不收（无重复证据）** | ✅ A1 已收：新建单点 `panels/activityStopLabel.ts`，两套活动栏共用；A2 逐条写明"零逻辑包装／不同用途分叉／全仓唯一实现"⇒ 保留为下一批候选 |
| ③ 474 处可译缺口 | **单独立项**（属本地化工作流，混进本批会把两件事搅在一起） | ⏸ 未做，读数与分类已进 `docs/review/arch-guard-baseline-20260927.md` 第五节 |

**A1 收口后的逐项自检**：单点 id 序列与原两份逐字一致（15 个 `tr()`）· `default` 仍返回空串（未改行为）·
`ActivityBarClassic.tsx`（自称冻结件）在 import 处写明"本批唯一必要改动、文案一字未改、要回退只需复制回 switch" ·
单点已登记进 `SINGLE_SOURCE` ＋ `docs/single-source.md`（F3 核对通过）· 闸门全绿（typecheck · core 243 文件/2657 用例 ·
`arch:guard` 四项 0 · `content:check` · `l10n:check` · `ui:rot-check` · `ui:theme-check`）。

## 实测起点读数（本会话测得，供核对）

- 渲染层 `import … from '@whale/data'` **9 处**；其中**真·直读游戏数据表 0 处**（`engine.ts` 是 ctx 产地，本就该读）。
- 渲染层局部 `*Text/*Label/*Name/*Tip/*Line` helper：**27 处 / 14 文件**（嫌疑池，非全部违规）。
- 同名误报预估：26 个局部 helper 名 × 1565 个导出名 ⇒ **命中 0**（同名式误报≈0，但机器抓不到"异名同义"重复）。
- 闸门耗时基准：`content:check` 2.2s · `l10n:check` 1.0s · `ui:rot-check`(4 件) 2.2s · `typecheck` 12.4s。
