# 股票交易所系统交接文档（Handoff）

> 交接日期：2026-11-04 14:10（Asia/Shanghai）
> 交接范围：大鲸鱼-深空放置 · 深空证券交易所（Go 交易引擎 + 桌面端股市页 + 生产部署）
> 阅读顺序：本文 → `FAST_WORKFLOW.md`（工作流优先级最高）→ `docs/catalog.md` → `docs/design/stock-exchange-integration-20261103.md`（部署/验收流水）

---

## 0. 一句话现状

**可游玩、已上线、自动化验收全绿**。生产在 `123.207.188.192`：Go 交易所（回合制 5 分钟、每回合 10 手、回合内 10 秒行情步进）+ Node 云端账号 + 桌面端股市页（极简/专业双模式、入金出金、债券/基金、做空、64 事件、六人格）。唯一未闭环的是**船长本人真人试玩确认**（已多次待验收）。

---

## 1. 仓库与工作区

| 仓库 | 路径 | 远端 | 说明 |
|---|---|---|---|
| 游戏主仓（Electron + Vite + core/data/ui） | `D:\Documents\GitHub\Deepseek-EVE` | `https://github.com/yahzj/Deepseek-EVE.git`，分支 `main` | 最新提交 `011c94eb`（恢复 Sparkline），已推送 |
| Go 交易引擎 | `D:\Documents\GitHub\whale-server-go` | **无远端**（本地仓库） | 最新提交 `b59d974`（10 秒行情步进 + 快讯措辞） |
| Node 云端服务 | `D:\Documents\GitHub\whale-server` | **无远端** | 账号/会话/存档云同步，端口 8787 |

> 注意：主工作树同时被「UI review AI」改写 UI 文件；不要覆盖他人在途修改。遇到疑似重叠改动先停写、报告证据。`FAST_WORKFLOW.md` 声明优先级高于 `AGENTS.md`；汇报第一行固定「册那，侬帮帮忙啦。」（船长要求）。

---

## 2. 生产环境

- 机器：腾讯云 `lhins-2ko2lh7m`，公网 IP `123.207.188.192`，用户 `ubuntu`。**密码不入库，单独口头交接**。
- 服务（systemd）：
  - `whale-server.service`：Node 云端，`127.0.0.1:8787`
  - `whale-exchange.service`：Go 交易所，`127.0.0.1:8788`
  - `nginx`：443 域名 `shit.fuckrapper.online`（HTTPS）；80 端口 IP 直连通道（明文 HTTP，船长已接受风险），allowlist 仅 `127.0.0.1`、`124.90.21.128`；路由 `/api/exchange/` → 8788，`/internal/*` → 404，其余 → 8787。
- Go 二进制：`/home/ubuntu/whale-exchange/whale-exchange`；**回滚备份 `/home/ubuntu/whale-exchange/whale-exchange.prev`**。
- 数据库：
  - 交易所：`/home/ubuntu/whale-exchange/data/whale-exchange.db`（SQLite，`node:sqlite` 可读查）
  - 账号/会话：`/home/ubuntu/whale-server/data/whale-server.db`
- 日志：`sudo journalctl -u whale-exchange -f` / `-u whale-server`；nginx `/var/log/nginx/access.log`。
- systemd 环境变量（**以 `systemctl cat whale-exchange` 现场为准**）：
  `EXCHANGE_ROUND_SEC=300`、`EXCHANGE_HISTORY_BARS=2016`、`EXCHANGE_LOCAL_SAVE_MODE=1`、`EXCHANGE_ROUND_LIMIT_BP=300`、`EXCHANGE_ROUND_EVENT_LIMIT_BP=800`、`EXCHANGE_SHORT_ENABLED=1`、`EXCHANGE_BORROW_POOL=100000`、`EXCHANGE_BORROW_RATE_BP=5`；新增默认 `EXCHANGE_INTRA_TICK_SEC=10`（0=关闭回合内行情）。
