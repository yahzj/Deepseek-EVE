# Core Source Map & Invariants

大鲸鱼-深空放置 (Great Whale Idle) — 以 EVE 星战前夜为蓝本的深空放置挂机游戏。
采用 npm workspaces Monorepo 架构，运行环境为 Electron 桌面外壳 + Web 技术栈。

## Graph Root & Navigation

- 技术架构与依赖体系: `mem:tech_stack`
- 常用项目命令与执行指引: `mem:suggested_commands`
- 编码约定、主子代理架构与汇报规范: `mem:conventions`
- 任务完成与提交前验证闭环: `mem:task_completion`
- Electron 桌面外壳与前端交互层: `mem:desktop/core`
- 核心引擎与静态数据层: `mem:packages/core`

## Invariants (不可打破的底线)

1. **船长真档绝对安全**: 严禁直接覆写或破坏正在游玩的玩家真档（如本地用户存档）。测试时优先合成夹具或独立备份。
2. **大文件禁盲读 (>500行)**: 超过 500 行的文件禁止直接全文盲读。必须使用 Serena MCP 查引用 (`find_referencing_symbols`)、查定义 (`find_symbol`/`find_declaration`) 与结构概览 (`get_symbols_overview`) 定位后精准读写。
3. **主子代理协同流水线**: 涉及具体干活修改必须启动子代理 (Subagent) 执行；主代理负责架构把关、任务分解与路由派发，主代理最终统一验收闭环。
4. **同域优先原则**: 一次工作只落一个功能域，跨域必须事先批准并在文档记录。
5. **双规同步**: 规则修改必须同步更新 `AGENTS.md`、`docs/development-conventions.md` 并在 `docs/development-conventions-changelog.md` 登记。
6. **沟通与汇报口径**: 沟通与开发日志一律用中文；每次交付汇报第一行必须是「报告老大喵」，结论先行。
