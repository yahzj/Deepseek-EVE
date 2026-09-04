/**
 * 采集点表（V16 空间分层 + 复合产出池）：
 * - 难度按星图空间（X 纵深 + 环心/死路/辐射结构）排布，声望门槛随层递增；
 * - 复合带用 outputs（权重池，每循环掷一次；长期平均 = 权重），单产带省略 outputs；
 * - 删除的三种矿石（克洛基石/熔辉石/赤曜石）由同层保留矿的混合带取代（老档折算见 v16 迁移）。
 */

import type { BeltDef } from '@whale/core'

export const BELTS: readonly BeltDef[] = [
  // ── L1 浅层（母港门口，无门槛 ~ R2） ──
  {
    id: 'belt-fortune',
    galaxyId: 'galaxy-hub',
    name: '丰饶之环',
    oreId: 'ore-veldspar',
    description: '空间站外环的新手矿带：安全、量足、永远挖不完。',
  },
  {
    id: 'belt-scorched',
    galaxyId: 'galaxy-kor',
    name: '灼烧裂隙',
    oreId: 'ore-scorched',
    description: '火山星体碎裂留下的裂隙，灼烧岩富集。',
  },
  {
    id: 'belt-kernite',
    galaxyId: 'galaxy-dust',
    name: '深空晶体带',
    oreId: 'ore-veldspar',
    outputs: [
      { itemId: 'ore-veldspar', weight: 55 },
      { itemId: 'ore-scorched', weight: 30 },
      { itemId: 'ore-hemorphite', weight: 15 },
    ],
    description: '多种矿石共生的新手混合矿带：偶尔能刨出一点希莫非特。',
  },
  {
    id: 'belt-sunshard',
    galaxyId: 'galaxy-shard',
    name: '曦晶带',
    oreId: 'ore-sunshard',
    standingReq: 2,
    description: '晨光角度恰好照亮的棱晶层，采曦棱晶的理想地点（需声望 2）。',
  },
  {
    id: 'belt-gas-neon',
    galaxyId: 'galaxy-lantern',
    name: '氖云气田',
    oreId: 'gas-neon',
    standingReq: 2,
    description: '低重力气田群，首处可采集气体的地点（需声望 2）。',
  },

  // ── L2 环心（新港-灰霾-灯塔闭环中心提级） ──
  {
    id: 'belt-glowstone',
    galaxyId: 'galaxy-haze',
    name: '辉云矿带',
    oreId: 'ore-glowstone',
    standingReq: 3,
    outputs: [
      { itemId: 'ore-glowstone', weight: 80 },
      { itemId: 'ore-sunshard', weight: 20 },
    ],
    description: '闭环中心的富矿脉：辉云岩高纯区，偶见曦棱晶伴生（需声望 3）。',
  },

  // ── L3 中段（红环枢纽 / 蜃影 / 碎晶） ──
  {
    id: 'belt-hemorphite',
    galaxyId: 'galaxy-redring',
    name: '红环危机带',
    oreId: 'ore-hemorphite',
    standingReq: 3,
    outputs: [
      { itemId: 'ore-hemorphite', weight: 60 },
      { itemId: 'ore-scorched', weight: 40 },
    ],
    description: '海盗枢纽深处的高压矿层：希莫非特与灼烧岩交错（需声望 3）。',
  },
  {
    id: 'belt-crimsonite',
    galaxyId: 'galaxy-mirage',
    name: '蜃影晶簇',
    oreId: 'ore-sunshard',
    standingReq: 5,
    outputs: [
      { itemId: 'ore-sunshard', weight: 55 },
      { itemId: 'ore-glowstone', weight: 45 },
    ],
    description: '引力透镜扭曲出的晶簇带：曦棱晶与辉云岩共生（需声望 5）。',
  },
  {
    id: 'belt-ice-marrow',
    galaxyId: 'galaxy-echo',
    name: '寒髓冰环',
    oreId: 'ice-marrow',
    standingReq: 5,
    description: '髓质纹理的古冰环，星髓晶的重要来源（需声望 5）。',
  },

  // ── L4 深层（星髓迷宫 / 裂谷 / 天底侧） ──
  {
    id: 'belt-fluxite',
    galaxyId: 'galaxy-starcore',
    name: '星髓晶脉',
    oreId: 'ore-sunshard',
    standingReq: 4,
    outputs: [
      { itemId: 'ore-sunshard', weight: 55 },
      { itemId: 'ore-glowstone', weight: 45 },
    ],
    description: '迷宫核心区的双重晶脉：曦棱晶与辉云岩共生（需声望 4）。',
  },
  {
    id: 'belt-voidshard',
    galaxyId: 'galaxy-chasm',
    name: '玄晶深带',
    oreId: 'ore-voidshard',
    standingReq: 7,
    description: '深空裂隙带的黑色玄晶层（需声望 7）。',
  },

  // ── L5 渊层（烬火 / 深渊 / 星噬 / 虚海） ──
  {
    id: 'belt-ice-frost',
    galaxyId: 'galaxy-cinder',
    name: '蓝霜冰环',
    oreId: 'ice-frost',
    standingReq: 6,
    description: '蓝白色冰环，冰层封存高纯度同位聚晶（需声望 6）。',
  },
  {
    id: 'belt-gas-ionstorm',
    galaxyId: 'galaxy-abyss',
    name: '离子风暴云场',
    oreId: 'gas-ionstorm',
    standingReq: 8,
    description: '狂暴离子流场：技术验证区，收益与风险并存（需声望 8）。',
  },
  {
    id: 'belt-nebulite',
    galaxyId: 'galaxy-maw',
    name: '星幽矿脉',
    oreId: 'ore-nebulite',
    standingReq: 11,
    description: '星云深处的传说矿脉：协会功勋飞行员专用（需声望 11）。',
  },
  {
    id: 'belt-ice-darkstar',
    galaxyId: 'galaxy-voidedge',
    name: '暗星冰环',
    oreId: 'ice-darkstar',
    standingReq: 11,
    description: '吸收光线的黑色冰环，全宇宙最挑剔的采集点（需声望 11）。',
  },

  // ── L6 极渊（暗星坟场 / 穹顶墓园） ──
  {
    id: 'belt-gas-phosphor',
    galaxyId: 'galaxy-grave',
    name: '磷光霾场',
    oreId: 'gas-phosphor',
    standingReq: 9,
    description: '坟场深处的腐蚀性磷光霾云：提炼价值极高的稀有气藏（需声望 9）。',
  },
  {
    id: 'belt-gas-aurora',
    galaxyId: 'galaxy-vault',
    name: '极光云场',
    oreId: 'gas-aurora',
    standingReq: 13,
    description: '穹顶墓园上空的极光粒子云：全宇宙门槛最高的采集点（需声望 13）。',
  },
]

/** 构建"采集点 id → 定义"目录 */
export function buildBeltCatalog(): ReadonlyMap<string, BeltDef> {
  return new Map(BELTS.map((belt) => [belt.id, belt]))
}
