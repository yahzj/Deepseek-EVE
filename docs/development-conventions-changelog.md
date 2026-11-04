# 开发约定维护记录

> 本页记录当前规则维护，不是开工必读。历史流水已移入`docs/archive/`；无船长明确查阅要求禁止读取或检索，包括Git历史。

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

## 版权与发行授权：现行入口

- 现行规则：根目录`LICENSE.txt`、`AGENTS.md` §5.3、开发约定§十六；构建用法和发布前检查见`tools/release-rights/README.md`。
- 本批实施与维护记录归档于`docs/archive/release-rights-20261102/`。没有船长明确查阅要求禁止读取，链接不授予查阅权限；本地归档不代表已推送发布。

## 2026-10-29 现行文档与旧记录隔离

- 依据：船长要求清理常用文档中的旧内容，移入旧记录专用文件夹，并禁止未经要求的日常阅读。
- 生效范围：`AGENTS.md`、开发约定、文档目录、README及日常索引工具。
- 现行规则：常用文档只保留有效约束、定义、当前入口与未决事项；每条约束说明原因；不再追加批次流水。
- 归档方式：原文按字节保留并登记SHA256，过程移入`docs/archive/`；现有`docs/design/archive/`保留路径，采用同一禁读边界。
- 查阅边界：普通开发、续接或历史链接不授权；获准只查指定范围，结束恢复禁读；索引和默认检索在读取前排除旧记录。
- 规则维护：后续完成批次的旧记录随归档移走，不将流水重新积累为第二份规则正文。
