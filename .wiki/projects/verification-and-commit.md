---
id: verification-and-commit
title: 验证检查与提交纪律
category: projects
tags: [concept, workflow]
summary: 专项测试与全量回归的分工、固定检查矩阵、提交钩子四项技术与 B 类审批、构建冒烟与真档保护的操作索引。
tier: supporting
source: docs-distill:verification-and-commit
confidence: extracted
created: 2026-11-02T13:58:22.734Z
updated: 2026-11-02T13:58:22.734Z
---

> 知识地图摘要页：权威原文以 Sources 为准。

## 用途

把「改完怎么证明没坏」「提交前钩子会拦什么」「B 类审批怎么拿」三件事收在一页。命令以 `package.json` scripts 与开发约定正文为准；流程许可仍走 [[collab-gates]]。

## 结论先行

- 每组修改跑受影响专项；整库 `npm run test -w @whale/core` 只在全部修改确认、船长明确开始集中验收时跑。
- 固定检查：`typecheck`、`content:check` 必须过；UI/样式加 `ui:rot-check`；l10n、随档、数值按影响各跑对应工具。
- 提交钩子的四项技术检查（typecheck/content:check/l10n:check/ui:rot-check）不能跳过，`--no-verify` 禁用。
- B 类审批只放行「人已批准」，不放行技术失败；审批绑定精确暂存树，变了就失效。

## 专项 vs 全量回归

| 时机 | 跑什么 | 说明 |
|---|---|---|
| 每组修改后 | 受影响的专项测试 | 便于及时定位失败 |
| 行为改动 | 同步增改确定性用例 | 行为变了就要有用例跟着变 |
| 全部修改确认 + 船长明确开始集中验收 | `npm run test -w @whale/core` | 跨功能回归 |
| 最终验收/发布 | 必须含整库回归 | 专项不能替代全量 |

`npm run test` 本身映射到 `@whale/core` 的测试脚本，见 `package.json:21`。

## 固定检查矩阵

| 检查 | 命令 | 触发时机 | 备注 |
|---|---|---|---|
| 类型 | `npm run typecheck` | 每次固定 | 覆盖 core/data/ui/desktop 四个包 |
| 内容/文案 | `npm run content:check` | 每次固定 | 纯净、原因解释、跨件对比等护栏；不能替代人工审核 |
| UI/样式 | `npm run ui:rot-check` | 改 UI 或样式 | 串联 rot、TDZ、订阅、属性四个检查脚本；不能描述成只读 CSS |
| 本地化 | `l10n:check`/`l10n:list`/`l10n:params`/`l10n:core-zh` | 动玩家文本、参数槽或语言表 | 数组常量与先拼变量仍需夹具人工核 |
| 本地化渲染 | `l10n:render` | 改 `composeParts` 或 `paramsFor` | 参数契约必须过实际渲染 |
| 随档字段 | `save:roundtrip-audit` | 新增/修改随档字段 | 同时维护写入点与 `normalizeState` 白名单 |
| 存档迁移 | `save:migrate` | 结构或存档格式变化 | 配合冒烟与存档往返 |
| 数值/经济 | `npm run balance`、`npm run balance:chains` | 动收益、耗时、市场、任务次数链 | 按影响选段，用当前数据重算 |
| 架构 | `npm run arch:guard` | 动分层、单点、取数入口 | 存量直读白名单须有理由 |
| 范围 | `npm run scope:check` | 交付前自查 | 只提示文件范围，不阻断也不替代跨域批准 |
| 构建 | `npm run build` | 结构改动 | 类型通过不等于产物能启动 |

## 提交钩子与 B 类审批

钩子固定执行四项技术检查：`typecheck`、`content:check`、`l10n:check`、`ui:rot-check`；任意失败拒绝提交，批准压不过技术错误。

取得 B 类审批的顺序：

1. 先在聊天中获得船长明确批准，记录本批用途、精确文件范围、风险与批准原话。
2. 整理暂存区：已跟踪工作文件必须与暂存内容一致，避免检查读到另一版代码。
3. `npm run commit:approval -- status` 查看需裁定范围。
4. `npm run commit:approval -- approve --reason "<批准依据>" -- <路径...>`（或 `node tools/git-gate-approval.cjs approve ...`）；路径逐个列出，禁止通配符或无关路径。
5. 正常 `git commit` 或 `npm run commit:msg`；不要 `--no-verify`。

