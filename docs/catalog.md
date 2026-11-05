# 文档目录

> 本页负责按任务指路；`docs/INDEX.md`是机器生成的现行文档清册。
> 旧记录集中在`docs/archive/`与`docs/design/archive/`。**没有船长明确的查阅要求，平时工作禁止阅读、检索、批量扫描或自动载入旧记录，也不得转查Git历史绕过。**历史链接、普通开发请求和会话续接不授予查阅权限。

## 工作入口

1. 读`AGENTS.md`，再按本页选择当前任务需要的文档。
2. 默认搜索：`rg --glob '*.md' --glob '!**/archive/**' <关键词> docs`。不要先搜旧记录再过滤输出。
3. 当前资料与代码不一致时核对现行实现、记录差异；资料不足不能自行解禁历史。
4. 只有船长明确要求查阅历史时，才在指定主题或文件范围内查看；历史内容仍不是新的实施授权。

## 按任务查阅

| 任务 | 当前入口 |
|---|---|
| 开工、协作、验证、提交 | `AGENTS.md`、`docs/development-conventions.md` |
| 版权、AI授权提示与发布声明 | 根目录`LICENSE.txt`、`tools/release-rights/README.md` |
| 当前待办与续接 | `docs/roadmap.md` |
| 架构与存档边界 | `docs/architecture.md` |
| 定位某件事的唯一实现 | `docs/single-source.md`、`tools/arch-guard.ts` |
| 中文术语、机制名 | `docs/glossary.md` |
| 已获授权的英文工作 | `docs/glossary-en.md`、`docs/l10n-pending.md` |
| 静态参数与内容编辑 | `docs/data-map.md`、`docs/data-editor.md`、`docs/content-workbench.md` |
| 页面、表现与动画 | 开发约定§九、§十四，再读本域实现与对应现行设计稿 |
| 深空证券交易所（极简双向/专业重构/标准K线） | `docs/design/deep-space-exchange-pro-refinement-20261103.md`；现行设计稿与视觉/交互规范 |
| 设置子页面分类 | `docs/design/settings-subpages-20261103.md`；仅重组现有设置项，实施期间为现行工作稿 |
| 账号与手动云存档设置 | `docs/design/cloud-settings-20261103.md`；本批仅本地合入、不推送；端到端桌面 smoke、全量回归、观感验收未完成，首次注册令牌撤销尚未验证；公网 HTTPS 入口 2026-11-05 起走 8443（见下条） |
| 云端入口 8443（绕过腾讯云未备案拦截） | `docs/design/cloud-8443-20261105.md`；现行部署拓扑、验证读数与回滚方式 |
| 独立在线聊天 | `docs/design/online-chat-20261103.md`；独立导航、只显示聊天记录与在线总人数，桌面/网页端本机验证已完成；后端增强在 `H:\大鲸鱼\deepseek-EVE-Background\docs\chat-deploy-handoff-20261103.md`，待玩家验收与服务器部署联调 |
| 本地市场异步玩家订单 | `docs/design/player-market-relay-20261104.md`；本地NPC市场优先、抽样转发玩家订单，代码已本地接入；独占商品资格、参考价和验证见`docs/design/player-market-exclusive-20261105.md`；未推送或部署，真实双客户端联调待完成，不改普通/铁人模式与导入导出 |
| 数值与经济 | 开发约定§一、§二，对应设计稿及校准工具 |
| 玩家文案与公告 | 开发约定§十一、§十二、§十三；公告待审稿未经批准不落库 |
| 第二阶段空间站 | `docs/design/human-revival-station.md`看既有框架 → `docs/design/human-revival-station-research-20261018.md`看总览摘要与六份主题稿；玩家站仍仅设计，未决方案不能当已实现 |
| 第三方审查跟进 | `docs/review/guoqing-audit-followup.md`；旧报告需船长点名查阅 |
| 复现门槛与合成档 | `docs/test-saves/README.md`及该功能说明 |
| B类提交审批 | `docs/git-gate-approval.md` |
| 找当前文档 | `npm run docs:index`生成的`docs/INDEX.md`；索引不授予实施或历史阅读权限 |

## 维护

- 常用文档只留现行规则、定义、实现入口和未决事项；不再累积批次流水、旧参数、验收读数与交接过程。
- 本批过程先写`docs/design/<主题>-<日期>.md`。收尾时将有效结论并入现行文档，原过程移入旧记录目录，从常用入口移除；未决事项留下摘要。
- 历史档案只在明确查阅授权内读取。归档维护可按明确清单复制、校验字节和登记路径，不因维护而自动通读既有档案。
- 设计稿是否现行取决于内容和实现状态，不按文件日期或是否已实现一刀切；尚在实施、待裁决或承载现行契约的设计继续保留。
- `docs/development-conventions-changelog.md`只记录当前规则维护入口；历史变更流水归旧记录区，不列为日常必读。
