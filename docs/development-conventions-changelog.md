# 开发约定维护记录

> 本页记录当前规则维护，不是开工必读。历史流水已移入`归档区/docs/archive/`；无船长明确查阅要求禁止读取或检索，包括Git历史。

## 2026-11-05 晚 第二批瘦身与改动分档落地（船长「按你推荐来，落实调整分档」）

- 依据：船长「`.wiki` 不动」「一些验收的文档和旧的数据对比文档也纳入瘦身范围」「超过一个月的旧的测试存档则纳入删除范围」「希望落实调整分档，避免一些小的调整演变成全量跑通」。
- 第二批执行（先备份 → 分批 ≤10 校验 SHA256）：
  1. 外迁 11 份已确认/已实现且无未决、无代码与现行入口引用的历史验收/审计/校准/基线文档；**13 份按状态保留**（进行中、待裁定、待办、待验收，或被 `tools/*.ts` 与 `roadmap` / `pending-decisions` / `guoqing-audit-followup` 引用）。纠正了按日期一刀切的初版清单。
  2. 删除 37 个超过一个月且零引用的 `test-save-*` 合成档（9.2 MB，全部 git 已跟踪，归档区留 SHA256 副本）。`user-backup-*` 44 个与 `save-*.json.json` 18 个按 `docs/test-saves/README.md:69`「其余真档备份一律不删」原位不动；16 个工具硬引用档、34 个近一月档同样保留。
  3. `docs/test-saves/README.md` 加「已清理测试档（37 份）」统一声明（手册主体不改），`docs/catalog.md` 加第二批指路，`tools/README.md` 与 README 的 2 处路径改「归档区/」；`.wiki` 未改。`docs:index` 重生成：378 → 367 份。
- 分档落地：`package.json` 新增 `tier`（判定）与 `verify`（判定并执行）；新增 `tools/change-tier.ts`。按 `git diff` 变更集自动判 T0-data / T0-docs / T0-style / T1 / T2，取最高档、未知路径升 T1、改规则或检查工具升 T2；`--tier=` 只允许升档。`AGENTS.md` §2.2 由「数据微调快速通道」扩为完整分档表，§3 改为「以 `npm run tier` 判档、`npm run verify` 执行」；开发约定 §二、`docs/catalog.md` 同步。
- 现行口径：**禁止把纯文档、单条数值或单文件样式改动扩成全量跑通**；T0 免一轮确认、免 `.wiki` 检索、免工作文档、免其余四项与 balance 系列。完整 `test -w @whale/core` 仍留到船长明确开始集中验收。
- 数据：归档区 manifest 302 条、第 3 次提交；完整备份 `H:\大鲸鱼\_docs-backup-20261105\second-batch`；索引 367 份 / 816 行。

## 2026-11-05 文档外迁与 T0 数据微调快速通道（船长批准）