| 约束 | 内容 |
|---|---|
| 审批文件 | 当前工作树 Git 目录下的 `whale-gate-approval.json`，不入库、不写个人存档 |
| 绑定对象 | 工作树、分支、HEAD、合并父提交、完整暂存树、精确批准路径 |
| 失效条件 | 暂存内容、分支、基线或工作树变化即失效；重新登记前须重新核对人的授权 |
| 消费时点 | 技术检查成功后记录待提交回执，`post-commit` 核对实际提交树与父提交再消费；失败可按原批准重试 |
| 撤销 | `npm run commit:approval -- revoke` |
| 性质 | 流程检查，不是身份认证或防伪造的安全边界；真实人类批准仍必需 |

回归用例：`npm run test -w @whale/core -- git-gate-approval-20261004.test.ts`，在独立临时 Git 仓库验证失效、拒绝、范围不完整、合并豁免、技术失败阻断与成功消费，不读个人档。

## 构建、冒烟与存档迁移

- 结构变化跑构建，并按正文做对应目标的冒烟与存档检查；类型通过不代表产物能启动或存档能往返。
- 新增随档字段同时维护写入点与 `normalizeState` 白名单，再跑 `save:roundtrip-audit` 及相关穷尽用例；手工重建对象会丢未登记字段，破坏进度与去重账。
- 不覆写船长正在玩的真档；需要改档时先备份或另写新文件。测试优先独立合成，确需基于真档先获准并备份，输出另文件。
- 玩家报障用玩家提供的条件、代码与确定性用例复现，不拿船长真档替代。

## 真档、探针与后台任务

| 场景 | 规则 |
|---|---|
| 个人真档 | 只读或先备份；不写入、不当作可丢弃的夹具 |
| 测试档命名 | `test-save-<feature>-<stamp>.json`，说明写清备份、退出、替换、恢复 |
| 临时探针 | `_` 前缀；一次性的收尾删除，有复用价值转 `tools/` 正式入库 |
| 他人的探针 | 不处理、不删除 |
| 后台任务 | 连续两分钟无新输出时查日志与进程，收尾写清遗留任务 |
| 进程清理 | 只关自己能以 PID 证明归属的进程；端口归属不明保留并报告 |

## 常见误区

- 只跑专项就宣称可以发布。
- 用「船长已批准」替代失败的 `typecheck`/`content:check`。
- 改了随档字段但没进 `normalizeState` 白名单。
- 改 UI 只跑类型检查，不跑 `ui:rot-check`。
- 审批后继续改文件，却不重新登记批准范围。
- 把浏览器读数当成船长观感验收。

## 相关页

- 协作流程、四步闸门与跨域申请：[[collab-gates]]
- 文档阅读、生成索引与归档：[[docs-system]]

## Sources

- `AGENTS.md:32-37`（§2.1 改动范围：模块内优先）
- `AGENTS.md:39-45`（§3 验证闭环）
- `AGENTS.md:47-55`（§4 工作区与合入纪律）
- `AGENTS.md:88`（观感验收与浏览器取证边界）
- `AGENTS.md:104-106`（§9 测试门槛存档）
- `docs/development-conventions.md:14-25`（第二章 思考与工作过程约定）
- `docs/development-conventions.md:55-60`（第八章 测试门槛存档约定）
- `docs/development-conventions.md:86-90`（第十章 工具纪律）
- `docs/development-conventions.md:100-107`（十一之三 id映射本地化）
- `docs/git-gate-approval.md:5-13`（使用顺序）
- `docs/git-gate-approval.md:15-23`（约束）
- `docs/git-gate-approval.md:25-27`（回归）
- `package.json:21-22`（test、typecheck）
- `package.json:23-24`（balance、balance:chains）
- `package.json:28-30`（content:check、arch:guard、scope:check）
- `package.json:15`（build）
- `package.json:35-36`（save:migrate、save:roundtrip-audit）
- `package.json:86`（ui:rot-check）
- `package.json:116`（l10n:check）
- `package.json:118-120`（l10n:list、l10n:wrap、l10n:render）
- `package.json:140-141`（l10n:core-zh、l10n:params）
- `package.json:131-132`（commit:msg、commit:approval）

