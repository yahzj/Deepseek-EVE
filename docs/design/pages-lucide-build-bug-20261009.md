# GitHub Pages 缺少图标依赖修复

> **状态：船长批准推送，发布前回归与提交中**（一号 · main · 2026-10-09）
> 船长原话：「在github上部署时，报错了」，日志为 Rollup 无法解析 `StellarExplorer.tsx` 的 `lucide-react` 导入。
> 范围/不做：网页构建的依赖声明、锁文件、必要的解析配置及专项测试；不改游戏逻辑、界面、存档、桌面依赖或安装 Electron，不将图标库设为外部运行时依赖。
> 待裁决点：无；按既有独立网页部署方式补齐缺项。

## 定位

- 功能域：网页构建与部署基础设施；参照已有 React 网页依赖声明和桌面包 `lucide-react` 版本，不跨业务域。
- `.github/workflows/pages.yml` 在 `web` 执行 `npm ci` 和 `npm run build`，没有安装根工作区依赖。
- 共享 renderer 已使用 `lucide-react`，但只有桌面包声明了它；`web/package.json` 和独立锁文件都没有该库。
- 本地根目录依赖可供解析，不能代表 GitHub 干净环境。Vite CJS 警告不是本次阻断原因。
- 隔离副本验证：只补声明并安装 `web/node_modules` 后依然报同样的导入错误；共享源码在工程外，Vite 默认沿导入者所在目录查找依赖，而不会到兄弟目录 `web/node_modules` 查找。配置 `resolve.dedupe` 让三项渲染依赖统一从网页根目录解析。

## 实施与验证

- `web/package.json` 补 `lucide-react: ^0.468.0`，沿用桌面版本；`npm install --package-lock-only --ignore-scripts --no-audit --no-fund` 更新独立锁文件，仅增加对应依赖与安装项，根锁文件未改。
- `web/vite.config.ts` 增加 `resolve.dedupe: ['react', 'react-dom', 'lucide-react']`；不改 Pages 流程，不安装 Electron，不使用 `external` 绕过打包。
- 专项 `web-build-dependencies-20261009.test.ts`：修复前两项失败，仅查出缺少 `lucide-react`；修复后三项通过，覆盖共享源码运行时依赖、独立锁文件一致性及真实 Vite 配置的解析设置。
- 隔离验证：由 Git 导出全新源码副本，只复制本批网页修复文件；副本根目录及桌面目录无 `node_modules`，仅在 `web` 执行与 Pages 相同的 `npm ci --no-audit --no-fund` 和 `npm run build`。只补声明时重现相同解析错误，补解析配置后成功处理 1966 个模块，生成静态产物。该验证运行于本机 Windows，未冒称 GitHub Ubuntu 远程部署已成功。
- 主树 `web` 同样执行 `npm ci` 和构建通过，`web/dist` 已更新。四包类型检查、`content:check`、`git diff --check` 通过；不跑集中验收阶段的整库回归。
- 已有 Vite CJS 与包体大小警告保留，不是本次失败原因；界面和玩法源码未改，不需要观感验收或存档迁移。
- 船长 2026-10-09 明确「进行推送」；本批获准提交、归档并推送，发布前执行完整核心回归。不动个人档及原有未跟踪文件。
- 清理本次临时副本时，已先校验绝对目标位于系统临时目录，但删除被执行环境拦截，未绕过。残留：`C:\Users\ya\AppData\Local\Temp\whale-pages-lucide-236da293c8994c2c99b51256763b96cb`。
