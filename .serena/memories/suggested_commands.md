# Suggested Commands

> **Rule**: 所有 Shell 命令必须前缀 `rtk`，例如 `rtk git status`。
> **Windows Notes**: 避免使用 `grep` 或 `rm`，使用 `rtk rg` 检索代码/文档，使用 node 脚本进行文件操作。

## 常用开发与构建

- `rtk npm run dev`: 启动桌面应用开发环境。
- `rtk npm run build`: 桌面端编译打包。

## 质量契约与静态检查

- `rtk npm run typecheck`: 全仓 TypeScript 类型检查（core, data, ui, desktop）。
- `rtk npm run content:check`: 数据与游戏数值契约体检（商品卡、蓝图、技能树、通讯等）。
- `rtk npm run ui:rot-check`: UI 旋转口径与属性表体检。
- `rtk npm run ui:layout-css`: 生成/同步 modern 与 classic 双份布局 CSS 文件。
- `rtk npm run ui:layout-css -- --check`: 校验双份布局 CSS 是否与主样式表一致。
- `rtk npm run docs:index`: 扫描并生成 `docs/INDEX.md` 总索引（切勿手改）。

## 核心逻辑测试

- `rtk npm run test -w @whale/core`: 运行 core 全量单元测试（集中验收时跑）。
- `rtk npx vitest run packages/core/test/<file>.test.ts`: 运行特定专项单元测试。

## 文档检索

- `rtk rg --glob "*.md" --glob "!**/archive/**" "<关键词>" docs`: 安全检索文档（自动排除禁读的历史归档）。
