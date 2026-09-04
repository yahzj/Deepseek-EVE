/**
 * 远征途中事件表（M5）：航行途中随机遭遇的文字叙事。
 * 抽取规则：出发时按 travelEventChance 判定遇到与否，再按 weight 抽一种；
 * 效果三类：纯趣闻（none）/ 捞到 ISK / 捞到矿物。
 */

import type { TravelEventDef } from '@whale/core'

export const TRAVEL_EVENTS: readonly TravelEventDef[] = [
  {
    id: 'ev-derelict',
    name: '漂流集装箱',
    text: '舰队在航线上发现一只漂流集装箱，拖回空间站拆解后换了一笔赏金',
    weight: 20,
    effect: { kind: 'isk', min: 3_000, max: 9_000 },
  },
  {
    id: 'ev-mineral-cloud',
    name: '矿物碎云',
    text: '一片被炸散的矿粉云挡住航线，舰队顺手全数吸入货舱',
    weight: 12,
    effect: { kind: 'mineral', itemId: 'min-pyerite', units: 150 },
  },
  {
    id: 'ev-aurora',
    name: '跃迁极光',
    text: '跃迁通道内极光涌动，全舰船员驻足观赏——航程并未因此延误',
    weight: 12,
    effect: { kind: 'none' },
  },
  {
    id: 'ev-scout',
    name: '海盗侦察',
    text: '一艘海盗侦察舰远远缀着舰队：对方没有动手，但你的航路已经被记下了',
    weight: 10,
    effect: { kind: 'none' },
  },
  {
    id: 'ev-meteor',
    name: '流星雨',
    text: '密集流星雨掠过护盾，像一场免费的烟火表演',
    weight: 8,
    effect: { kind: 'none' },
  },
  {
    id: 'ev-big-cargo',
    name: '协会遗失货柜',
    text: '一只标注「协会遗失」的巨型货柜飘在航线边——捞回去可领失物赏金',
    weight: 6,
    effect: { kind: 'isk', min: 12_000, max: 25_000 },
  },
  {
    id: 'ev-ore-patch',
    name: '富矿残脉',
    text: '一片被遗忘的富矿残脉嵌在岩体上，采集器顺手收割了高品位矿物',
    weight: 6,
    effect: { kind: 'mineral', itemId: 'min-mexallon', units: 120 },
  },
  {
    id: 'ev-signal',
    name: '古老信号',
    text: '雷达捕捉到一段古老信号，协会档案馆愿意收购原始录音',
    weight: 5,
    effect: { kind: 'isk', min: 8_000, max: 15_000 },
  },
]

/** 构建途中事件数组 */
export function buildTravelEvents(): readonly TravelEventDef[] {
  return TRAVEL_EVENTS
}
