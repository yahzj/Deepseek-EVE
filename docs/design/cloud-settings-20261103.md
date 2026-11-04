# 账号与云存档设置（2026-11-03）

状态：本批仅本地合入，不推送；端到端桌面冒烟、全量回归和观感验收仍有未决项。专项与固定检查结果及其他限制见“当前验证状态与未决项”。

本轮追加裁定：注册用户名初值为空，切换注册不预填飞行员；服务器地址不展示给玩家。相关专项134/134通过；typecheck、l10n:check、l10n:params、content:check、ui:rot-check、build均通过。隔离桌面 smoke 两次均在最早的 wait-idle 步骤因 CDP TypeError 中断；最新截图仅确认页面正常渲染、aria-busy=false、无请求、runtimeErrors=0，不代表 smoke 通过。

## 船长原话

“后端已经做好了账号和云存档相关， 你现在将其接入设置内”

## 实施依据与范围

本篇记录verify工作区的整个账号/云存档接入批次，涵盖API、偏好、引擎、设置UI、连接策略及统一验证，不再按子代理拆分结论。依据为后端 `H:\大鲸鱼\whale-server\docs\account-system-design.md` §7 已批准规则。

- 设置的save分类尾部增加账号区与手动云档区，不新增一级tab；未登录不影响本地游戏。布局沿用app-settings-row/head/label/btns/app-btn，区内用分隔线，不套多层卡片。
- preferences.ts唯一可替换的入口是「默认 HTTPS 域名，失败回退明文 IP」（2026-11-04 换新域名后：DEFAULT_CLOUD_SERVER = https://game.bajibaji.party，Let's Encrypt 正式证书、nginx 直连源站不经 Cloudflare；FALLBACK_CLOUD_SERVER = http://123.207.188.192，nginx 80 反代；后者只在网络层失败时单次兜底，成功也不写回偏好、不切换可见服务器），仅无saved server时使用；保留已存server及内部saveCloudServer供配置和自动化测试挂载前注入动态服务。玩家UI无地址label/input/apply，不提供URL/query/window地址设置。未登录不自动请求，有已存会话时首次显示仅核验profile，不自动上传、下载或载入；会话仍按server隔离。
- 地址统一由normalizeCloudServerURL处理：域名必须HTTPS，IP字面量与回环允许HTTP；HTTPS网页不拒绝明文IP（浏览器会以混合内容拦截，正好落到域名回退），但拒绝明文域名。请求禁止重定向、不携带站点cookie、不缓存响应、不自动重试（唯一例外：默认地址网络层失败时对备用域名单次重试）。桌面和网页CSP允许HTTPS、域名（https/wss://game.bajibaji.party）、回退IP（http://123.207.188.192）与回环HTTP连接，脚本策略仍限自身。
- 注册、登录、恢复入口在设置内，用户名初值为空，切换注册清空而非重填飞行员；账号名与存档名独立，不读取或写入character.name。350ms防抖占用预检保留；恢复走redeemRecovery再profile，核验成功才持久化token/profile。密码与恢复码不持久化；恢复码按server/playerId仅驻留renderer内存，标明owner、可复制、手动确认关闭，切分类不丢失。
- 明文HTTP只为止回退IP与回环联调开放，域名仍强制HTTPS；2026-11-04 换域名后主链路已全程加密，明文仅存在于域名不可用时的降级路径。旧域名 https://shit.fuckrapper.online 因域名含敏感词触发运营商 SNI 过滤（国内直连 TLS 握手被重置，桌面登录报 net_error -101）已停用，不再作为任何入口。
- 按最新授权删除未发布且无调用的ui.cloud.003/.004及延期登记，不复用ID；ui.cloud.109改为“在线服务暂不可用，请稍后重试。”，ui.cloud.110改为“无法连接服务器，请检查网络或稍后重试。”，保留enDeferred与英文延期。
- 401清登录；429采用extra.retryAfterMs，缺失或不安全时回退普通限流60000ms、登录锁定600000ms，限制定时器范围。带参数限流提示独立映射并提供p1，不放进无参ERROR_IDS。所有延期ID逐行登记，英文未授权。

## 存档与交互契约