- 本地网络限制（排查时先知道）：本机 SNI TLS 直连服务器 IP 会被拦；腾讯云对未备案域名 HTTP 有阻断（80 返回备案 302 页、443 带 SNI 的 TLS 被 RST）；因此「IP 直连 + 明文 HTTP」是船长最初选定的通路。**2026-11-05 更新**：nginx 已增开 8443 并复用同一 Let's Encrypt 证书，`https://game.bajibaji.party:8443` 的 HTTPS/WSS 可用（客户端默认入口已切 8443），详见 `cloud-8443-20261105.md`。

---

## 3. 核心机制（Go 引擎）

### 3.1 回合制
- 回合长度 300 秒；回合末前 10 秒锁单（禁止提交/撤销）。
- 每账户每回合最多 **10 单**（`EXCHANGE_ROUND_MAX_ORDERS` 默认 10）→ 5 分钟 10 手，和船长「10 秒数据变动 + 5 分钟 10 手」口径一致。
- 回合末集合竞价：单一清算价、取最大成交量、同量取最接近前收；成交在 `settleRoundLocked` 分发（现货/杠杆多/杠杆空/平空/借券费/强平）。
- **回合内 10 秒行情步进**（2026-11-04 新增）：`Service.Tick` 在非回合边界每 `IntraTickSeconds` 做小步随机游走，更新内存价格、涨跌幅钳制（基准 = 本回合开盘价）、刷新做市盘口并广播 `stocks` / `book` 帧；**不撮合、不写 K 线**。撮合与 K 线仍只在回合末发生。

### 3.2 价格与波动
- 涨跌幅限制：普通回合 ±3%，事件回合 ±8%（`limits.go`，引擎价与清算价都钳制）。
- 波动率校准（防每回合顶死涨跌停）：`priceModelOf` sigma 高波动 0.00030 / 中 0.00025 / 低 0.00020（每秒），scale clamp `[0.35, 1.6]`。

### 3.3 事件（64 个）
- 结构：四象（太阳/少阴/少阳/太阴）× 4 标的 × 4 强度 = 64；每回合 25% 概率触发，下一回合生效，持续 1~3 回合衰减。
- 玩家向文案（2026-11-04 船长口径）：
  - 不出现内部设定（四象名、冲击 bp、小盘 ×1.5）；
  - 标题：`［传闻/确认/升级/失控］故事标题：公司（代码）标签`；
  - 正文：故事 + 强度追加句 + `该消息预计持续影响 N 个回合，强度为「…」。`
  - 内部字段 `Xiang/XiangName/ImpactBp/SmallCap` 仍保留在 `/events` 与 DB，仅不写进快讯文案。

### 3.4 六人格（EVE 风）
星门局 K7A0 / 截击者 F4B1 / 锚定者 A2C7 / 黑隐者 C3A8（做空）/ 克隆潮 H5D6 / 利维坦 L2F9。回合末决策、真实资金与持仓（负数账户 ID），持仓持久化在 `exchange_agent_positions`。

### 3.5 做空 / 借券
- 券源池每标的 10 万股，借券费 5bp/回合（利用率越高越贵）；空头持仓、强平价、平空归还券源。
- 杠杆档 2/5/10/20/50/90；**1x 为全额保证金**（2026-11-04 船长令：简单界面「看跌」与「看涨」对称，投入多少占用多少）。`POST /orders {side:sell, leverage, short:true}` 开空，`POST /positions/:code/short/close` 平空，`GET /api/exchange/borrow` 查券池。
- 1x 空头不设强平价（`shortLiqPrice` 返回 0），强平改为「无强平价时只看权益线」；1x 平空不冻结现金、结算按 `CommissionBp` 计费，与现货同源。
- 黑隐者仍按「跌幅/高估」逻辑用 2x 开空。
- 生产当前仍有黑隐者 SMHI 空头持仓（持久化验证过跨重启恢复）。

### 3.6 资金模型（LocalSaveMode）
- 游戏存档币**本地为准**：前端入金扣本地 ISK（`engine.exchangeWalletDelta`），服务端只记交易所账；出金反向加回本地。作弊不设防，线上算法保证公平（船长原话）。
- 回滚开关：`EXCHANGE_LOCAL_SAVE_MODE=0` → 恢复旧「Node 钱包桥」模式。

