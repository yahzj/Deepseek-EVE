# 音效台调试批：大窗页签 / 场景预演 / 实时触发 / 一键入库 · 2026-11-04 工作文档

> 状态：**已实现自测，待船长验收（2026-11-04）**。经办：零号（AI）· 分支：`main` · 日期：2026-11-04。
> 验收结论：已验收（2026-11-05，船长批量验收「待验收」项）。原状态行及「未提交／未合入／未推送」等记录为历史事实，保留不删；本次仅收口文档验收状态，不代表代码已合入 main、已推送或已部署。
> 前序批次：`docs/design/sound-system-20261102.md`（骨架 + 本机音效台）、`docs/design/sound-layers-20261102.md`（BGM / 环境音 / 战斗细分 / 音高随机）、`docs/design/audio-ingest-20261104.md`（导出正式入库包 + `audio:install`）。

## 一、船长原话

1. 2026-11-04：「我的意思是入库需要在音效台做个入口，UI不用多好看，我们内部调试用的。这些功能都做到音效台里，并且设置中的音效台的UI界面可以调大一点多，可以放更多功能按钮之类的东西啊。」
2. 同日：「我想要把音效和音乐填入音效台里，然后可以一键入库，爷（也）可以更新入库，怎么说」。
3. 同日：切场景 BGM 要 **2.5 秒自动交叉淡入淡出**（否则切歌突兀）；并要一个「到真实场景里直接实地检查验证 / 帮我锚定画面需要什么样的声音」的调试场景工具。

## 二、已确认的裁定

| 事项 | 结论 |
|---|---|
| 音效台形态 | **居中大窗 + 可收起悬浮条**；设置入口保留，调试模式顶栏另加「♪ 声音」快捷入口 |
| 调试场景范围 | **声音场景预演 + 实时触发日志**；不做真实跳场景作弊、不做打点记录（选项 A） |
| 淡变范围 | **只 BGM 换曲 2.5s**；环境底噪保持 1.5s；同曲调音量/静音走 250ms 短淡变（选项 A） |
| 一键入库 | **桌面开发版经 Electron IPC 直接写仓库**；网页版按钮置灰并提示导出 + `npm run audio:install`（选项 A） |
| 入库后清覆盖 | **成功后自动清除已入库的本机覆盖**，避免覆盖继续盖住新内置素材（选项 A） |

## 三、方案

- **音频层**：`rules.ts` 新增 `BGM_CROSSFADE_MS = 2500`、`AMBIENT_CROSSFADE_MS = 1500`、`VOLUME_FADE_MS = 250` 三个唯一来源常量；`loops.ts` 改为换曲 / 同曲调音量双速率步长；`music.ts`、`ambient.ts` 接入。BGM 另有 `restartMusic()` 供「重播场景音乐」调试按钮。
- **场景**：新建 `sceneSwitch.ts` 维护 real / forced / applied；真实场景由 `useSceneAudio.ts` 经 `reportRealSfxScene()` 上报，强制场景只影响音频调度；`scene.ts` 增 `SFX_SCENE_ORDER`、`SFX_SCENE_NAME_ID`、`effectiveSfxScene()`、`SCENE_RELATED_CUES`（场景预演参考分组，不动真实触发）。
- **实时触发**：新建 `playLog.ts` 环形缓冲（上限 60 条）；`player.ts` 在真实播放成功后记录 `recordSfxPlay()`，试听 `previewCue` / `previewLoopCue` 不记；调试口暴露 `playLog / clearPlayLog / logPaused / setLogPaused`。
- **音效台**：`SfxConsole.tsx` 重写为居中大窗，四页签「素材清单 / 场景预演 / 实时触发 / 入库」+ 底部工具条（导出正式入库包、全部清除、刷新、静音/恢复、重播场景音乐、立即播放环境点缀）+ 收起后右下角悬浮条；`SfxConsoleButton` 挂调试模式顶栏「♪ 声音」（`appSettings.tsx` 设置入口保留）。
- **一键入库**：`preload` 暴露 `window.whale.audio.installPack()` → 主进程 `audio:install-pack` 校验包大小后写临时 zip，再 spawn `node node_modules/tsx/dist/cli.mjs tools/audio-install.ts <zip> --json`；渲染层解析 `@@WHALE_SFX_REPORT@@` 行显示报告，成功后对每条覆盖 `deleteSfxOverride()` 并提示刷新页面。网页版没有该桥，按钮置灰。
- **文案**：`ui.sfx.098-130`（英文未授权，`en:''` + `enDeferred:true` 并登记 `docs/l10n-pending.md`）。

## 四、改动清单

