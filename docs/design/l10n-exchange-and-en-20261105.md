# 交易所文案迁表与英文准备收口（2026-11-05）

> 状态：**已合入并推送**（代码随 `97261326c` 合入，本工作文档随本批合入）。
> 功能域：本地化（`packages/data` 唯一表 + `apps/desktop` 渲染层取词），跨域已由船长本轮指令授权。

## 一、授权与范围

船长原话：「470 条未译字面量未迁 l10n id，帮我把本地化，英文的部分都做了吧，这个不用太严格验证，全是文本活」。

- 「470 条」出处：`docs/design/exchange-ui-copy-20261105.md:68`（`l10n:check` 报 `features/exchange/texts.ts` 470 条未译字面量，原登记为「跨域、需单独批准」）。本轮指令即该批准。
- 「英文的部分都做了」按 `docs/development-conventions.md:104-105` 判定为**明确启动英文准备**：除迁表外，还须补齐历史 `en: ''` + `enDeferred: true` 条目、清延期标记并同步 `docs/l10n-pending.md`。
- 「不用太严格验证」：只跑类型与本地化/内容专项，不跑全量 core 回归与构建。

**不做**：不改 `TF` 里已有中英双语的模板串、不改组件调用点与 `T` 代理的语言切换、不动其他文件（`itemSubs.ts` / `commsText.ts` 等）的 P3 历史欠账、不动 `l10n-keep` 声明、不改数值经济/服务端/公告、不改 `docs/glossary.md` 与 `glossary-en.md` 词条（本批未造新专名）。

## 二、依据

- `AGENTS.md` §1（新玩家文案先取 id）、§2.1（跨域授权记录）、§5（大文件不盲读）、§8（跨域留痕）。
- `docs/development-conventions.md` 十一之三 `:103-108`：id 一经使用不复用；英文须明确启动；启动后按 `glossary-en.md` 补译、清延期标记；参数槽与检查口径。
- `docs/glossary-en.md`：直译优先、术语冻结表、括号限用、数字与单位空格、参数槽契约。
- `docs/glossary-en.md` §十五：唯一表 `packages/data/src/l10n/table.ts`、id 形态 `<域>.<短名>.<三位序号>`、`l10n-keep` 例外。
- 开工核对：`c52091d90` 已合入他人在途的股市 UI 文案改动，主树当时无未提交 UI 改动，故可安全改 `texts.ts`。

## 三、实现口径

1. **迁表**：`texts.ts` 的 `ZH_T`（461 键）与 `EN_T`（463 键，其中 `newsAgentTag`/`sentimentTitle` 是已走表的 getter、被 `T` 代理拦截，保留不迁）按 `ui.exchangeTexts.001..461` 建 id，中英两列同时进唯一表；源码值改为模块级 `zh(id)`/`en(id)` 取词（`L10N[id].zh` / `.en`），不依赖 locale，语言切换仍由 `T` 代理按 `isEn()` 决定，组件调用点零改动。
2. **零散 23 条**：3 条 `TF` getter 改 `tr('ui.exchangeTf.00x')`；8 个公司名、9 个板块名建 `ui.exchangeStock.*` / `ui.exchangeSector.*`，中英映射表的值一并替换；重复中文复用同一 id。合计再补 20 条表项。
3. **英文准备**：全表 336 条延期条目（332 条历史登记 + 4 条同段在途条目）补英文并清 `enDeferred`；其中 23 条按「同中文串已有英文」自动复用，313 条按 `glossary-en.md` 逐条补译。所有 `{pN}` / `{count}` 参数槽与中文侧集合一致。
4. **登记册**：`docs/l10n-pending.md` 状态列统一改「已完成」，标题改为「英文本地化记录」并加本批完成说明；保持 `deferredL10nIssues` 的「登记集合 = 表内延期集合」判据成立。
5. 批量落盘显式 UTF-8、保留原 CRLF 行尾与 BOM，用 AST 定位插入点；已用 `read_file`/`search_content` 复核中文未转码、`git diff --numstat` 复核表为纯追加。

## 四、改动文件

- `apps/desktop/src/renderer/src/features/exchange/texts.ts`：字面量改 id 取词（含公司名/板块映射、3 条 getter）。
- `packages/data/src/l10n/table.ts`：新增 481 条表项；336 条补英文并清延期标记。
- `docs/l10n-pending.md`：登记状态与标题、完成说明。
- 本工作文档：`docs/design/l10n-exchange-and-en-20261105.md`。
- 一次性探针（`tools/_l10n-*.ts`、`tools/_l10n-en-*.json`）已删除，未入库。

## 五、验证结果

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `npm run l10n:check` | ✅ 通过（表 **7148 → 7633** 条 · 待英文本地化 **0** 条 · 无死引用 · 占位符对齐 · 无残留中日韩字符 · 值形态合规） |
| `npm run l10n:params` | 通过（明确漏参 0 处；5 处参数由变量提供的既有误报嫌疑，未新增） |
| `npm run l10n:core-zh` | 通过（报告型，143 处既有 core 裸中文，本批未新增） |
| `npm run content:check` | ✅ 通过（既有 14 条市场卡/机型警告，与本批无关） |

- `texts.ts` 未译读数 **470 → 0**，已不在 `l10n:check` 未译 Top10。
- 渲染层含 CJK 字面量 **658 → 184**，其中 180 条是已声明 `l10n-keep` 的非文案（类型联合 key / 形状槽键 / 键表 label / 开发探针 / i18n 实现自身），按规则不计欠账。
- 未跑：全量 `npm run test -w @whale/core`（按船长「不用太严格验证」及留集中验收）、`npm run build`、UI 静态契约（本批无 UI/CSS 改动）、观感验收。

## 六、已知取舍与待裁决

1. 其他文件（`ui/itemSubs.ts` 82 条、`exchange/mock/MockExchangeClient.ts` 39 条、`ui/commsText.ts` 31 条等）仍有 P3 界面批历史欠账，本批按范围不动；是否立项逐页消化待船长决定。
2. `TF` 里带 `${}` 的双语模板串不在 `l10n:check` 的静态判据内且已有英文分支，按「不动已工作的代码」保留；若要彻底「源码零中文」，需按参数槽逐条改写，属另一批。
3. 补译按 `glossary-en.md` 现有冻结术语与直译规则出稿，如 `Encrypted Container` / `Damage Control Plug` / `Production Research Lab` 等为组合词直译，未新增词典条目；若船长要固定为新术语，需单独登记 `docs/glossary.md` 与 `glossary-en.md` 并回改。
4. 英文译文未经船长逐条审校，按本轮「不用太严格验证」交付；如需发布前审校口径，另行安排。
5. 本批未写玩家公告（无玩家可见文案新增或变更，仅取词位置与英文列变化；公告需单独明确批准）。
6. 代码已随 `97261326c` 合入并推送；当时与其他在途会话共用主树，按 §4 停写、待对方收口后由该提交统一合入。

## 七、工具说明

Serena MCP（`mcp__serena-eve__*`）与 `dsh-knj-obsidian` 未注入本会话，已按 `AGENTS.md` §5/§5.1/§5.4 明确降级为 read/grep + 一次性 TS 脚本，降级范围限本批本地化迁移；`texts.ts`、`table.ts` 均超 500 行，未做全文盲读，由脚本按 AST 定位后精准改写。未读 `docs/archive/` 与 `docs/design/archive/`。
