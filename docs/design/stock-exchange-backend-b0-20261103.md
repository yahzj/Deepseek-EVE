# 证券交易所 · 后端 B0 工作文档（订单簿/撮合/账户/REST）

> 状态：**B0-1 已实现，待船长验收**（2026-11-03 交付；本地提交 `c1c4cd7`，未推送）
> 验收结论：已验收（2026-11-05，船长批量验收「待验收」项）。原状态行及「未提交／未合入／未推送」等记录为历史事实，保留不删；本次仅收口文档验收状态，不代表代码已合入 main、已推送或已部署。
> 代码位置：独立仓库 `D:\Documents\GitHub\whale-server`（基线提交 `0c621a3`，生产服同源、111 测试全绿）
> 上游设计：`stock-exchange-backend-spec-20261103.md`（契约级）、`stock-exchange-server-20261103.md`（总体）、`stock-exchange-economy-pvp-20261103.md`（经济/PvP）

---

## 一、本批范围（B0-1）：真撮合骨架

| 交付 | 内容 |
|---|---|
| 静态标的 | 4 只：SMHI / UGMC / OJLS / ABSI（价格、锚点、波动档、杠杆上限、可做空） |
| 订单簿 | 内存 CLOB：价格优先/时间优先、全局 seq、买卖五档 |
| 撮合 | maker 定价、禁自成交、限价/市价（IOC 余量撤）、冻结托管 |
| 券商账户 | `exchange_accounts`（cash/frozen/debt）；**入金/出金走现有账本**（`appendEntry`），幂等 nonce、日配额（初值可配） |
| REST | `GET /api/exchange/stocks`、`GET /book/:code`、`GET /trades/:code`、`GET /account`、`POST /deposit`、`POST /withdraw`、`POST /orders`、`DELETE /orders/:id`、`GET /orders/mine` |
| 数据库 | `db.ts` 追加 `exchange_*` 建表（幂等 + PRAGMA 补列模式） |
| 测试 | `src/exchange.test.ts`：撮合、maker 价、自成交拦截、撤单退款、入金/出金账本、余额不为负、幂等 |

## 二、不做（留后续批次）

- 不做杠杆/强平/借券/资金费（B1）
- 不做 WS 实时推送（B0-2）
- 不做 AI 人格/事件/分红（B2）
- 不做条件单/量化（B3）
- 不改游戏主树、不碰 `apps/server`（游戏仓旧版）

## 三、硬约束

- 沿用服务器现有模式：`Bearer` 鉴权（`authenticate`）、`{code,message}` 错误、`BEGIN IMMEDIATE` 事务、禁负余额、只追加账本。
- 服务端独立部署：**不 import 游戏仓 `packages/core`**。
- 交易所静态数据放 `src/exchange/stocks.ts`，**不放 content-csv**（生产上它是 gitignore 的真实拷贝，不可靠）。
- 本地开发闭环（2026-11-03 打通）：`D:\Documents\GitHub\whale-server` 已 `npm install`（npmmirror 绕过坏 lockfile）+ `content-csv` 用服务器真实副本；`npm test` 111/111、`npm run typecheck` 零错误 ⇒ **本地即可验证**。
- 不 commit、不 push、不联网；测试通过后由主代理统一提交/验收。

## 四、验收

1. `npm run typecheck` 零错误；
2. `npm test` 全绿（基线 111 + 新增交易所用例）；
3. 两个测试账号：入金 → 一人挂卖、一人吃单 → 成交、账本可校验、余额不为负；
4. 撤单冻结原路退回；自成交被拒；maker 定价正确；
5. 重启服务后挂单可恢复（B0 可延后到 B0-2，但数据结构要留）。

## 五、部署边界

- 本批**只在本机验证**，不 scp 到生产服；部署等船长验收后另行安排。

---

## 六、B0-1 交付记录（2026-11-03）

- **提交**：`whale-server` 仓 `c1c4cd7`（本地，未推送）；工作树干净。
- **新增**：`src/exchange/{types,stocks,book,matching,account,service,api,db}.ts`（8 模块）。
- **修改**：`src/db.ts`（ensureExchangeTables）、`src/http-api.ts`（挂 `/api/exchange/*`，Bearer + `{code,message}`）、`src/config.ts`（佣金/印花/入金费/日配额，默认 0/0/0/3 亿）。
- **验证（主代理独立跑）**：`npm run typecheck` exit 0；`npm test` **121/121**（基线 111 + 新增 10）；工作树只有允许改动。
- **已覆盖**：标的与空盘口；双账号入金（账本双分录 + nonce 幂等）；限价成交 maker 定价与双方余额/持仓；自成交拦截（市价 409 回滚）；撤单退冻结/非本人 403；佣金+印花税取整与零头退回；市价 IOC 余量撤；错误码（未开户/余额/持股/数量/价格/杠杆）+ 日配额；**重启恢复**（关服重开重建订单簿、seq 续号、冻结与余额恢复、可撤单）。
- **已知取舍/延后**：
  1. 账本只覆盖「钱包 ↔ 券商」闸门；冻结/成交/费税属券商内部划转，记 `exchange_orders/trades/audit`，未逐笔进 `ledger_entries`（要改 `ledger.ts` 增列，留 B1）。
  2. 未建 `exchange_positions`（持仓由成交推导）与 `exchange_stocks`（静态在 `stocks.ts`）。
  3. 出金费/冷却、下单限频、WS/K 线、杠杆>1x、条件单延后（B0-2/B1/B3）。
  4. 服务端仓不在 Serena 项目内（`serena-eve` 指向游戏仓），本批按规则降级 read/grep 并已报告。
- **下一步候选**：B0-2（WS 实时推送 + 客户端真机适配器联调）或 B1（杠杆/强平）。部署生产需船长另行批准。

