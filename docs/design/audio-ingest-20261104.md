# 音效正式入库（音效台导出 → audio:install）

> 状态：已实现、专项自测通过，待船长验收（2026-11-04）
> 经办：主代理（DSH）；分支：main；日期：2026-11-04

## 船长原话

> 「我现在要接入音效了，设置里的音效台入口是给我做音效接入到项目里用的。目前还差接入到仓库作为正式音乐和音效使用。」

## 裁定

| 问题 | 裁定 |
|---|---|
| 本机音效台如何变成仓库正式素材 | 音效台「导出正式入库包」→ 仓库根 `npm run audio:install` 校验写入 |
| 运行形态 | 桌面开发版与网页版都要能用（导出在渲染层、安装在 Node CLI，两处复用同一格式） |
| 素材现状 | 有成品素材文件夹、尚未导入音效台；先导入音效台再导出 |
| 依赖 | 不新增依赖；包格式由 `sfxPack.ts` 自带的 store-only zip 读写 |
| 覆盖范围 | 本机覆盖（音效台导入）优先于内置；入库后提醒回音效台「全部清除」 |

## 方案

- 包格式：`whale-idle-sfx-pack` v1，zip 内 `README.txt` + `manifest.json` + `sfx|bgm|ambient/<id>.<ext>`；manifest 记录 `createdAt`、`assetsRoot` 与每条 `{cueId, path, fileName, bytes, updatedAt}`。
- 语义 id → 目录映射唯一实现 `sfxPackDirOf` / `sfxPackAssetPath`（`game/audio/sfxPack.ts`）：`music → bgm`、`ambient → ambient`、其余 `sfx`；一个 id 每次只允许一条素材，扩展名限 mp3/ogg/wav/m4a。
- 导出：`SfxConsole` 把本机覆盖读成 Blob（`listSfxOverrideFiles()`），打包后经浏览器下载 `whale-sfx-pack-YYYYMMDD-HHmmss.zip`；无本机覆盖时按钮禁用。
- 安装：`installSfxPack()` 校验并原子式逐条写盘（先收集报告再写），默认清理同一事件旧扩展名与变体（避免 manifest 把新旧素材当多份变体随机混播）；字节一致则跳过；`--dry-run` 预览、`--keep-variants` 保留手工变体并警告；输出覆盖度与后续步骤。
- 安全：只接受仓库根下的素材目录落点；包损坏/未知 id/路径越界/重复 id/超大文件/加密或压缩 zip 一律拒绝，并给出全部错误而不是只报第一条。

## 改动清单

- 新增 `apps/desktop/src/renderer/src/game/audio/sfxPack.ts`：纯逻辑包格式（打包、解析、store-only zip 读写、路径映射、校验错误集合）。
- 新增 `tools/audio-install.ts` 与 `npm run audio:install`：CLI 参数、自动找包、校验写盘、覆盖度报告。
- 改 `game/audio/overrides.ts`：`RuntimeOverride` 保留 `Blob`，新增 `listSfxOverrideFiles()` 供导出。
- 改 `panels/SfxConsole.tsx`：导出按钮（`ui.sfx.070/075`）、流程说明（`ui.sfx.071`）、成功/失败/空状态提示（`ui.sfx.072/073/074`）。
- 改 `tools/audio-check.ts`：新增「二·六、音效正式入库包」确定性用例（打包↔解析↔临时目录安装、非法包拒绝），并把 070-075 纳入本域 l10n 核对。
- 新文案 `ui.sfx.070`~`ui.sfx.075` 进唯一本地化表，并在 `docs/l10n-pending.md` 登记待译。
- 文档：三份素材 README 增「正式入库」、`docs/glossary.md` 增「音效入库包」、`docs/single-source.md` 与 `tools/arch-guard.ts` 登记格式/路径唯一实现、`tools/README.md` 增使用说明与台账、`docs/roadmap.md` 记待验收。

## 边界

- 本机覆盖仍不进存档/git；只有主动导出并执行安装才进仓库，与既有「音效台只存本机」契约一致。
- 安装器不解析音频内容、不做听感判断；素材质量与授权仍由船长验收，来源登记按各 README。
- 网页版受浏览器限制不能直接写仓库目录，因此采用「下载 + CLI」而非 File System Access 写盘或 Electron IPC。
- 不读个人真档；临时目录用例与 CLI 都不碰玩家存档。

## 风险

- 反复导出/安装会覆盖同名文件：安装器按字节一致跳过，`--dry-run` 可预览，覆盖前打印清单。
- 入库后未清本机覆盖时听感仍走本机旧文件：提示与 README 已写明先「全部清除」。
- 体积超限只警告不阻断：给船长保留自行取舍空间，但会提示会随构建产物增大。

## 验证

- `npm run audio:check`：接口清单、素材目录、本地化、入库包往返/非法包/临时目录安装、纯规则全部通过。
- `npm run typecheck`、`npm run l10n:check`、`npm run content:check`、`npm run ui:rot-check`、`npm run arch:guard`。
- `npm run build`、`npm --prefix web run build`。
- `npm run audio:smoke`（含导出 Blob 捕获校验）、`npm run audio:smoke:desktop`（file:// 与发布门禁）。
- 待船长：导入真实素材走一遍「导出 → audio:install → 全部清除 → audio:check」，验收音效/音乐/环境实际听感与首批素材公告。