### 3.6.1 手续费
- 生产 `commissionBp = 1`、`stampBp = 1`（systemd `EXCHANGE_COMMISSION_BP` / `EXCHANGE_STAMP_BP`），即买卖各 **0.01%**；`/api/exchange/meta` 下发 `feeRate = 0.0001`。
- 杠杆档 2x+ 仍走 `leverageFeeBp`（≤20x 买 5bp / 卖 10bp；>20x 且 ≤50x 买 3bp / 卖 6bp；>50x 买 2bp / 卖 4bp）；1x 与现货按 `CommissionBp` 计（当前生产 1bp = 0.01%，买卖同价），成交用 `feeOf`（向下取整）、冻结用 `ceilFeeOf`（向上取整）。
- 代码默认值仍是 0（`Defaults()`），生产以环境变量为准；重装机器时须一并写入 systemd。

### 3.7 极简模式保底产品
- 债券：**交易所现金**申购（2026-11-04 修订，船长原话「债券也要用入金的钱包购买」）。`GET /bond` 查持仓、`POST /bond/open` 申购、`POST /bond/redeem` 赎回；单利 3bp/分钟、不滚本，服务端一次乘法惰性结算，表 `exchange_bond_positions`。
- 基金：**放置型**（2026-11-04 修订）。`GET /fund` 查持仓、`POST /fund/open` 申购、`POST /fund/redeem` 赎回；本金锁定，按真实分钟逐分钟结算（70% +16bp / 30% −7bp，期望 +9bp ≈ 债券 3 倍），亏损真实发生、随时可赎；逐分钟结果由 `HMAC(fundSecret, "fund|<account>|<minute>")` 决定，可重放；audit 走 `exchange_transfers.kind=fund_open/fund_redeem`。
- 两者都在左侧活动栏交易所卡片显示收益（有持仓才显示），跟随行情轮询 10 秒刷新。

### 3.8 API 与数据表（摘要）
- 主要接口：`/api/exchange/{meta,round,stocks,book/:code,trades/:code,klines/:code,account,orders,positions,trades/mine,news,events,agents,borrow,strategies,deposit,withdraw,bond,bond/open,bond/redeem,fund,fund/open,fund/redeem,stream(WS)}`。
- K 线 interval 支持 `1m/5m/1h/1d/1w/1mo`，单次上限 2016 根；1 周历史用 5m×2016 拉满。
- 关键表：`exchange_accounts, exchange_orders, exchange_trades, exchange_holdings, exchange_positions, exchange_agents, exchange_agent_positions, exchange_events, exchange_news, exchange_klines, exchange_transfers, exchange_bond_positions, exchange_fund_positions`；券池在 meta `borrow_pool`。

---

## 4. 桌面端股市页

- 入口：左侧导航「股市」→ `apps/desktop/src/renderer/src/features/exchange/`。
- 双模式：极简看盘（左列表+图+买舱+债券/基金）、专业终端（K 线/盘口/深度/持仓/委托）。
- 客户端：
  - `client.ts` 接口；`http/HttpExchangeClient.ts` + `http/RendererTransport.ts`（fetch + WS，Bearer token）；`mock/` 为离线模拟盘。
  - 默认服务器 `http://123.207.188.192`，失败回退 `https://shit.fuckrapper.online`（`factory.ts`）；CSP 在两个 `index.html` 放行该 IP。
- 回合制 UI：
  - `RoundBadge`：回合倒计时/本回合委托配额（每回合 10 单）。
  - 买舱提交后显示「本回合待成交委托」（回合末集合竞价成交）；toast 不再误报「已成交」。