- engine.exportCloudSave先将确切当前快照通过本地保存桥写成功，才返回同一text供上传；本地保存失败不发PUT。
- engine.importCloudSave与文件导入共用importSaveText旧读档链：loadSaveFile校验、铁人检查、修复/迁移、离线结算、候选落盘成功后替换内存。载入全链互斥，保存与tick遵守载入锁；不自动备份，不改游戏save schema或core数值。
- 上传先GET latest预览并显示目标账号、baseVersion；明确确认后保存本地快照，再PUT且必带预览baseVersion，包括0。已有云档需确认替换；409作废确认并只刷新元信息，不覆盖、不自动重试写。超时/断网只报告结果不明，要求刷新状态。
- 元信息与历史列表手动刷新。下载latest或历史版本先检查10MB限制并用loadSaveFile严格预检格式/版本，显示候选版本、飞行员、保存时间与铁人标记；确认后再次核验token、账号、请求代次与写状态，再进入引擎，不自动上传。
- 服务切换、失效token或卸载使网络请求和旧候选失效；写入非ok时禁上传和载入，保留云元信息读取。confirmDownload finally重新读取saveWriteState，避免载入锁释放后UI残留paused。
- 本地commit期间applying阻止设置遮罩关闭、完成、分类点击及键盘切换、恢复默认和存档管理/重置。普通网络busy仍可关闭取消，readonly/paused等其他原因不锁设置，不把已开始的本地写入伪称取消；玩家侧地址输入与应用入口已删除。

## 后端兼容限制

临时真实后台使用startTestApp与SQLite内存库复现：首次signup的token同时写入accounts.token_hash，logout删除sessions后，profile的旧token fallback仍返回200。最终报告 `backendInitialSessionRevocation=false`，这不是已修复的服务端撤销，本批没有改后端。

客户端logout成功后使用同一token再GET profile：401才显示已撤销；200清除本地token并如实显示“已退出本机，服务端会话仍有效。”；核验网络失败同样清本地token，但只声明未确认撤销。logout本身网络失败保留明确的“仅退出本机”。后续登录产生的第二session已验证真实401撤销、重新登录与恢复redeem200。

## 文件清单

以下路径均相对 `H:\大鲸鱼\Deepseek-EVE-verify`。

| 功能分组 | 改动文件 |
| --- | --- |
| API、类型与服务隔离偏好 | `apps/desktop/src/renderer/src/features/cloud/api.ts`、`types.ts`、`preferences.ts` |
| 云设置与状态控制 | `apps/desktop/src/renderer/src/features/cloud/CloudSavePanel.tsx`、`useCloudAccount.ts`、`cloudState.ts`、`cloud.css` |
| 设置入口与本地commit关闭保护 | `apps/desktop/src/renderer/src/panels/appSettings.tsx` |
| 引擎快照、共用导入链与互斥 | `apps/desktop/src/renderer/src/game/engine.ts` |
| 桌面与网页连接策略 | `apps/desktop/src/renderer/index.html`、`web/index.html` |
| 中文ID及英文延期登记 | `packages/data/src/l10n/table.ts`、`docs/l10n-pending.md` |
| 专项与既有生命周期测试适配 | `packages/core/tests/cloud-api-20261103.test.ts`、`cloud-settings-ui-20261103.test.ts`、`cloud-engine-20261103.test.ts`、`guoqing-save-lifecycle-20261029.test.ts` |
| 合成档、真实后台隐藏桌面冒烟 | `tools/cloud-settings-fixture.ts`、`tools/cloud-settings-smoke.cjs` |
| 旧设置冒烟兼容 | `tools/settings-subpages-smoke.cjs`：仅save期望row从2改3，其他计数不动；新增账号row未登录无自动请求 |
| 整批记录与导航 | `docs/design/cloud-settings-20261103.md`、`docs/catalog.md`、生成件`docs/INDEX.md` |

## 当前验证状态与未决项

- 本批专项134/134通过；typecheck、l10n:check、l10n:params、content:check、ui:rot-check、build通过。
- 隔离桌面 smoke 两次都在最早的 wait-idle 步骤因 CDP TypeError 中断，因此不能报告 smoke 通过。最新截图显示页面正常渲染、aria-busy=false、无请求、runtimeErrors=0；这仅是页面状态读数，不替代冒烟或船长观感验收。
- 真实后台自检确认：首次 signup token 在 logout 后，profile 仍返回200；第二次登录取得的 token 在 logout 后，profile 返回401。首次注册令牌的服务端撤销问题仍未解决；客户端按实际核验结果提示，不宣称该 token 已撤销。
- 完整 core 回归有6项测试失败，分布在2个文件；部分失败涉及 ENOMEM 和数据编辑器仓库识别问题，不能记为全量通过。
- 公网 HTTPS endpoint 尚未验证；本机回环 HTTP 联调不能证明公网部署可用。观感验收仍待船长进行。

## 不做与交付状态

- 不接chat/market，不做自动同步、自动备份、自动合并或扩展账户管理；游戏save schema与core数值未改。
- 英文未授权，新增ui.cloud.*保持enDeferred并逐ID登记，不启动翻译。
- 不改后端；本批仅本地合入，不推送。端到端桌面冒烟、全量回归、观感验收与公网 HTTPS 验证仍有未决项。
- 文档收尾优先查询mcp__serena-eve__*，当前环境未配置该namespace，tool_search无结果，已明确降级定向读取现行文件；未查阅归档。docs:index在遍历前排除archive，只生成非归档索引。
