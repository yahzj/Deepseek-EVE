---
id: pitfall-index
title: 踩坑经验索引（docs 蒸馏批次）
category: references
tags: [index, pitfall]
summary: docs 踩坑蒸馏批次索引：9 个主题页导航、与现行结论页关系、使用建议；还原点 2026-11-04T10-29-45-488Z
tier: supporting
source: docs-distill:pitfall-index
confidence: extracted
created: 2026-11-04T10:46:32.947Z
updated: 2026-11-04T10:46:32.947Z
---

# 踩坑经验索引

> 本页是 docs 踩坑与经验提炼批次的索引，**非现行规则**；与 `AGENTS.md`、`docs/development-conventions.md` 或代码冲突时，以现行文件与代码为准。各主题页为经验记录，归档来源已标「历史」。

## 这个批次是什么

`docs/`（含获准查阅的归档区）里散落着大量报障修复、审计体检、事故收尾、校准读数、发布工具链与协作 review 的过程记录。这些记录里的**根因、规避手法与复发检查点**比过程本身更有长期价值，因此按主题蒸馏为 9 页踩坑经验页，统一：

- 每坑写「现象 / 根因 / 解法或规避 / 复发检查点 / 来源（路径:行号）」；
- 结论先行，只保留可复用的经验，不搬运过期方案与旧数值；
- 与 `.wiki` 已有架构、协作、文档、数据类页面互链，形成「经验 → 现行规则」的导航。

## 九页总览

### 玩法系统

- [[pitfall-combat-fleet]] — 战斗与舰队：敌舰、舰船、无人机、装备插件、编队、命中射程、战损与平衡校准。
- [[pitfall-wormhole-signal]] — 虫洞与信号空间：遗迹、星图扫描、跃迁燃料、信标、打捞残骸、运输遇袭。
- [[pitfall-industry-economy]] — 工业与经济：精炼、制造、实验室、市场与黑市、价格、赏金声望、运输。
- [[pitfall-stock-exchange]] — 证券交易所：做空、撮合、行情与事件驱动，含联调部署经验。

### 表现与文案

- [[pitfall-ui-ux-perf]] — UI/UX 与性能：HUD、布局、字体、悬停、动画、刷新、移动端与桌面背景。
- [[pitfall-l10n-copy]] — 本地化与文案：术语、占位符、通讯、公告、英文延期与文案审核。

### 数据与工程

- [[pitfall-save-data]] — 存档与数据：迁移、导入导出、云存档、离线结算、白名单与真档保护。
- [[pitfall-tooling-release]] — 工具链与发布：构建、测试闸门、提交钩子、Git 多工作树、Electron、Steam 与整合。
- [[pitfall-collab-docs]] — 协作与文档：交接、工作文档、归档与旧记录、规则维护、评审与事故复盘。

## 与现行结论页的关系

- 经验页记录「为什么踩过、怎么绕过」，**不替代**现行规则；现行结论请看：
  - [[collab-gates]] — 确认闸门与风险分档。
  - [[verification-and-commit]] — 验证闭环与提交纪律。
  - [[docs-system]] — 文档目录、索引与归档体系。
  - [[save-architecture]] — 存档结构与迁移边界。
  - [[data-content-editing]] — 数据/内容编辑流程。
  - [[project-overview]] — 项目总体结构与域划分。
  - [[glossary-terms]] — 术语表。
  - [[roadmap-open-items]] — 路线图开放项。
  - [[human-centered-design]] — 人本设计原则。
  - [[whale-stock-market-architecture]] — 证券交易所架构。

## 使用建议

1. 遇到报障/回归，先按主题页的「复发检查点」自查，再看现行规则与代码。
2. 新增踩坑记录时，优先补进对应主题页的「复发检查点」，而不是另开流水文档。
3. 引用本批页面时请保留「历史来源」标注；旧数值不得当作现状。

## 来源

- `docs/` 及获准查阅的 `docs/archive/`、`docs/design/archive/`（蒸馏批次：2026-11-04，高价值优先覆盖约 100 篇精读 + 全库粗筛）。
- 还原点：`.wiki` 入库前快照 `2026-11-04T10-29-45-488Z`。