- 快讯：竖向列表，每 60 秒最多追加一行（最多 4 行）；旧快讯前端兜底清理内部元信息。
- 图表：专业终端与极简图周期统一 **M1 / M5 / H5 / D5 / D35**（H5/D5/D35 由 1h/1d 客户端聚合，时间轴按周期显示时分/日期/年月）；专业终端有滚轮缩放/拖拽平移（原生非 passive wheel 监听，无 preventDefault 警告）。
- 缓存与刷新：
  - 行情/账户/盘口每 **10 秒**刷新，K 线约每 30 秒。
  - K 线 localStorage 缓存 7 天：`whale-idle:exch-charts:v1`（启动先渲染缓存再网络刷新）；4 只股票图表后台预载。
  - 左栏 4 股票卡片名字右侧 **Sparkline 小曲线必须保留**（2026-11-04 船长强调）；已修复「首次空数据后被 useMemo 锁死不重算」的消失问题。
- 用词：交易所 UI 中「标的」改为「股票」（专业终端用词被船长纠过；如要换词待船长确认）。
- 已知取舍：回合内只动报价，K 线仍按回合（5 分钟）落一根；若船长要 10 秒级 K 线，需要引擎在回合内写 1m bar（当前未做）。
- UI review AI 的改动：`revert(ui): rollback all global and classic UI files…`（`2367c1b5`）已回滚全局/经典 UI；交易所功能保持完好。**不要覆盖他人在途 UI 文件**。

---

## 5. 最近提交（关键）

游戏仓（`main`，已推送）：
- `011c94eb` fix(exchange)：恢复左栏小曲线 + Sparkline 去 useMemo
- `0a533d6f` feat(exchange)：10 秒行情刷新、竖向快讯、M1/M5/H5/D5/D35、7 天 K 线缓存
- `727589bf` fix(ui)：修复 TooltipLayer 无限 setState + CSP 非法源
- `953f2136` fix(exchange)：K 线轮滚 passive 警告 + 加载提速
- `22f73e4f` fix(exchange)：切换标的补拉 K 线/盘口（非 SMHI 图表一直初始化中的根因）
- `221677cc`/`39d35ab5`/`e39ce741`：极简买舱回合制反馈 + 两次构建修复
- `94ee6223`/`3083708c`/`92d747bb`：玩家做空闭环、5 回合机器人试玩等验收记录

Go 仓（本地，无远端）：
- `b59d974` feat(exchange)：回合内 10 秒行情步进 + 事件快讯玩家向措辞
- 更早：做空 v1、agent 持仓持久化、波动率校准、涨跌幅限制

---

## 6. 验证方法（接手先跑一遍）

Go（`D:\Documents\GitHub\whale-server-go`）：
```powershell
go vet ./...
go test -count=1 ./...                    # 全绿约 7s
$env:GOOS='linux'; $env:GOARCH='amd64'
go build -trimpath -ldflags="-s -w" -o whale-exchange-linux ./cmd/exchange
```

前端（`D:\Documents\GitHub\Deepseek-EVE`）：
```powershell
npm run typecheck
npm run ui:rot-check
npm run ui:theme-check
npm run content:check
npm run build            # electron-vite，约 12s，产物重 7.2MB
```

Node 服务（`D:\Documents\GitHub\whale-server`）：`npm test`（当前 135 通过）。

生产冒烟（SSH 见第 7 节）：
```bash
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8788/health    # 200
curl -s http://127.0.0.1:8788/api/exchange/stocks
sudo journalctl -u whale-exchange --since '5 min ago' | grep -Ei 'panic|abort|error'
```
实测证据（2026-11-04）：10 秒内 SMHI 140930→141091、UGMC 94509→94473 等；图表探针四标的 m1/h1 均 200 根、盘口 10 档。

---

## 7. 部署 / 回滚

本地构建 → 上传 → 替换 → 重启（密码单独交接）：
```bash
# 本机
scp whale-exchange-linux ubuntu@123.207.188.192:/home/ubuntu/whale-exchange/whale-exchange.new
# 服务器
cd /home/ubuntu/whale-exchange
cp -f whale-exchange whale-exchange.prev
chmod +x whale-exchange.new && mv -f whale-exchange.new whale-exchange
sudo systemctl restart whale-exchange.service
sleep 6
systemctl is-active whale-exchange && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8788/health
```
回滚：
```bash
cd /home/ubuntu/whale-exchange
cp -f whale-exchange.prev whale-exchange && sudo systemctl restart whale-exchange.service
```
功能级回滚开关（改 systemd 环境变量后 restart）：
- `EXCHANGE_LOCAL_SAVE_MODE=0`：恢复旧钱包桥资金模型
- `EXCHANGE_SHORT_ENABLED=0`：关闭做空/借券
- `EXCHANGE_ROUND_LIMIT_BP=0`：关闭涨跌幅限制
- `EXCHANGE_INTRA_TICK_SEC=0`：关闭回合内 10 秒行情步进