| 文件 | 改动 |
|---|---|
| `game/audio/rules.ts` | 三个淡变常量 |
| `game/audio/loops.ts` | 换曲 / 调音量双速率 |
| `game/audio/music.ts`、`ambient.ts` | 接入常量；`restartMusic()` |
| `game/audio/scene.ts` | 场景顺序 / 名称 id / `effectiveSfxScene` / 相关事件分组 |
| `game/audio/sceneSwitch.ts`（新） | 真实/强制/生效场景调度 |
| `game/audio/playLog.ts`（新） | 实时触发环形日志 |
| `game/audio/player.ts` | 真实播放后记日志 |
| `game/audio/useSceneAudio.ts` | 改上报真实场景 |
| `game/audio/index.ts` | 调试口扩 sceneState / forceScene / playLog 等 |
| `panels/SfxConsole.tsx` | 大窗四页签 + 工具条 + 收起条 + 一键入库 + `SfxConsoleButton` |
| `ui/AppShell.tsx` | 两处布局调试区挂「♪ 声音」 |
| `styles.css` | 大窗与页签/卡片/日志/入库/悬浮条样式（生成件由 `npm run ui:layout-css` 重建） |
| `main/index.ts`、`preload/index.ts`、`renderer/env.d.ts` | 一键入库 IPC 桥 |
| `tools/audio-install.ts` | `--json` 机器输出（标记行） |
| `tools/audio-check.ts` | 五、音效调试台用例；UI 文案 id |
| `tools/audio-smoke.mjs`、`audio-desktop-smoke.cjs` | 页签/场景/日志/收起/网页兜底；installPack 桥 |
| `packages/data/src/l10n/table.ts`、`docs/l10n-pending.md` | 098-130 中文 + 待译登记 |

## 五、边界与明确不做

- 不做真实跳场景作弊、不改存档与画面；强制场景只影响音频，关闭音效台或「恢复真实场景」即回真实场景。
- 不做打点记录 / 导出日志；实时触发只保留最近 60 条，刷新即清。
- 不改存档结构、不新增依赖（zip 仍走内置 store-only 实现）。
- 网页版不能写仓库（浏览器安全边界）：保留「导出正式入库包 + 命令」兜底。

## 六、风险与回退

- 一键入库依赖本地仓库根与 `node_modules/tsx`；仓库根找不到、安装器失败或包非法时只回显错误，不写文件（主进程 30s 超时、输出 20K 截断）。
- `--json` 只多打印一行标记；人类 CLI 默认输出不变。
- 淡变量集中在 `rules.ts`，回退只需改常量（例如 BGM 2.5s → 1.2s）；环境底噪与音量淡变各一处。
- 样式改 `styles.css` 后必须跑 `npm run ui:layout-css` 重建两份布局生成件，手改生成件会被覆盖。
- 一键入库后需刷新页面让构建期素材表重新收表。

## 七、验证

（2026-11-04 本批自测结果。）

- `npm run typecheck`：四个 workspace 全过。
- `npm run audio:check`：33 事件 / 6 分类、素材 0 文件、覆盖 0/33、本域 106 条 id；新增「五、音效调试台」用例（淡变常量 2500/1500/250、场景强切优先级、场景关联事件合法、实时日志记录/暂停/环形上限）全过。
- `npm run l10n:check`：表 7051 条、待译 235、0 重复 id、占位符对齐。
- `npm run content:check`：交叉引用全部可解析，无死物品。
- `npm run ui:rot-check`：首轮报 `app-sfx-modal` 物理尺寸缺旋转轴覆盖，已补 `.app-root.is-mobile-rot .app-sfx-modal` 后全过。
- `npm run arch:guard`：单点登记 248 条，F1–F9 全 0。
- `npm run ui:layout-css`：两份布局生成件重建（modern/classic 均回读通过）。
- 双端构建：桌面 electron-vite 与网页 `vite build` 均成功（仅有既有的 perf.ts 动态导入、chunk >500kB 提示）。
- `npm run audio:smoke`（网页版，33 项）：新建的页签 / 5 张场景卡片 / 切场景与恢复真实 / 实时触发日志（真实播放才记）/ 网页版一键入库置灰 / 收起展开全过；原导出 Blob 校验、本机覆盖、全部清除照旧；0 console error。首轮 2 红是脚本用了无素材的 `ui-click`（缺素材按设计静默、不记日志），改用已拖入的 `invasion-alarm` 后全绿。
- `npm run audio:smoke:desktop`（7 项）：file:// 内置音频与 blob 本机覆盖均可起播；发布门禁下不暴露 `__whaleSfx`；桌面桥 `installPack` 存在；非法入库包被拒绝且不写仓库；0 console error。
- 待船长：真实素材听感与观感验收；桌面一键入库建议用真实素材再走一遍（dev 环境、仓库根需 `node_modules/tsx`）。
