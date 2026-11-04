---
id: docs-system
title: 文档体系与阅读纪律
category: projects
tags: [index, docs]
summary: 本仓库文档的分层、开工阅读顺序、生成索引、旧记录禁读与设计稿/术语/英文延期入口的一页导航。
tier: supporting
source: docs-distill:docs-system
confidence: extracted
created: 2026-11-02T13:58:31.792Z
updated: 2026-11-02T13:58:31.792Z
---

> 知识地图摘要页：权威原文以 Sources 为准。

## 用途

回答三个问题：开工先读哪几份、哪些文档能读、文档写在哪和何时归档。规则原文见 `AGENTS.md` §0.1、`docs/catalog.md` 与开发约定第十五章；本页只做索引。协作与提交流程见 [[collab-gates]]，检查命令见 [[verification-and-commit]]。

## 结论先行

- 顺序固定：`AGENTS.md` → `docs/catalog.md` → 相关规则/设计稿 → 代码现状。
- `docs/INDEX.md` 是 `npm run docs:index` 生成的清册，禁止手改。
- 旧记录默认禁读：`docs/archive/`、`docs/design/archive/` 及同类历史留档；普通开发、续接、历史链接都不构成授权。
- 目录和索引只解决「去哪找」，不授予实施权限；方案是否有效要核对确认状态、后续裁定与当前代码。

## 文档分层

| 文档 | 职责 | 维护方式 |
|---|---|---|
| `AGENTS.md` | 开工执行入口、速查 | 仅船长明确指示时改 |
| `docs/catalog.md` | 按任务指路 | 人工维护导航 |
| `docs/INDEX.md` | 现行文档机器清册 | `npm run docs:index` 生成，不手改 |
| `docs/development-conventions.md` | 现行协作正文与执行细节 | 按规则维护时点更新 |
| `docs/design/<主题>-<日期>.md` | 本批工作文档 | 开工建，验收合入后归档 |
| `docs/archive/`、`docs/design/archive/` | 历史留档 | 默认禁读，按明确授权查阅 |
| `docs/glossary.md` | 中文术语与机制名 | 新术语当天登记 |
| `docs/glossary-en.md`、`docs/l10n-pending.md` | 已获授权英文与延期登记 | 船长启动英文后维护 |
| `docs/git-gate-approval.md` | B 类提交审批 | 见 [[verification-and-commit]] |
| `docs/roadmap.md` | 当前待办与续接 | 只记当前事项，不存批次流水 |

## 开工阅读顺序

1. 读 `AGENTS.md`：执行入口，先知道硬约束。
2. 读 `docs/catalog.md`：按任务挑文档，不整套通读。
3. 按任务读相关规则（多数落在 `docs/development-conventions.md` 的具体章）与设计稿。
4. 查代码现状：目录缩小范围，代码核实文档是否仍适用。

首次接手或大工程通读约定正文；续接后若缺规则上下文，重读入口与目录。发现入口与正文冲突，报告船长并同步两处，不形成第二套口径。

## 生成索引 INDEX

- 生成命令：`npm run docs:index`（`tsx tools/docs-index.ts`，见 `package.json:127`）。
- `docs/INDEX.md` 是机器生成的现行文档清册，禁止手改；归档后重跑一次，避免清册漂移。
- 索引只保证「找得到文件」，不保证方案已批准或仍现行；不能用索引结果替代设计稿确认状态与代码核对。
- 生成件与人工导航分工：`catalog.md` 负责「按任务指路」，`INDEX.md` 负责「有哪些文件」。

## 旧记录默认禁读

禁读范围：`docs/archive/`、`docs/design/archive/`，以及其他标为历史留档的正文。

| 问题 | 规则 |
|---|---|
| 日常开发能读吗 | 不能；没有船长明确查阅要求时禁止阅读、检索、批量扫描、自动载入 |
| 能用 Git 历史绕过吗 | 不能 |
| 普通开发/修复/续接/历史链接算授权吗 | 不算 |
| 获准后怎么读 | 只查指定主题或文件，结束即恢复禁读 |
| 资料不足怎么办 | 记录缺口，由船长决定是否查旧记录 |
| 归档维护 | 可按明确清单复制、校验字节、登记路径，不因维护自动通读 |

默认检索命令（在读取前排除旧记录）：

