---
id: data-content-editing
title: 数据与内容编辑入口
category: references
tags: [index, data]
summary: 静态参数与内容的编辑入口地图：数据速查页指路、数据编辑器与内容工作台的边界、校验命令，以及改完必跑的检查。
tier: supporting
source: docs-distill:data-content-editing
confidence: extracted
created: 2026-11-02T14:00:15.978Z
updated: 2026-11-02T14:00:15.978Z
---

> 知识地图摘要页：权威原文以 Sources 为准。

**结论先行**：改静态参数分三步——按 ID 定位权威字段、用数据编辑器或内容工作台改、按清单跑检查。源数据以仓库中受版本管理的静态 JSON 与 TS 为准，**工作簿、CSV 与派生快照都不是第二份参数来源**。

## 一、三个入口的分工

| 入口 | 文档 | 定位 |
|---|---|---|
| 数据速查页 | `docs/data-map.md` | 只指路：权威字段在哪、连带改什么、验证命令是什么 |
| 数据编辑器 | `docs/data-editor.md` | 图形界面改静态数值，带预览、隔离检查与事务备份 |
| 内容工作台 | `docs/content-workbench.md` | 在 Excel/WPS 改存量内容，再由工具按主键写回权威源 |

关系是「一张路标 + 两种编辑手段」，不是三套数据源。

## 二、数据速查页：指路页不是正文

- 只定位当前权威字段、连带修改和验证入口，不要求通读全仓或旧记录（`docs/data-map.md:3`）。
- 标准动作：按 ID 定位权威字段 → 检查说明与界面是否重复写数 → 跑 `content:check`、类型与受影响专项（`docs/data-map.md:5-11`）。
- 静态 JSON 存舰船、装备、插件、物品、商品及已接入敌方源数字；未迁移的表、公式、名称与文案仍在 TS。**派生快照不能成为第二份参数来源**（`docs/data-map.md:7`）。
- 说明与界面不写数值副本：新文案只保留定性，数字由 `ui/shipInfo.tsx` 等同源参数行显示（`docs/data-map.md:8`）。
- 普通参数修改不要求通读全部消费方；新增字段或机制才需核实实际接线（`docs/data-map.md:11`）。
- 同一字段的效果、预算、显示与保存路径先查 `docs/single-source.md`（`docs/data-map.md:37`）。

## 三、数据编辑器：只改数值，不动结构

**定位**：编辑静态参数的开发工具，不改玩家存档或已安装游戏（`docs/data-editor.md:3`）。

| 维度 | 边界 |
|---|---|
| 可改 | 舰船、装备、插件、物品/无人机、直接商品，以及已接入的敌舰、敌机、挂载、悬赏、入侵与信号空间源数字（`docs/data-editor.md:18`） |
| 不可改 | 新增、删除、重排条目，或修改 ID、文本、引用、结构、舰型与机制开关（`docs/data-editor.md:18`） |
| 保存方式 | 多选对比、批量设值先预览再应用；非法一项不部分应用，撤销重做只改草稿（`docs/data-editor.md:14`） |
| 保存前 | 隔离候选跑四包类型、内容及完整 core 检查；失败保留草稿、不写 JSON，无强制保存（`docs/data-editor.md:15`） |
| 备份 | `tools/_data-editor/backups/<事务ID>/`；恢复先核对全部目标哈希（`docs/data-editor.md:16`） |
| 来源 | `packages/data/src/static/{ships,modules,plugs,items,market}.json` 与敌方源数字 JSON；`staticFieldTypes.json` 是字段形状契约而非数值副本（`docs/data-editor.md:26-28`） |

- 权限：可信同仓附属工作树可编辑，主树、main/master 与游离 HEAD 只读；不运行未知项目脚本、不静默装依赖（`docs/data-editor.md:9`）。
- 已登记的便携版 0.1.2 内置来源契约未覆盖后来新增的敌舰字段，会安全拒载新版项目——需更新独立构建，**不可忽略未知字段或放宽校验**（`docs/data-editor.md:8`）。
- 开发源码在 Git 外的独立目录（本机为 `H:\大鲸鱼\数据编辑器`，路径随机器可能不同），但仍依赖游戏来源树的共享工具，迁出 Git 不等于完全独立（`docs/data-editor.md:7`、`docs/data-editor.md:31`）。
- 数据不进 SQL、JSON 不存最终战斗快照；原数值标定与守护用例继续有效，不能靠删测试解除（`docs/data-editor.md:31`）。

## 四、内容工作台：表格只是编辑副本

**定位**：在 Excel/WPS 编辑存量内容，再由工具按主键写回权威源（`docs/content-workbench.md:3`）。

