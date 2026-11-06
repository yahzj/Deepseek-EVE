# 股市游客只读（移除模拟盘）· 2026-11-05

**状态**：已实现，待船长验收（本地合入，未推送）。
**功能域**：深空证券交易所（客户端 + 设置页），后端零改动；同域内共享页面 props 的小改（`pages/common.ts`、`App.tsx`）属接线，不另算跨域。

## 船长原话

> 股市系统的模拟盘可以去掉了，做成没有登录就只能看，不能操作。用户操作了就提醒他要登入，弹到设置的存档那个界面给他，那边有登入入口，然后，设置里的存档tab的文案，改成账户，这个界面做成登入位置，存档为辅的界面

补充裁定（同日问答）：

> 没有登入涉及到连接服务器的买卖等操作都禁用，然后不能进入专业投资的界面里

两问的答复：游客态**保留完整面板但禁用**（不整块换成登录卡）；账户页排序**账户 → 云端存档 → 本地存档**。

## 该批取代的旧口径

- `docs/design/stock-exchange-backend-spec-20261103.md` §18.1「未登录可看引导页，不可交易；不做遮罩强制跳转」——现改为：未登录连真实服务器看公开行情，操作入口保留但禁用，点击即提示并直接打开「设置 → 账户」；仍不整页遮盖。
- `docs/design/cloud-settings-20261103.md`「设置的 save 分类尾部增加账号区与手动云档区，不新增一级 tab」——现改为：该子页改名「账户」，账号区排最前，云存档次之，本地存档最后。

## 方案

### 客户端

- **数据源**：删除运行时模拟盘。`factory.ts` 只保留真实服务器一条链，按云会话是否带 token 决定身份：`guest`（匿名）或 `account`（带令牌）。
- **匿名连接**：`RendererTransport` 增加 `allowAnonymous`——匿名时 GET/WS 不带 `Authorization`/`token=`，写请求（非 GET）在本地直接抛 `ExchangeAuthError`，不会打到服务器。
- **匿名启动**：`HttpExchangeClient` 增加 `guest` 标记，游客跳过 `account/orders/strategies/round/bond/fund` 等私有接口，只拉公开行情（stocks/book/trades/klines/news/agents/meta），写方法照旧实现但在参数校验前就被传输层拦下。
- **登录切换**：`ExchangePage`、`ActivityBar`、`SidebarExchangeCard` 监听 `whale-cloud-session-change`，登录/退出后重建客户端实例；匿名与登录实例在 `factory` 的单例缓存里按 `serverUrl|auth|playerId|transport` 分开。
- **游客 UI**（保留面板但禁用）：
  - 顶栏徽标改为「已登录 / 游客 · 只读」，顶栏下方加一行提示条 +「登录 / 注册」按钮；
  - 入金/出金按钮加虚线禁用态，点击走登录引导；
  - PRO 模式页签锁死（`aria-disabled` + 提示），存档里的专业偏好不清除，登录后自动恢复；
  - 极简模式下，买卖舱、持仓/委托与理财面板套禁用遮罩（灰化 + 整块可点），点哪里都提示一次并打开「设置 → 账户」；行情列表、走势图、快讯照常可看可交互。
- **登录引导**：`PageProps` 增加 `onOpenSettings(page?)`；交易所被拦下的操作调用 `onOpenSettings('account')`，设置面板直接落在账户子页。

### 设置页

- 子页 id `save` → `account`，标签文案「存档」→「账户」（`ui.settingsTab.004`）。
- 账户页顺序：`CloudSavePanel`（账号区 → 云存档区）→「本地存档」小标题 → 存储状态行 → 保存/存档管理/重置档案按钮。

### 文案

- 新增 `ui.exchangeTexts.466–472`（游客徽标、提示条、禁用层、登录引导、PRO 锁定）与 `ui.saveGuard.028`（本地存档）；英文按全量双语批次直接落地，不登记延期。
- 删除模拟盘专用条目 `ui.exchangeTexts.035/036/042/043/044`。

## 不做

- 不改 Go 服务器：公开路由与匿名 WS 已够用（`exchange-server-go/internal/exchange/api.go`、`ws.go`）。
- 不动 `MockExchangeClient` 本体：`tools/exchange-feedback-fixtures`、`tools/exchange-headless` 仍直接引用它做夹具。
- 不修 `ActivityBar` 保底收益轮询的既有守卫缺陷（`error !== undefined` 恒真，轮询从不运行），另案处理。

## 验证

- `npm run typecheck`
- `npm run l10n:check`
- `npm run content:check`
- `npm run ui:rot-check`
- `node --import tsx --test tools/exchange-guest-mode.test.ts`（新增：游客只发公开请求；匿名写请求本地即抛）

## 已知取舍

- 游客看不到回合徽标（`getRound()` 在游客态抛 `login_required`，被 `RoundBadge` 的 catch 吞掉返回 null）；回合号属私有读数，不额外公开。
- 游客横幅占一行高度，极简模式三栏高度相应减少；按盒模型核算（横幅 `flex-shrink: 0`、三栏 `min-height: 0`）不会溢出，观感与 1080p 实际几何仍以船长验收为准。
- 匿名 WS 只收公开帧，行情/盘口/成交照常推送；账户帧要登录后重连才有。
