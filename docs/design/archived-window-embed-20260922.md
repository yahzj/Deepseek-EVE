# 归档备用：窗口化 / 嵌入主区 这一整套界面改动（2026-09-22）

状态：**已封存 · 备用**（代码已回滚，改动完整保存在归档分支里，随时可复活）

> 船长令（2026-09-22，照抄）：
> 「**界面回滚，战斗界面回滚到全屏显示。但是现有改动进行归档备用。**」

## 一、它是什么（被封存的这套设计）

一句话：**把"战斗观战"和"主控活动"从整屏覆盖层改成游戏内窗口，最后演进成"嵌进主区、顶掉当前那一页"**。

演进链（每一环都曾是船长令，逐环迭代出的）：

| # | 形态 | 船长原话（摘要） |
|---|---|---|
| 1 | 战斗窗口由**整屏覆盖层** → **非全屏可最小化窗口**；新增主控活动窗口 | 「是类似战斗场景那样弹出一个窗口，可以进行最小化」 |
| 2 | 窗口**覆盖主内容区**（不盖左导航/顶栏、去遮罩、窗外可点穿） | 「弹出的悬浮窗口形式有些太遮挡了，能否改为覆盖在当前的主窗口上？」 |
| 3 | 右下角浮动还原标**并入左上角小窗**（小窗变还原按钮 +「⤢」角标） | 「将左上角的小窗动画和右下角的最小化相关的按钮合并」 |
| 4 | 窄屏**整块等比缩放**（固定设计尺寸 + `--win-scale`） | 「窄屏窗口偏小采用等比缩放」 |
| 5 | **取消悬浮，嵌入主区、顶掉那一页**；四类操作自动收起 | 「取消悬浮，直接嵌入主窗口…点击最小化或者切换导航栏之类的时候就隐藏并最小化」 |
| 6 | **洞内战斗内嵌进虫洞探索界面**（面板主体让给战场，只留读数条） | 「虫洞内的战斗因为舰船比较多，能否改为内嵌在虫洞探索界面内？」 |

## 二、归档位置（怎么找回 / 怎么复活）

- **分支**：`archive/window-embed-20260922`（= 回滚前的 `main`：`c479dc9f`）
- **标签**：`archive-window-embed-20260922`
- **改动范围**：`e05c4084^..e98e945a`（起止都在这条链上；分支里含全部中间迭代与验证记录）

复活方式（按需挑）：

```bash
# 看整套改动
git diff e05c4084^..archive/window-embed-20260922 -- apps/desktop packages/data/src/l10n

# 只要某个文件的那一版（例：窗口壳）
git checkout archive/window-embed-20260922 -- apps/desktop/src/renderer/src/ui/WinBox.tsx

# 只要某几处（例：虫洞内嵌）
git checkout archive/window-embed-20260922 -- \
  apps/desktop/src/renderer/src/panels/Wormhole.tsx \
  tools/make-whbattle-save.ts docs/test-saves/test-save-wh-battle-202609220658.json
```

## 三、这套改动的文件清单（封存内容一览）

**新增**
- `apps/desktop/src/renderer/src/ui/WinBox.tsx` —— 公共窗口壳（顶栏/最小化/`bare` 不带壳模式）
- `apps/desktop/src/renderer/src/ui/ActivityScreen.tsx` —— 主控活动窗口（采掘/打捞/运输/扫描）
- `apps/desktop/src/renderer/src/ui/activityArt.tsx` —— 活动窗口演出层（真实舰形 + 星野 + 漂浮物 + 两层动画）
- `tools/activity-win-probe.ts`（`npm run ui:actwin`）—— 窗口几何/演出/收起链 无头读数工具
- `tools/make-whbattle-save.ts`（`npm run save:whbattle`）—— 造"洞内战斗进行中"的可载入真档
- `docs/test-saves/test-save-wh-battle-202609220658.json` —— 上一条产出的验收档（双方各 2 艘）

