
import staticDocument from './static/ships.json'
import type { DataDocument } from '../../../tools/data-editor-contract'
import { staticDataGroup } from './staticData'

const SHIPS_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  "sandcat": {
    name: '磷虾级采矿艇',
    description: '新手标配矿船：基础货舱 + 单管采集器。你的第一艘船，也是你唯一的船（暂时）。',
  },
  "burrower": {
    name: '沙鳗级采矿艇',
    description: '更大的货舱与双管采集器，采矿效率接近翻倍，新手村毕业的标志。',
  },
  "whale": {
    name: '鲸吞级采矿艇',
    description: '深空工业巨兽：四管采集器一次啃掉半块小行星。鲸吞之名，名副其实。',
  },
  "pioneer": {
    name: '独角鲸级采矿艇',
    description: '协会造船厂的定制艇：不对外出售，用原材料在自家船台上敲出来。比鲸吞级再快一档。',
  },
  "whale-king": {
    name: '鲸王级采矿艇',
    description: '深空工业的顶点：双倍于鲸吞级的产能。重钨合金吞金兽，全游戏最长远的攒料目标；舱位紧、采集快，适合路途短的矿带。',
  },
  "sh-humpback": {
    name: '座头鲸级矿舰',
    description: '鲸盟第三代量产矿舰：拥有货舰级的货舱，产量再上一档；适合遥远星系的矿带。',
  },
  "sh-bowhead": {
    name: '蝠鲼级重载货舰',
    description: '鲸盟总装的重载货舰：超两万六立方货舱，离线囤货与长途运输的中坚。',
  },
  "sh-manatee": {
    name: L10N['ship.manatee.001']!.zh,
    description: L10N['ship.manatee.002']!.zh,
  },
  "sh-colossal": {
    name: '皇带鱼级旗舰货舰',
    description: '鲸盟总装的旗舰货舰：十万八千立方货舱，深空物流的移动要塞。',
  },
  "sh-falconet": {
    name: '鲣鱼级护卫舰',
    description: '协会训练武装艇：不擅长挖矿，但动力惊人——当前就能当低风险远征的轻快座驾。',
  },
  "sh-shrike": {
    name: '马鲛级护卫舰',
    description: '掠食者武装部门的制式护卫舰：高机动低产量，护送 AI 副船行动的好手。',
  },
  "sh-tigershark": {
    name: '虎鲨级武装护卫舰',
    description: '更厚重的武装护卫舰：火力骨架更强，深空护航的常客。',
  },
  "sh-mako": {
    name: '灰鲭鲨级驱逐舰',
    description: '大型驱逐舰：协会武装力量的中坚船型，静待战斗系统为其装上獠牙。',
  },
  "sh-whiteshark": {
    name: '大白鲨级炮舰',
    description: '顶级武装炮舰：声誉与实力的双重象征。',
  },
  "sh-swarm": {
    name: '梭鱼级无人机护卫',
    description: '掠食者武装部门的无人机护卫：大型机巢加身，放飞机群替火力不够的炮位撑腰。',
  },
  "sh-sentinel": {
    name: '王鲭级无人机母舰',
    description: '掠食者武装部门定制的无人机母舰：翻倍的机巢与充裕的装配位，无人机战力的巅峰载体。',
  },
  "sh-thresher": {
    name: '长尾鲨级导弹巡洋舰',
    description: '掠食者武装部门的新锐导弹巡洋舰：以长尾为名的远距猎手，齐射导弹先声夺人——舰体为导弹阵列特调，爆破弹药威力额外加成。',
  },
  "sh-electricray": {
    name: '电鳐级激光巡洋舰',
    description: '掠食者武装部门的光束巡洋舰：高压电弧般的激光炮阵列，接敌即烧穿护盾——舰体光束聚焦阵列特调，能量武器威力额外加成。',
  },
  "sh-hammerhead": {
    name: '锤头鲨级炮击巡洋舰',
    description: '掠食者武装部门的炮击主力：重炮动能阵列齐射的中坚，深空讨伐的舰队长矛——舰体动能炮组特调，动能武器威力额外加成。',
  },
  "sh-bullshark": {
    name: '牛鲨级突击巡洋舰',
    description: '掠食者武装部门最凶悍的咬合者：厚盾重炮的突击巡洋舰，专为贴脸近战而生——舰体动能炮组特调，动能武器威力额外加成。',
  },
  "sh-nautilus": {
    name: '鹦鹉螺级测绘巡洋舰',
    description: '协会测绘巡洋舰：编入探索队伍即可扩大空间内扫描范围。',
  },
  "sh-tortoise": {
    name: '陆龟级重装艇',
    description: '慢而稳的重甲运输艇：货舱大、皮糙肉厚。',
  },
  "sh-hawksbill": {
    name: '玳瑁级重装巡舰',
    description: '重装巡舰：厚壳加身的移动仓库，离线长时间作业的可靠伙伴。',
  },
  "sh-xuanwu": {
    name: '玄武级重装战列舰',
    description: '重装线的顶点：传闻用整颗小行星的岩壳锻造。',
  },
  "sh-megalodon": {
    name: '巨齿鲨级战列舰',
    description: '以史前巨齿为名的战列舰：正面承伤与火力平台。三层血厚实、装配位宽裕，敢站在编队最前面——代价是转身慢、起步慢。',
  },
  "sh-orca": {
    name: '虎鲸级指挥舰',
    description: '指挥舰：把编队拧成一股的那艘。速度是它的立身之本，代价是装配位、血量与货舱都比战列舰薄一档。',
  },
  "sh-helicoprion": {
    name: '旋齿鲨级装甲战列舰',
    description: '以史前旋齿为名的装甲战列舰：装甲层厚到能顶住第一轮齐射，速度也还跟得上编队——代价是货舱小、中槽少。',
  },
  "sh-dunkleosteus": {
    name: '邓氏鱼级旗舰',
    description: '舰队的顶点：承伤、火力与装配位都在同代船之上，造价与工期同样如此。整支编队的节奏由它定——它慢，别人就得等。',
  },
  "sh-flyingfish": {
    name: '飞鱼级快运舰',
    description: '快运舰：牺牲了货仓和战斗能力换来的高速跃迁性能，小型囤货流的入门选择。',
  },
  "sh-sailfish": {
    name: '旗鱼级高速货舰',
    description: '高速货舰：八千五百立方货舱仍能保持高速跃迁。',
  },
  "sh-swordfish": {
    name: '剑鱼级大型货舰',
    description: '蜃楼航运的旗舰货舰：一万四立方的运力，跑商人的终极梦想。',
  },
  "sh-wh-a-frigate": {
    name: '掠袭电子舰',
    description: '海盗的电子战艇：长项在火控与回避——先锁上、先打中，也更难被咬住；编入探索队伍即可扩大空间内扫描范围。',
  },
  "sh-wh-a-destroyer": {
    name: '掠袭炮舰',
    description: '海盗的炮舰：动能炮阵加持，动能武器射程再拉长三成——先在射程外开火；舱位很窄、护盾让位给装甲。',
  },
  "sh-wh-a-cruiser": {
    name: '掠袭重型突击巡洋舰',
    description: '海盗的重型突击巡洋舰：三层抗性齐备、血量再厚一成，专啃硬目标；没有额外火力加成，代价是转身慢、舱位小。',
  },
  "sh-wh-c-frigate": {
    name: '幼虫截击舰',
    description: '巢群的活体截击舰：快得不像话，专咬落单的；护盾几乎不设防，靠一层甲壳与一副骨架撑住。',
  },
  "sh-wh-c-destroyer": {
    name: '甲壳截击舰',
    description: '巢群的活体截击舰：速度与机动拉满，切入切出；护盾极薄，伤害全由甲与结构承担。',
  },
  "sh-wh-c-cruiser": {
    name: '巢群重型突击巡洋舰',
    description: '巢群的重型突击巡洋舰：三层抗性齐备、甲壳再厚一成，正面硬碰硬；没有额外火力加成，转身极慢。',
  },
  "sh-wh-d-frigate": {
    name: '哨戒电子舰',
    description: '陵墓的电子哨戒舰：盾厚甲薄、火控与回避一并拉高，替全队先敌开火；编入探索队伍即可扩大空间内扫描范围。',
  },
  "sh-wh-d-destroyer": {
    name: '陵卫指挥舰',
    description: '陵墓的指挥舰：护盾占比高、并给全编队的单发伤害加两成——多艘指挥舰只取最高、不叠加。代价是甲/壳薄：盾一破就很脆。',
  },
  "sh-wh-d-cruiser": {
    name: '陵寝巡洋舰',
    description: '陵墓的重装巡洋舰：盾厚甲薄、炮位最多、舱容最大——靠盾与抗性站在阵线中央。',
  },
  "sh-wh-e-frigate": {
    name: '构件鱼雷舰',
    description: '巨构的鱼雷舰：爆破弹头拆甲，命中扎实；信号大、转身笨，得靠队友挡在前面。',
  },
  "sh-wh-e-destroyer": {
    name: '机库无人机作战舰',
    description: '巨构的无人机作战舰：机巢大、机群强，是长时间放飞机群的移动机库；舱位与自射火力都让位给机群。',
  },
  "sh-wh-e-carrier": {
    name: '巨构无人机作战舰',
    description: '巨构的无人机作战舰：本舰机巢最大、无人机伤害最高，放飞即是主武器；舱位让给机库，本舰火力偏辅助。',
  },
  "sh-wh-g-frigate": {
    name: '幽影侦察舰',
    description: '亡军的侦察舰：回避极高、火控不弱——编入探索队伍即可扩大空间内扫描范围，它负责先看见别人。',
  },
  "sh-wh-g-destroyer": {
    name: '亡军后勤舰',
    description: '亡军的后勤舰：货舱与机巢最大，跟着编队补给、换机；火力只求自保。',
  },
  "sh-wh-g-cruiser": {
    name: '亡军鱼雷舰',
    description: '亡军的鱼雷舰：爆破弹头配扎实命中，专挑大目标的装甲；信号大、转身慢，是明牌重锤。',
  },
}

import type { ShipDef } from '@whale/core'
import { L10N } from './l10n/table'

export const SHIPS: ShipDef[] = [
  ...staticDataGroup<ShipDef>(staticDocument as unknown as DataDocument, 'SHIPS_0', SHIPS_0_TEXT_BINDINGS),
]

export function buildShipCatalog(): ReadonlyMap<string, ShipDef> {
  return new Map(SHIPS.map((ship) => [ship.id, ship]))
}

export const PLUG_SLOTS_BY_TIER: Readonly<Record<number, number>> = { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1 }

for (const ship of SHIPS as ShipDef[]) {
  const slots = PLUG_SLOTS_BY_TIER[ship.tier]
  if (slots !== undefined) ship.plugSlots = slots
}
