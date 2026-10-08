/**
 * **活动栏"停止/取消"按钮文案 · 单点**（2026-09-27 建 · 三号 verify）
 *
 * 为什么单列一个文件：两套外壳各有一份活动栏 —— `panels/ActivityBar.tsx`（新版）与
 * `panels/ActivityBarClassic.tsx`（旧版）—— 原先**各自抄了一份** `stopLabel()`：函数体的
 * `tr()` id 集合**逐字相同**（12 个 id、顺序一致，实测见 `docs/review/arch-guard-baseline-20260927.md` A1）。
 * 后果 = 活动栏文案要改就得改两处，漏一处两套界面就说法不一。
 *
 * 口径：两套外壳的**其它部分差异很大、各自冻结**，本文件只收"活动类型 → 按钮文案"这一件事。
 * 收口后两处都 import 本文件；改文案只改这里一处。
 * 关联护栏：`npm run arch:guard` 的 F2（已登记单点被别处再写一份即报红）。
 */
import type { ActivityView } from '@whale/core'
import { tr } from '../i18n/locale'

/** 活动行右侧「停止 / 取消 / 召回 / 撤退」按钮的文案（按 `ActivityView.stop` 分派） */
export function stopLabel(v: ActivityView): string {
  switch (v.stop) {
    case 'remove-training':
      return tr('ui.ActivityBar.007')
    case 'stop-mining':
      return tr('ui.ActivityBar.005')
    case 'stop-scan':
      return tr('ui.ActivityBar.008')
    case 'stop-whscan':
      return tr('ui.ActivityBar.031')
    case 'stop-whauto':
      return tr('ui.ActivityBar.009')
    case 'stop-salvage':
      return tr('ui.ActivityBar.005')
    case 'cancel-manufacture':
      return tr('ui.ActivityBar.004')
    case 'stop-refine':
      return tr('ui.ActivityBar.010')
    /**
     * 停一条实验线（**2026-10-01 接入活动栏**）：**复用实验室卡片那颗停止键的字**
     * （`ui.hud.084`「停线」）——同一件事在全仓只有一种说法，不在这里另写一份同义短词。
     */
    case 'stop-lab':
      return tr('ui.hud.084')
    case 'recall-expedition':
      return tr('ui.ActivityBar.009')
    case 'recall-standby':
      return tr('ui.ActivityBar.011')
    case 'retreat-battle':
      return tr('ui.ActivityBar.012')
    case 'cancel-ai':
      return tr('ui.ActivityBar.004')
    case 'cancel-deliver-trip':
      return tr('ui.ActivityBar.013')
    case 'stop-loop':
    case 'stop-invasion-loop':
      return tr('ui.ActivityBar.032')
    case 'stop-hauling':
      return tr('ui.ActivityBar.014')
    default:
      // 原两份实现都是返回空串（没有停止动作的活动不画按钮文案）——这里逐字保留，不改行为
      return ''
  }
}