---

## 8. 未完成 / 待确认 / 坑

1. **船长真人试玩确认**（唯一验收缺口）：需要船长从桌面端刷新/重登 → 股市 → 入金 → 债券/基金 → 等回合下单；目标曾标 blocked 等待该确认。
2. 「标的」→「股票」的最终用词：船长只提过专业终端用词不对，未确认新词；如要换（品种/证券等）等指令。
3. **回合内 K 线**：10 秒只动报价，K 线仍 5 分钟一根；若船长要求图表也 10 秒动，需要引擎在回合内 upsert 1m K 线。
4. 测试账号残留：`smoke*`/`bot*`/`e2e*` 以及账号 17 有债务 383,394；可清理但注意别删船长账号（`dadadada` id 18）。
5. Node/Go 两个仓库**没有远端**，交接时需拷贝或建远端。
6. 生产 IP 明文通道 allowlist 仅限 `127.0.0.1`/`124.90.21.128`；换网络/换人需改 nginx allowlist。
7. 交易所文档：`docs/design/stock-exchange-integration-20261103.md` §8.6–8.11 有部署/回滚/E2E/机器人试玩证据；事件目录/设计稿在 `stock-exchange-events-64-*`、`stock-exchange-short-selling-20261103.md`、`stock-exchange-products-20261104.md`、`stock-exchange-round-model-20261103.md`。2026-11-04 晚间的保底产品放置型、债券改交易所现金、1x 做空、手续费 1bp、左侧栏收益、快讯两行、按钮进度条、行情百分比已补进本文件 §3.5–3.8 与 products 文档。
8. 已知 UI 冲突：UI review AI 会持续改交易所组件（本轮已回滚全局 UI 且保持交易所功能）；改前先 `git status`，别覆盖在途文件。
9. Tooltip 死循环已修（`TooltipLayer` effect 依赖问题），但 UI 层若有类似「displayState 进依赖」模式要注意同类回归。
10. 安全边界：本地存档作弊不设防（船长允许）；IP 明文 HTTP 风险船长已接受；token 存在客户端 localStorage。
11. 简单界面图表已**固定为「分时」**（原 M1/M5/H1/日线/周线切换入口已移除）；`HttpExchangeClient.ensureChartData(code, period)` 的按需加载仍在，恢复周期切换时直接接回即可。
12. 微光纳米（SPRK）低价股 `priceTick = 1` 曾让 5 分钟 K 线常出现四价相同。2026-11-04 船长选 A：锚定从 60 抬到 500（`internal/exchange/stocks.go`，一个价位 = 0.2%），生产 K 线按 25/3 等比缩放、行情状态 `x=0` 重新锚定；成交量仍只在回合末出现（回合内不撮合的已知分层）。

---

## 9. 接手第一步 checklist

1. 读 `FAST_WORKFLOW.md`（工作流优先级最高），再读本文件第 2/3/4 节。
2. 确认生产健康：三个服务 active、`/health` 200、回合在推进、10 秒价格在动。
3. 跑第 6 节全部检查，确认基线绿。
4. 找船长要：服务器密码、真人试玩确认、「标的」用词目标、是否要 10 秒级 K 线。
5. 任何新需求先按第 8 节确认范围；纯 bug 修复直接改，改动跑对应专项检查再交付。

---

## 10. 一句话交接

生产可用、回滚齐全、自动化验收全绿；后续重心是船长试玩确认 + 回合内 K 线/用词等体验细节，以及给三个仓库补齐远端与文档。