- 工作簿含 skills、items、modules、ships、anomalies、belts、market 七张表，表内数量按当前目录现算（`docs/content-workbench.md:14`）。
- 首列 id 或市场 key 只读；未知、新增或缺失条目拒绝导入（`docs/content-workbench.md:20`）。
- 空格语义相反：导出空格＝未设置，导入空格＝保留原值，填 `-` 才删除，`0` 是显式数值（`docs/content-workbench.md:23`）。
- 导入先检查主键、枚举、范围、引用与删除语义，再执行变更；收尾打印差异摘要（`docs/content-workbench.md:30`）。
- 已迁移字段写静态 JSON，未迁移字段写原 TS，按主键与字段作最小差异、保留无关注释与布局（`docs/content-workbench.md:28`）。

**重导前先核对未导入编辑**：先导入、另存或写到新目录，不能用源重导覆盖草稿（`docs/content-workbench.md:16`）。

## 五、命令入口

| 用途 | 命令 | 出处 |
|---|---|---|
| 四包类型 | `npm run typecheck` | `package.json:22` |
| 内容契约与效果接线 | `npm run content:check` | `package.json:28` |
| 导出编辑副本 | `npm run content:export` | `package.json:50` |
| 写回权威源 | `npm run content:import` | `package.json:54` |
| 编辑器开发 / 构建 / 打包 / 测试 | `data:editor`、`data:editor-build`、`data:editor-pack`、`data:editor-test` | `package.json:55-58` |
| 搬表等价验收 | `npm run data:migration-check` | `package.json:59` |
| 数值平衡巡检 | `npm run balance`、`balance:chains`、`balance:mine-refine` | `package.json:23-25` |
| 伤害类型配色 | `npm run ui:dmg-color`（也在 `ui:theme-check` 内） | `package.json:97`、`package.json:104` |
| 本地化 | `npm run l10n:check` | `package.json:116` |
| 界面静态契约 | `npm run ui:rot-check` | `docs/data-map.md:28` |
| 文档索引 | `npm run docs:index` | `docs/data-map.md:33` |

## 六、改完必跑的检查

1. `npm run content:check` —— 内容契约与效果接线，任何数据条目改动都跑（`docs/data-map.md:9`、`docs/data-map.md:25`）。
2. `npm run typecheck` —— 四包类型（`docs/data-map.md:24`）。
3. 受影响专项用例 —— 核心包 Vitest 按文件筛选；全量 core 回归留到集中验收（`docs/data-map.md:26`）。
4. 数值/经济体系变动 —— 按确认方案跑校准；已标定关系被改动时复核数值与守护用例，**不能删断言换绿**（`docs/data-map.md:9`、`docs/data-map.md:17`）。
5. 玩家可见文案改动 —— `npm run l10n:check`，参数或渲染改动再跑对应专项（`docs/data-map.md:27`）。
6. 伤害类型相关 —— `npm run ui:dmg-color`（`package.json:104`）。
7. 结构或构建改动 —— 跑构建，并做冒烟与存档迁移检查（`docs/data-map.md:29`）。

检查失败先核对实际文件与工具备份，**不以失败退出码推断所有写入一定回滚**；提交前人工检查 `git diff`（`docs/content-workbench.md:30`）。数据随构建生效，不热换已安装游戏或进行中的战斗、订单（`docs/data-map.md:11`）。

## 七、相关页面

- 运行态与落盘：[[save-architecture]] —— 存档只接受当前结构版本，数据改动不是改档手段。
- 项目总览：[[project-overview]]
- 术语口径：[[glossary-terms]]
- 待办与未决：[[roadmap-open-items]]

## Sources

- `docs/data-map.md:3`（引言：只定位、不通读）
- `docs/data-map.md:5-11`（一、标准动作）
- `docs/data-map.md:13-18`（二、连带检查）
- `docs/data-map.md:20-33`（三、命令入口）
- `docs/data-map.md:35-37`（四、取数边界）
- `docs/data-editor.md:3`（定位说明）
- `docs/data-editor.md:5-9`（启动与权限）
- `docs/data-editor.md:11-22`（编辑、预览与保存）
- `docs/data-editor.md:24-31`（数据来源）
- `docs/data-editor.md:33-44`（生效与检查）
- `docs/content-workbench.md:3`（定位：工作簿不是第二份数据源）
- `docs/content-workbench.md:5-16`（导出与导入）
- `docs/content-workbench.md:18-24`（列与边界）
- `docs/content-workbench.md:26-30`（写回与检查）
- `docs/content-workbench.md:32-34`（分类用语）
- `package.json:22-59`（scripts：typecheck / balance* / content:* / data:editor* / data:migration-check）
- `package.json:97-104`（ui:theme-check、ui:dmg-color）
- `package.json:116`（l10n:check）

