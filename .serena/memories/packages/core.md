# Core & Data Packages

## packages/core (@whale/core)
- 纯 TypeScript 游戏逻辑引擎，无 DOM / Electron 依赖。
- `src/state/`: 游戏状态树定义与修改器。
- `src/engine/`: 核心驱动心跳（Tick 机制）、挖矿与提炼产出、远征逻辑、战斗回合制结算、离线收益模拟。
- `src/save/`: 存档数据结构、序列化与版本迁移白名单。
- 测试：`test/` 目录下包含确定性专项用例，运行 `rtk npx vitest run packages/core/test/<file>.test.ts`。

## packages/data (@whale/data)
- 游戏静态配置与只读数据表。
- `src/l10n/table.ts`: 全局多语言文案字典，新文案登记单点。
- `src/items/`, `src/ships/`, `src/blueprints/`, `src/skills/`: 物品、舰船、蓝图、技能树等数据。
- 契约约束：修改数据必须跑通 `rtk npm run content:check`。