- 依据：船长「文档瘦身，将旧文档和已经过期的文档移出工作区」「同时我希望能够简化门禁」「按你推荐来修改」。
- 生效范围：`AGENTS.md` §0.1、§2.2、§3、§8；`docs/development-conventions.md` §二；`docs/catalog.md`；`README.md`；`docs/.rgignore`；`package.json` 新增 `data:quick`；新增 `tools/data-quick-check.ts`；两处源码注释、两处设计稿的旧归档路径改为「归档区」；`docs/test-saves/README.md` 精简并加外迁索引；`docs/INDEX.md` 重生成。
- 现行规则：
  1. 归档区 = `H:\大鲸鱼\_docs-archive-20261105\Deepseek-EVE\`，独立 git 仓库、默认禁读，逐份 SHA256 见 `manifest.csv`；仓库内已无 `docs/archive/`、`docs/design/archive/`，历史文档里的旧路径一律按归档区对应子目录解析，链接不授予查阅权限。
  2. `.wiki/` 未改动（模型不擅自写库），其中的旧路径同样按上条解析；是否批量改写待船长授权。
  3. `content-csv/` 仅供审查，船长未强调时不更新不修改；权威源是 `packages/data/src/static/*.json`。
  4. T0：只改 `market.json`、`items.json` 既有条目数值列或下架市场卡时，免 §2 确认、免 `.wiki` 检索、免工作文档，只跑 `npm run data:quick`；越界或工具报 ⚠ 升回 T1。T1/T2 流程与四项技术检查不变。
- 数据：第一批外迁 253 个文件（归档层 220 + test-saves 说明 32 + `comms-通讯.md` 1），README 848 行原文复制留档；完整备份 `H:\大鲸鱼\_docs-backup-20261105`；索引收录 410 → 378 份。
- 验证：`docs:index --check`、`typecheck`、`content:check`、`l10n:check`、`ui:rot-check` 全部通过；`data:quick` 在临时仓库自测正确检出价格变更与死物品（exit 1），项目静态数据 0 变更。本批只本地提交，不推送。

## 2026-11-05 移除提交闸门与B类审批工具（船长指示）

- 依据：船长指示「git的闸门去掉吧」，并确认「连仓库规则一起删」。
- 生效范围：删除`.githooks/pre-commit`、`.githooks/post-commit`、`tools/git-gate-approval.cjs`、`docs/git-gate-approval.md`、`packages/core/tests/git-gate-approval-20261004.test.ts`；移除`package.json`的`commit:approval`脚本；更新`AGENTS.md`§3、`docs/development-conventions.md`§二、`docs/catalog.md`、`docs/single-source.md`。
- 现行规则：提交不再有pre-commit钩子拦截；`typecheck`、`content:check`、`l10n:check`、`ui:rot-check`四项技术检查仍须在提交前由经办人手动跑完；原B类路径审批（存档/测试档/铁人/标定表）不再有工具登记，涉及高风险路径的改动继续按§一确认闸门与船长裁定执行。
- 取代：2026-09-27「提交闸门」与2026-10-04「Git提交审批放行」两条机制自本日起失效；原文归档不因此获得查阅授权。

## 2026-11-04 接入 Obsidian `.wiki` 知识库（必须调用）

- 依据：船长指示「Obsidian的.wiki知识库也要加入到agent.md要调用起来」。
- 生效范围：`AGENTS.md` §0、§5.4；`docs/development-conventions.md` §五；`docs/glossary.md` 新增「`.wiki` 知识库」条。
- 现行规则：
  1. 开工顺序加入知识库：涉及设计、数值、UI/UX、架构或历史决策时先查 `.wiki`，再读规则与代码；
  2. 分层检索：`index.md` 定位 → 标题/`frontmatter` 标签 grep 命中即停 → 读整页或截段 → 沿 `[[双链]]` 扩一跳；禁止整库通读或批量扫正文；
  3. 工具优先 `wiki_query`/`wiki_drill`/`wiki_read`；工具不可用时按分层用 read/grep/glob 降级，并在汇报注明降级；
  4. 引用页面路径与 `confidence`（extracted/inferred/ambiguous）；`.wiki` 是理论与参考，冲突以 AGENTS、现行 docs 与代码为准；
  5. `index.md`、`.manifest.json`、`_system/`、`_raw/` 由插件维护，不手改；新知识入库走采集/蒸馏通道，模型不擅自写库。
- 环境：`dsh-knj-obsidian@2026.11.12` 已装入 `web` profile，vault 注册表 `~/.dsh/knj-obsidian/vaults.json` 含本仓（vault root `D:\Documents\GitHub\Deepseek-EVE`）；本会话注入 `wiki_*` 工具（`wiki_query`/`wiki_drill`/`wiki_read`/`wiki_search_semantic`/`wiki_lint` 等），同日起船长去掉了 `obsidian_*`（主知识库入口不再挂载）；工具未注入或不可用时按规则降级 read/grep。

## 2026-11-04 工作流提速：确认闸门风险分档、子代理按需、留痕按规模

- 依据：船长要求「我们需要更新一下agent.md,不能用这个工作流，太慢了，需要提速保证准确率」；确认慢因为「强制子代理施工带来的编排开销、四步闸门确认轮次、汇报与文档留痕」，并批准该方案「这些可以改动」。
- 生效范围：`AGENTS.md` §1、§2、§5.1、§8；`docs/development-conventions.md` §一、§二、§三、§十五；`docs/glossary.md`「确认闸门」条。
- 现行规则：
  1. 默认直接实现：需求明确、可逆且同域时先做再汇报；仅新大功能/玩法、存档结构、数值经济体系、跨域改动、玩家公告、需求或范围模糊、高返工代价操作才走确认，且一轮问完（集中提问≤3问→中文设计总结→一次点头→开工）；
  2. 已确认方案的执行不重复确认；沉默、「随便」和跳过提问都不算确认；
  3. 子代理不再强制：默认主代理直接施工，按并行收益决定派工（独立并行任务、跨多文件不重叠写入、独立只读取证与审查），派工写明 Serena 实例前缀与写入范围，产物由主代理复核终审；
  4. 工作文档按规模：大功能、跨域、待裁决建`docs/design/`，小修、明确指令和单文件改动不建，写进汇报与提交信息；
  5. 准确率底线不变：专项测试、`typecheck`、`content:check`、`ui:rot-check`、构建按影响照跑，主代理终审 diff。
- 取代：2026-11-02 条目的第3条（强制开子代理与并行派工）自本日起失效，子代理改为按需；第1、2、4条仍有效。

## 2026-11-04 Serena 成为主代理与全部子代理的默认代码增删改查工具

- 依据：船长指示「现在所有的子代理和你，都要用serena作为默认增删改查的工具」。
- 生效范围：`AGENTS.md` §5、§5.1。
- 现行规则：
  1. 主代理与所有子代理，凡代码符号的查定义、查引用、符号级替换/插入/删除，**默认且优先**使用对应仓库的 Serena MCP 实例，不得一上来就全文 grep 或盲读；
  2. 一仓一实例，派工任务书必须写明前缀：本仓 `mcp__serena-eve__*`、whale-server `mcp__serena-server__*`、whale-server-go `mcp__serena-go__*`、Border-Pioneer-2 `mcp__serena-border__*`；
  3. 非代码文件（JSON/CSV/MD/配置）不适用 Serena，按普通 read/edit 处理；
  4. Serena 不可用时必须**明确报告原因与降级范围**，再降级 read/grep，不得静默退化；
  5. 超过 500 行的代码/数据文件禁止盲目全文通读，先用 Serena 定位。
- 环境变更（2026-11-04）：`~/.dsh/cordis.patch.yml` 由双实例扩为**四实例**，原 `mcp-serena`（Border-Pioneer-2）改名 `serena-border`，新增 `serena-server`（whale-server）与 `serena-go`（whale-server-go）；备份 `cordis.patch.yml.bak-20261104-003308`。重启 DSH 后四个实例实测均可读各自仓库符号（含 Go 语言服务）。

## 2026-11-03 子代理默认使用 Serena MCP（含环境缺口登记）

- 依据：船长指示「子代理用的工具不齐全啊默认也要用serena mcp」。
- 生效范围：`AGENTS.md` §5.1。
- 现行规则：派工任务书必须写明子代理优先使用 `serena` MCP 做符号定位与编辑；若 Serena 因环境原因不可用，子代理必须明确报告原因并降级到 read/grep，**不得静默退化**。
- 环境缺口与修复（2026-11-03 主代理）：DSH home 级配置 `~/.dsh/cordis.patch.yml` 原把 `mcp-serena` 写死 `--project 'D:\Documents\GitHub\Border-Pioneer-2'`，导致本仓下 Serena 全部工具报 `FileNotFound`、`list_memories` 返回空。**已修复为双实例**：`serena` 仍指向 `Border-Pioneer-2`，新增 `serena-eve` 指向本仓（工具前缀 `mcp__serena-eve__*`）。`web` profile 会热重载 patch，**无需重启**；已实测本仓 `get_symbols_overview` 与 `find_referencing_symbols` 正常。原配置备份在 `cordis.patch.yml.bak-20261103-132910`。

## 2026-11-02 Serena MCP 工具增删改查、大文件禁读与子代理并行干活

- 依据：船长指示「默认可以用serena mcp这个工具增删改查，超过500行的东西不能直接读，用serena差引用和定义很快的，不需要全读一遍，只要涉及到干活修改就开子代理干活，我们主代理负责路由任务给子代理并行干活，最后统一验收。」
- 生效范围：`AGENTS.md` §5、§5.1、`docs/development-conventions.md` §四、§五。
- 现行规则：
  1. 代码分析与修改默认使用 `serena` MCP 工具进行符号定义、引用查询与局部增删改查；
  2. 超过 500 行的代码/数据文件禁止直接盲目全文通读，必须使用 Serena 快速定位引用和定义，按需精准读写，防止上下文爆炸与无关细节干扰；
  3. 只要涉及到具体干活与代码修改，必须启动子代理（Subagent）执行；主代理负责需求拆解、架构把关与任务路由，派发给子代理并行作业，最后由主代理统一执行技术检查与验收闭环；
  4. 清理旧规则中陈旧的单会话子代理限制，确立主子代理协同流水线作业标准。

> 注：第3条（强制开子代理与并行派工）自 2026-11-04 工作流提速条起被取代，子代理改为按需；其余条款仍有效。

## 版权与发行授权：现行入口

- 现行规则：根目录`LICENSE.txt`、`AGENTS.md` §5.3、开发约定§十六；构建用法和发布前检查见`tools/release-rights/README.md`。
- 本批实施与维护记录归档于`归档区/docs/archive/release-rights-20261102/`。没有船长明确查阅要求禁止读取，链接不授予查阅权限；本地归档不代表已推送发布。

## 2026-10-29 现行文档与旧记录隔离

- 依据：船长要求清理常用文档中的旧内容，移入旧记录专用文件夹，并禁止未经要求的日常阅读。
- 生效范围：`AGENTS.md`、开发约定、文档目录、README及日常索引工具。
- 现行规则：常用文档只保留有效约束、定义、当前入口与未决事项；每条约束说明原因；不再追加批次流水。
- 归档方式：原文按字节保留并登记SHA256，过程移入`归档区/docs/archive/`；现有`归档区/docs/design/archive/`保留路径，采用同一禁读边界。
- 查阅边界：普通开发、续接或历史链接不授权；获准只查指定范围，结束恢复禁读；索引和默认检索在读取前排除旧记录。
- 规则维护：后续完成批次的旧记录随归档移走，不将流水重新积累为第二份规则正文。
