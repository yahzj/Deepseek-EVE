# 声音系统追加批：BGM / 环境音 / 战斗细分 / 音高随机 · 2026-11-02 工作文档

> 状态：**实施中（待船长验收）**。经办：零号（AI）· 分支：`main` · 日期：2026-11-02。
> 验收结论：已验收（2026-11-05，船长批量验收「待验收」项）。原状态行及「未提交／未合入／未推送」等记录为历史事实，保留不删；本次仅收口文档验收状态，不代表代码已合入 main、已推送或已部署。
> 前序批次见 `docs/design/sound-system-20261102.md`（15 个短音效 + 设置 + 本机音效台）。本批在其上追加三层：BGM、环境音、战斗触发细化。

## 一、船长原话

1. 2026-11-02：「系统和触发还是太单调了，BGM和环境音呢？」
2. 同日：「战斗的音效触发应该要有随机音调在1个音分以内的变化选项」→ 澄清后确认：「我的意思就是1200的单位里，上下浮动100音分」。
3. 2026-11-05：「你看看我做好的成品 E:\WORKS 2025\EVE\成品 有音乐和音效，但是是多个的，你音效台没有做多个的组内随机触发，只能上传一个。你可以把我这个弄进项目里了」。

## 二、已确认的裁定

| 事项 | 结论 |
|---|---|
| BGM | **5 个场景循环**：停靠 / 太空 / 战斗 / 虫洞 / 入侵；切换 **2.5s 交叉淡入淡出**（2026-11-04 调：切场景要自动交叉淡变，否则切歌突兀；同曲调音量走 250ms 短淡变） |
| 环境音 | **场景底噪 3 条**（停靠 / 太空 / 战斗；虫洞与入侵沿用太空）＋ **随机点缀 3 条**（每 20–90 秒随机一声） |
| 触发扩展范围 | **只做战斗细分 + UI 反馈**（不扩市场/工业/航行等）；护盾/装甲/结构细分需 core 增事件，本批不碰 |
| 后台行为 | **最小化 / 切后台暂停** BGM 与环境音，回来自动恢复 |
| 音量分类 | 新增「音乐」「环境」两路（共 6 类），设置内各一条滑条；总静音仍管全部 |
| 战斗音高随机 | 默认 **±100 音分（±1 个半音）**、可开关、可调 0–100 音分；只作用于战斗重复音 |

## 三、方案

新增模块（都在 `apps/desktop/src/renderer/src/game/audio/`）：

| 模块 | 职责 |
|---|---|
| `scene.ts` | 场景解析纯函数：**战斗 > 虫洞 > 入侵 > 停靠 > 太空**；BGM/环境映射；状态投影（`awayGalaxy === null` = 停靠；`weekendEvent` 无 `endedAtWallMs` = 入侵进行中） |
| `loops.ts` | `LoopChannel`：双 `<audio loop>` 交叉淡变（40ms 线性推音量）、同曲不重启、隐藏暂停/恢复 |
| `music.ts` | BGM 场景引擎：素材优先本机覆盖；同一场景多个变体时**切场景随机取一条并缓存**（音量/静音刷新不重选，「重播」重新随机）；缺素材=静音；首次手势重试自动播放 |
| `ambient.ts` | 环境底噪（同款交叉淡变）＋ 20–90 秒随机点缀（走环境音量与节流） |
| `useSceneAudio.ts` | App 顶层挂载：每帧投影场景、变化才切；**只在场景变化时切曲**；visibility 生命周期暂停/恢复；偏好变化即时调音量 |
| `uiFeedback.ts` | 全局按钮点击 → `ui-click`（捕获阶段旁听、音效台内部不响） |

扩展：`cues.ts`（33 个语义事件 / 6 分类 / `loop` / `pitchJitter` / `fallback`）、`rules.ts`（6 类音量、`pitchJitterCents`、`pitchRateFor`、`ui-error` 白名单）、`player.ts`（音高随机、按弹种回落、loop 试听）、`manifest.ts`（三目录 glob）、`battleSfx.ts`（按弹种/未命中/敌方开火）、`appSettings.tsx`（6 类滑条 + 音高行）、`SfxConsole.tsx`（音效 / 音乐 / 环境三组）。

**战斗音高随机**：`playbackRate = 2^(均匀随机(±100)/1200)` 且 `preservesPitch = false`（浏览器默认 true 只变速不变调，2026-11-02 在 Chromium 实测：`preservesPitch` 存在、默认 true；`playbackRate = 1.0005777895065548` 原值保留）。1 音分 ≈ 0.058% 频率差；100 音分 = 1 个半音。一次性重音（击毁/沉没/胜负）与 BGM/环境不加抖动，避免仪式感破坏与循环漂移。

## 四、语义事件（33 个）

| 分类 | 数量 | 事件 |
|---|---|---|
| 警报 | 2 | `invasion-alarm` / `invasion-end` |
| 战斗 | 10 | `combat-fire`（旧兜底）、按弹种 `combat-fire-kinetic/explosive/plasma`、`combat-hit` / `combat-hurt` / `combat-miss` / `combat-foe-fire` / `combat-foe-down` / `combat-me-down` / `combat-win` / `combat-lose` |
| 生产 | 5 | `industry-done` / `skill-done` / `trade-done` / `scan-done` / `build-done` |
| 界面 | 3 | `comms-received` / `ui-click` / `ui-error` |
| 音乐 | 5 | `bgm-docked` / `bgm-space` / `bgm-battle` / `bgm-wormhole` / `bgm-invasion` |
| 环境 | 6 | 底噪 `ambient-docked` / `ambient-space` / `ambient-battle`；点缀 `ambient-blip-comms` / `ambient-blip-metal` / `ambient-blip-static` |

