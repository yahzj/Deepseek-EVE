# 正式空间站浏览器冒烟

只验证正式本机构建，不使用独立空间站实验页，不读取个人存档。

## 运行

先由构建负责人更新 `tools/_ui-artifacts/player-station-game-dist`：

```powershell
npm exec -- vite build --config tools/player-station-game/vite.config.ts
node tools/player-station-game/smoke.cjs
```

Chrome 启动需要执行权限。默认使用本机 Google Chrome，可通过 `CHROME_PATH` 指定其他 Chrome 可执行文件。
脚本复用 `wormhole-expedition-journey-shared.cjs` 的 `CdpConnection`、`JourneyPage`、`settingsScript`、`staticServer`。
静态服务器仅在运行期间存在；结束关闭本次服务器及自建 Chrome PID，并校验临时目录边界后清理自有 profile。

## 覆盖

- 未全探索不显示古站标记。
- 全探索、调试开启有空间站导航，无旧 stellar 调试导航。
- 真实点击出港、普通星图古站标记、详情古站卡、进入正式空间站页。
- 真实点击激活、批准主体、运输；快照比较激活及批准不发资产，运输从原仓扣料并锁定原有副船。
- 使用正式存盘入口后读取、清洗存档并重载，核对物资、航单和副船锁。
- ready 合成夹具覆盖 classic/modern、1366x768/390x844、六页签、二级滚动与末端控件可达、水平溢出、本地化 ID 泄漏及浏览器异常。
- 调试关闭后无空间站导航和进入按钮，已发现标记与卡片保留。
- source夹具覆盖来源站受保护人口和停泊副船，通过真实按钮启动120000ms空返，核对返回航单、副船锁、资产守恒及source/return档正式加载；不等待两分钟，不推进测试时钟。

## 合成档

```powershell
node tools/player-station-game/generate.cjs
```

生成器只调用同级 `fixture.ts`，不会读取或覆盖个人档。三档文件输出到 `tools/_ui-artifacts/player-station-game-saves/`：

| 文件 | 验收起点 |
|---|---|
| `test-save-player-station-unexplored-20261121.json` | 缺少穹顶墓园探索，不应显示古站标记 |
| `test-save-player-station-discovered-20261121.json` | 全图已探索、尚未激活；原仓具备主体建材及真实副船，验证激活、批准和运输 |
| `test-save-player-station-ready-20261121.json` | 已激活、主体及九座设施已建成、六名居民和设施所需科研，验证六页签 |

导入前先在原游戏“设置 → 存档 → 存档管理”中导出或备份当前档。建议在独立浏览器profile、同一本机构建地址验收；不要把合成档直接覆盖到正在玩的个人档。
在“设置 → 存档 → 存档管理 → 加载存档文件”选择对应JSON，开启本机调试模式；全探索档可从“出港”的穹顶墓园标记进入古站详情，再进入空间站，也可使用调试空间站导航。
验收结束从同一入口恢复此前导出的个人档，或直接关闭并删除独立测试profile。导入不会自动备份原档。

`source` 仅为浏览器smoke的额外内部模式，不改变生成器的三档清单：它从ready建立一名 `protected/receiveMs=0`、五名 `resident/receiveMs=120000`、一个来源站停泊船及人口锁，并关闭生活保障保留等待计划。
每轮smoke还输出 `*-source-save.json` 和点击后 `*-return-save.json`，均经正式 `loadSaveFile` 验证。

所有业务操作通过 CDP 鼠标或触摸点击；`__whExpeditionTest` 仅用于 `snapshot` 和 `persist`，绝不调用 `step` 或业务命令。
`JourneyPage.text` 会在运行时 DOM 临时加 `data-wh-journey-action` 定位按钮，不修改应用源码；SVG 标记使用应用已有 `data-station-id`。
几何检查按逻辑 `clientWidth/scrollWidth` 判断，因此兼容手机旋转布局。浏览器读数不等于船长观感验收。

每次输出到 `tools/_ui-artifacts/player-station-game-smoke-<timestamp>/`，包含 `report.json` 和逐页截图。失败保留错误阶段、界面文本和 `failure.png`。

## 本次结果

2026-11-21 最终正式本机构建已重新生成，包含穹顶墓园`galaxy-vault`地点修正、来源返航入口与舰员未绑定状态。
最终矩阵输出为 `tools/_ui-artifacts/player-station-game-smoke-1795246540498/`，16组流程、24个页签检查、44张截图，脚本退出码0。

- 两种布局的发现门槛、古站标记点击、详情卡、正式页进入、激活不发资产、主体批准不扣料、真实副船运输扣原仓、存盘重载均通过。
- classic/modern 的桌面与手机六页签均可达；二级面板滚动、末端控件可达、站内无水平溢出、无原始本地化ID均通过。
- 四组调试关闭场景均无空间站导航和进入按钮，已发现标记与卡片保留。
- 四组来源站场景均从人口页真实点击空船返航，核对两分钟时长、船锁不提前释放、计划停止、人口与资产不变，正式回读source/return存档通过。完整到达时序由core专项覆盖，浏览器没有加速时钟。
- 浏览器未捕获异常0条，`console.error` 0条。
- modern手机调试外壳的底部导航已修复：源CSS仅让组内普通按钮在78px基准上参与收缩，以完整内容宽度作下限，不裁切图标或文字。根 `clientWidth=1200`、`scrollWidth=1200`、`scrollLeft=0`。
- 新增导航可达断言：每个modern导航按钮完整位于导航/根容器内、中心命中自身、文字没有横向溢出；本次全部通过。先前22逻辑像素溢出的证据保留在 `player-station-game-smoke-1795243872801/`。

手机使用390x844物理视口、移动UA、触摸及竖屏方向，正式应用会旋转为1200逻辑宽度。不能仅缩小窗口而仍报告横屏。
ready夹具显式造九座设施、六名居民及高级设施所需科研，并经正式 `loadSaveFile` 校验；这些仅为合成验收前提，不代表游戏激活会发放设施或人口。