**改动**
- `App.tsx`：窗口宿主（`.app-win-host`）、页面让位、四类自动收起、还原入口接线、洞内战斗自动叫起面板（电平判据）
- `panels/BattleScreen.tsx`：套窗口壳、`bare` 模式、最小化口径与文案
- `panels/Wormhole.tsx`：`battleSlot` 内嵌战场 + `wormholeHostsBattle` 判据 + 交火中关闭面板不再等于离洞
- `panels/Announcements.tsx`：新增 `onOpen`（开公告即收起窗口）
- `ui/ShipStatusWin.tsx`：小窗变还原按钮（`is-restore` +「⤢」角标）
- `styles.css`：`.app-winbox*` / `.app-win-host` / `.app-page-content.is-win-hidden` / `.app-wh-battle` / `.app-act-*` / `.app-shipwin-wrap`
- `packages/data/src/l10n/table.ts`：`ui.ActivityWin.*`、`ui.Wormhole.378/.379`、`ui.App.083`、`ui.BattleScreen.105/.107` 等
- `package.json`：`ui:actwin` / `save:whbattle` 两个脚本

## 四、⚠ 同批**顺带修好、不随本次回滚走**的东西（别一起删掉）

这些是**独立的缺陷修复 / 船长单独交代的事**，与"窗口形态"无关，回滚时**保留**：

- **敌舰血条比我方短一截**（`4835b90c`）：`.app-bts-unit > .app-bts-hpWrap.is-unitBar { max-width: none }`
- **战斗窗口那枚按钮的文案口径**（`c7fa0798`）：不再写"退出战斗"（它不中止战斗）
- **中英双语本地化两批**（`44ff7d1a`、`ff8846c4`）：各页/各筛选/子标签页
- **错误提示居中**（`f821b965`）：后被一号的「浮动提示分档」接续（普通回下方、警告留中间）——以现行版本为准
- **战后战报弹不出来**的修（曾被我改坏、又修回）：回滚时**必须保持"战报打得开"**这一条行为
- l10n 表里那些**与窗口无关**的条目（各页文案）一律保留

## 五、封存时的验证记录（当时全绿，供复活时对照）

- 闸门：typecheck 四包 0 错 · core **2089** 例全绿 · `l10n:check` ✅ · `content:check` ✅ · `ui:rot-check` ✅ · `build` ✅ · `docs:index` ✅
- 探针 `npm run ui:actwin`（三种视口）：
  - **嵌入形态**：五场景 `position=static z=auto`（嵌入=是）· 填满活动栏下那块=是 · 页面让位=是 · 无文档溢出
  - **收起链**六步真点：点最小化 → 窗口消失+页面回来+小窗变还原按钮；点小窗 → 回来；切导航 → 自动收起；开弹层（手册）→ 自动收起；点活动栏「停止」→ 活动结束自动收起
  - **洞内战斗宿主**：⓪自动开面板=是 · ①战场在面板内 1036×521 且填满读数条之下那块=是 · ②主区无第二份战场、页面不让位 · ③点「✕ 关闭」⇒ 面板收掉、战场挪回主区、这一趟照常推进
- 过程中踩过的两个"夹具"坑（复活时别再踩）：① 手造洞内战斗（把远征战斗对象搬进 `run.battle`）是**无效夹具**，`wormholeBattleViewOf` 按这一趟编队/威胁重建视图，单位对不上就抛错、整块面板被 React 收回 ⇒ 要用引擎自己的 `wormholeStartBattle` 开真战斗；② 夹具放旧会被**离线结算**把瞬时态（战斗）当场跑掉 ⇒ 加载时把存档时间戳改成"刚刚"。

## 六、回滚之后

战斗界面回到**全屏显示**（本轮之前的形态）；本文件与归档分支/标签是这套设计的唯一入口。
若日后要复活，建议**按需取用**（见第二节），不要整分支合并——第 5、6 环依赖"嵌入主区"这一整套宿主机制，
单独取一环会缺依赖。
