# 战斗页伤害飘字：停留时间延长 + 字重 900（2026-09-25）

状态：**进行中** —— 改动已落码、七道闸门全绿；归档按 AGENTS.md §8（船长验收后当批做：
关键内容并入 roadmap 一条 → 删本文件 → 重跑 `docs:index`）。

## 船长原话（照抄）

> 「**修复隐患。战斗页面中，伤害数字的停留时间延长，使用粗体字。**」

（前半句「修复隐患」= 我上一批汇报里点出的 `makeTestCtx` 共享 `balance` 隐患 —— 已单列处理，
见工作文档 `rare-supply-single-piece-20260925.md` 的「顺带发现」一节，本文件只管后半句。）

## 改动

| 项 | 旧 | 新 | 落点 |
| --- | --- | --- | --- |
| 飘字停留 | `POPUP_LIFE` = **900 ms** | **1500 ms**（+67%） | `apps/desktop/.../panels/battleViewCore.tsx` |
| 字重 | `font-weight: 700` | **900** | `apps/desktop/.../styles.css` 的 `.app-bts-pop` |

- `POPUP_LIFE` 是**一个常量驱动两处**：① `BattleScreen` 的存活过滤 `.filter(now - born < POPUP_LIFE)`；
  ② 元素内联的 `animationDuration` ⇒ 改一处，飘字**飘得更慢、也留得更久**，且仍走**战斗时钟**
  （倍速跟着快、暂停即冻结 —— 2026-09-24 那批的口径未动）。
- 动画本身（`@keyframes bts-pop-rise`：0% 淡入 → 18% 全亮 → 100% 上飘 −210% 淡出）**未动**，只是被拉长。

## ⚠ 关于"粗体"的一条实话（要塞给船长的话）

`.app-bts-pop` **原本就已经是 `font-weight: 700`**，本次提到 900；但字体面 `--wui-mono`
（`packages/ui/src/index.css`：`'Cascadia Mono', 'Consolas', 'Courier New', monospace`）
**最重只有 Bold(700)** ⇒ **900 会回落到 Bold，视觉上与改前一致**。
若船长要的是"看起来更粗"，可选（都不大，一句话即可）：
① 换一个带 **Black/Heavy** 字重的字体面；② 加 `-webkit-text-stroke: .5px currentColor` 加粗笔画；
③ 字号从 `--wui-fs-base` 抬一档（"更醒目"通常靠字号＋停留比纯字重有效）。
另外：飘字**只有 18%~100% 这一段在淡出**，观感上"停留"≈ 该段的绝对秒数 —— 900 → 1500 后
淡出段同步变长约 1.7 倍。

## 验证

- `typecheck` 四包 0 错 · core **210 文件 / 2365 用例全绿** · `ui:rot-check` ✅ · `ui:theme-check` ✅
  （色板 token 契约 + 伤害类型配色契约）· `l10n:check` ✅ · `content:check` ✅ · `build` ✅。
- ⚠ 按 §6「**观感审查权在船长**」：本批是 UI 改动，我只跑闸门、**不截屏当验收**；停留与字重的最终手感请船长实机看。