```text
rg --glob '*.md' --glob '!**/archive/**' <关键词> docs
```

禁止「先扫全部正文再过滤结果」：搜索命中本身也会读到历史内容。

## 设计稿与归档流程

| 阶段 | 动作 |
|---|---|
| 开工 | 建 `docs/design/<主题>-<YYYYMMDD>.md`，写状态、经办/分支/日期、船长原话、范围/不做、待裁决项 |
| 工作期间 | 只改本批工作文档与代码/数据/测试；旧设计与权威文档留到收口 |
| 例外 | 规则维护、新术语、目录、单点索引与生成件按其更新时点维护，不被「归档再改」阻塞 |
| 验收合入后 | 有效结论并入现行文档；过程原文移入 `docs/archive/` 并从常用文档移除；重跑 `npm run docs:index` |
| 未决事项 | 在现行文档保留摘要，不把整段过程留在入口 |
| 现行性判断 | 按内容与实现状态判断，不按文件日期或是否已实现一刀切 |

## 术语与英文延期入口

| 需求 | 入口 |
|---|---|
| 查中文术语/机制名 | `docs/glossary.md`（[[glossary-terms]]） |
| 登记新术语 | 确认当天写定义、来源与状态；存疑先查 |
| 术语与设计稿冲突 | 核实现行代码与船长裁定，并同步文档 |
| 准备英文 | 必须船长明确启动；中文确认、实现、合入、发布都不自动授权 |
| 未准备英文 | 写 `en: ''`、`enDeferred: true`，登记 `docs/l10n-pending.md`，保留已有英文 |
| 已启动英文 | 按 `docs/glossary-en.md` 审核稿补译、清延期标记；需原样保留的代码串声明 `l10n-keep` |
| 未完成功能 | 不进本地化排队；留 `⟪未完成 YYYY-MM-DD⟫` 与恢复入口，roadmap 挂账 |

## 目录与索引的权限边界

- 能查到方案 ≠ 方案已获批准或仍然有效；设计稿要核对确认状态、后续裁定与当前代码。
- `docs/catalog.md` 与 `docs/INDEX.md` 都不授予实施权限，也不解除旧记录禁读。
- 常用文档只留现行规则、定义、实现入口和未决事项；本批过程先写工作文档，收口再归档。
- 设计稿是否现行按内容与实现状态判断：还在实施、待裁决或承载现行契约的设计继续保留。

## 常见操作与边界

| 场景 | 做法 |
|---|---|
| 不知道读哪份 | 先 `catalog.md` 按任务行选，再查 `INDEX.md` |
| 搜关键词 | 用默认 `rg ... --glob '!**/archive/**'`，不先全扫 |
| 发现文档与代码不一致 | 核实现行实现、记录差异；资料不足不自行解禁历史 |
| 需要改索引 | 重跑 `npm run docs:index`，不手工编辑 `INDEX.md` |
| 要改 `AGENTS.md` | 仅船长明确指示；变更同时登记 changelog |
| 想引用旧方案 | 先确认是否获准查阅，且旧方案仍须重新确认才能实施 |
| 归档后 | 结论进现行文档，过程进 `docs/archive/`，重跑索引 |

## Sources

- `AGENTS.md:3-4`（入口定位、修改权限与 changelog）
- `AGENTS.md:6-9`（§0 开工顺序）
- `AGENTS.md:11-16`（§0.1 文档目录）
- `AGENTS.md:24-25`（§1 英文与术语入口）
- `AGENTS.md:97-102`（§8 工作文档与归档）
- `docs/catalog.md:1-4`（文档目录：指路与禁读）
- `docs/catalog.md:6-11`（工作入口）
- `docs/catalog.md:13-32`（按任务查阅）
- `docs/catalog.md:34-40`（维护）
- `docs/development-conventions.md:41-47`（第五章 检索纪律）
- `docs/development-conventions.md:49-53`（第七章 沟通与语言）
- `docs/development-conventions.md:92-94`（第十一章 术语词典纪律）
- `docs/development-conventions.md:96-98`（十一之二 本地化排队）
- `docs/development-conventions.md:100-107`（十一之三 id映射本地化）
- `docs/development-conventions.md:134-140`（第十五章 工作文档与归档）
- `package.json:127`（docs:index）