默认音量：总 70%；音乐 55% / 环境 45% / 警报 100% / 战斗 60% / 生产 70% / 界面 50%。偏好存本机 `whale-idle:sfx`，不进存档。

## 五、素材约定

- BGM：`assets/bgm/<id>.mp3`，60–120s **无缝循环**、建议 ≤5MB；
- 环境底噪：`assets/ambient/<id>.mp3`，20–60s 无缝循环、≤2MB；
- 环境点缀：`assets/ambient/blip-*` 短音（0.2–2s）；
- 短音效：`assets/sfx/<id>.mp3`（战斗弹种三条缺文件时回落旧 `combat-fire`）；
- **同一事件可放多份变体**：`<id>.1.mp3` / `<id>.2.mp3` 等（`matchSfxFileName` 归一到同一语义 id）：
  - 短音效与环境点缀：每次播放随机取一份（`pickVariant`）；
  - BGM：切到该场景时随机取一份并保持，重播/重新进场景重新随机；
- 缺素材 = 静音；本机替换走音效台（三组），只存本机、不进 git、不随发布。
- **当前接入状态（2026-11-05 船长成品素材）**：BGM 5/5 场景共 8 首（停靠 1、太空 2、战斗 2、虫洞 2、入侵 1）；环境点缀 4 条（电流杂音 ×2、金属声 ×2，通讯滴答缺）；`ui-click` 1 条；其余 25 个事件缺素材=静音。`audio:check` 读数：13 个音频文件，覆盖 8/33 个事件。

## 六、边界与不做

- **不碰 core**：护盾/装甲/结构细分需要 core 在 `BattleFx` 里补层信息，本批不做（已记录为后续候选）。
- BGM 无缝循环由素材保证，游戏侧只做 `loop=true`，不做跨段拼接/淡入淡出分析。
- 场景只按"战斗屏上屏 / 虫洞 run / 入侵活动 / 停靠 / 太空"五项；**不按页面**切曲（同一场景切页不换曲）。
- 最小化暂停是取舍：挂机时无 BGM/环境音，回来自动续播。
- 环境点缀不按场景分池：三个点缀随机播（后续可细分）。

## 七、公告待审稿（未批准不写 `announcements.ts`）

> ⚠ 仓库现有首批正式素材（2026-11-05 接入船长成品：BGM 5 场景、环境点缀、`ui-click`），但**公告仍须船长点头**才写入 `announcements.ts`，且不得早于素材上线批次单独发布。

1. 游戏加入背景音乐与环境音：停靠、太空、战斗、虫洞与入侵各有自己的音乐与场景底噪。
2. 战斗音效更丰富：不同弹种开火、未命中与敌方开火各有声音，并可在设置里开关「战斗音效音高随机」（默认 ±1 个半音，避免重复感）。
3. 设置里新增「音乐」「环境」两条音量，可在最小化时自动暂停；原有音效与存档不受影响。

## 八、验证清单

（实施完成后回填，见 §九）

## 九、验证结果（2026-11-02 自测）

| 检查 | 结果 |
|---|---|
| `npm run typecheck`（四包） | ✅ 通过 |
| `npm run audio:check` | ✅ 33 事件 / 6 分类 / 37 条日志规则（死规则扫描）/ 音高与场景用例全过 |
| `npm run l10n:check` | ✅ 67 条本域文案（新增 27 条待译登记成对） |
| `npm run content:check` / `arch:guard` / `ui:rot-check` | ✅ 通过 |
| `npm run build`（桌面）+ `npm --prefix web run build`（网页） | ✅ 通过 |
| `npm run audio:smoke`（网页·无头 Chrome·强制现代布局） | ✅ 23 项：33 事件、设置 10 条滑条、音高行、音效台三组、拖入/试听/清除、无 console error |
| `npm run audio:smoke`（带临时 BGM/环境/弹种素材的构建产物） | ✅ 内置素材识别（覆盖 3 个事件）、音乐/环境引擎起播无异常、无 console error（验证后已删临时素材与产物） |
| `npm run audio:smoke:desktop`（Electron `file://`） | ✅ 通过（界面/门禁/内置与 blob 音频/file:// 均可播、无 console error） |

### 2026-11-05 成品素材导入（船长提供）

| 检查 | 结果 |
|---|---|
| 素材落盘 | 13 个 mp3/17.8MB 按变体命名接入 `assets/{bgm,sfx,ambient}`；SHA-256 逐个核对与源文件一致 |
| `npm run audio:check` | ✅ 33 事件 / 13 个音频文件 / 覆盖 8/33 个事件 / 本域 106 条 id |
| `npm run typecheck` | ✅ 四 workspace |
| `npm run build` + `npm --prefix web run build` | ✅ BGM 进包（多变体都被收表） |
| `npm run audio:smoke` | ✅ 33 项；内置素材覆盖 8 个事件（BGM 5 场景、`ui-click`、2 条环境点缀） |
| `npm run audio:smoke:desktop` | ✅ 通过 |

测试档：无随档字段，不需要生成器/门槛档与迁移验证。
