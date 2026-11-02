# Desktop Module (@whale/desktop)

## 架构与目录结构

- `apps/desktop/src/main/`: Electron 主进程，负责原生窗口创建、生命周期与本地持久化 IPC。
- `apps/desktop/src/preload/`: 预加载脚本，安全的 ContextBridge 接口。
- `apps/desktop/src/renderer/`: 前端渲染层 (React + TSX)
  - `panels/`: 独立业务面板（`StarMap` 星图出港、`ActivityBar` 左侧活动栏、`Handbook` 手册、`Market` 市场、`Fitting` 装配、`CommsReader` 通讯终端、`appSettings` 设置等）。
  - `features/`: 复杂子系统交互（`combat` 战斗渲染、`industry` 制造工业、`ships` 舰船视图）。
  - `ui/`: 通用 HUD 组件、科技切角框与统一提示浮层 (`ui/Tooltip.tsx`)。
  - `styles.css`: 主终端样式表；经由 `tools/layout-css-gen.ts` 生成 `styles-modern.css` 与 `styles-classic.css`。

## 开发注意事项

- 样式改动后必须运行 `rtk npm run ui:layout-css` 同步双布局文件。
- 大面板通常包含较多组件，优先使用 Serena 定位子组件定义与引用，避免盲读千行面板大文件。
