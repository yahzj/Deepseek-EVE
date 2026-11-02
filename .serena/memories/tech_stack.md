# Tech Stack

- **Runtime & Node**: Node.js >= 20.0.0 (Windows pwsh/cmd)
- **Monorepo**: npm workspaces
  - `apps/desktop` (`@whale/desktop`): Electron 桌面壳 + Electron-Vite + React (TSX) + 自研 HUD 科技风格样式体系。
  - `packages/core` (`@whale/core`): 纯 TypeScript 游戏逻辑引擎（无 DOM 依赖，包含状态机、战斗、航行、挖矿、离线收益结算与持久化）。
  - `packages/data` (`@whale/data`): 静态游戏数据与配置（舰船、模块、蓝图、商品、NPC、本地化表 `table.ts`）。
  - `packages/ui` (`@whale/ui`): 基础可复用 UI 积木。
- **Build & Test**:
  - Vite / Electron-Vite
  - TypeScript (Strict mode)
  - `tsx` (执行 `tools/*.ts` 专项检查与脚本)
  - Vitest / Node test runner (`npm run test -w @whale/core`)
- **CLI & MCP Tooling**:
  - **RTK (Rust Token Killer)**: 必须作为所有 Shell 命令的前缀（如 `rtk git status`, `rtk npm run ...`）。
  - **Serena MCP**: 代码语义与符号分析工具（查定义、查引用、符号重构、局部替换）。
