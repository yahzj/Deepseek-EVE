

/**
 * P2 抽取节拍制闸内商品（2026-09-06 船长定：声望 11 前以低权重（0.04）参与每 10 分钟 rare
 * 加权抽取、命中即 ×4 价暗市单可绕过买入；解锁后恢复正常权重与价格、不转常驻）。
 * 范围 = MK3 战斗件 19 件（武器三族/无人机架·导控/盾·甲抗容/支援件；剔除生产件 miner·cargo·salvager
 * 与机动 prop）+ 动能 MK3 蓝图书（自制渠道同闸，防绕过）。
 * 原型（proto）与顶船维持原 standingReq 纯硬拦，不加暗市。
 */
export const BM_MK3_KEYS = new Set([
  'mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3',
  'mod-drone-rack-3', 'mod-drone-tac-3',
  'mod-shield-kin-3', 'mod-shield-exp-3', 'mod-shield-pla-3', 'mod-shield-ext-3',
  'mod-armor-kin-3', 'mod-armor-exp-3', 'mod-armor-pla-3', 'mod-armor-plate-3',
  'mod-stab-kin-3', 'mod-stab-exp-3', 'mod-stab-pla-3', 'mod-rof-3', 'mod-track-3', 'mod-gyro-3',
  'bp-turret-3',
  'bp-laser-3',
  'bp-missile-3',
  'bp-drone-rack-3',
  'bp-drone-tac-3',
  'bp-shield-kin-3',
  'bp-shield-exp-3',
  'bp-shield-pla-3',
  'bp-shield-ext-3',
  'bp-shieldchg-3',
  'bp-armor-kin-3',
  'bp-armor-exp-3',
  'bp-armor-pla-3',
  'bp-armor-plate-3',
  'bp-stab-kin-3',
  'bp-stab-exp-3',
  'bp-stab-pla-3',
  'bp-rof-3',
  'bp-track-3',
  'bp-gyro-3',
  // 2026-09-14 跃迁计算机 MK3（+ 其蓝图）：按"**同槽支援件**"归入闸内（与 stab/rof/track/gyro 同列）。
  // ⚠ 它**不提升战斗力**（只缩短星系际航行时间）——与"机动 prop 剔出闸"那条理由相反；
  //   若船长要按 prop/MWD 口径放它出闸，删这两行即可（其余一行都不用动）。
  'mod-warpcomp-3',
  'bp-warpcomp-3',
  'bp-hullrep-2',
])
