/**
 * 游戏内更新公告（2026-09-05 船长定：每次"大的系统添加或更新"完成并入主树后，
 * 经办人必须在**本文件最上方新增一条**玩家可见公告——判定与写法见
 * docs/development-conventions.md 第十二章「游戏内更新公告」）。
 *
 * 字段：id（日期+短名，稳定）· title（一句话标题）· date（YYYY-MM-DD）·
 * tag（系统 / 内容 / 数值 / 修复）· bullets（3~5 条玩家向说明：改了什么、如何体验）。
 * 已读状态存 localStorage（whale-idle:announce-seen），不清档不重弹。
 */
export interface AnnouncementDef {
  id: string
  title: string
  date: string
  tag: string
  bullets: readonly string[]
}

/** 全量公告（新的放最上方） */
export const ANNOUNCEMENTS: readonly AnnouncementDef[] = [
  {
    id: '2026-09-05-prologue',
    title: '序章·苏醒：新档开场演出与完整新手引导上线',
    date: '2026-09-05',
    tag: '系统',
    bullets: [
      '新档开场：黑屏苏醒 → 系统自检 → 回忆系统名称（默认 PRTS）→「睁眼」转场进入游戏；',
      '新手教程链：切换矿船采足即返港 → 任务中心交付首批矿物 → 港内维修隼枭 → 演习场教学战（临时命中/回避加成）→ AI 专家记忆归档 → 指派 AI 副船；可随时跳过，跳过 = 全额结算奖励并修好隼枭；',
      '任务中心改「重要任务 / 资源任务 / 快递任务」分类；长期目标「寻找人类」已发布（进行中·完成方法未知）；',
      '新档节奏调整：零初始资金、初始驾驶 = 隼枭（带伤，可港内维修）、首门炮台与动能弹 120 由教学战斗发放；技能训练按难度定档，最高档练到 Lv5 约 24 小时；',
      '战斗演出优化：三系弹道观感分家、击杀爆炸与命中对齐、开战不再有画面弹出前的隐藏交火；开战距离缓冲随武器射程放大。',
    ],
  },
]

/** 公告目录（按需给目录查询使用） */
export function buildAnnouncementCatalog(): ReadonlyMap<string, AnnouncementDef> {
  return new Map(ANNOUNCEMENTS.map((a) => [a.id, a]))
}
