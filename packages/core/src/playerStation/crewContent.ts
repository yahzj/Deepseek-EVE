export type CrewAttribute = 'fireControl' | 'piloting' | 'engineering' | 'command'
export type CrewCourse = 'fire-control' | 'damage-control' | 'drones'
export type CrewSkillCategory = 'gunnery' | 'maneuver' | 'damage-control' | 'drones' | 'electronic' | 'logistics' | 'formation'
export type CrewTraitCategory = 'judgement' | 'discipline' | 'handling' | 'maintenance' | 'dispatch' | 'leadership' | 'adversity' | 'learning'
export interface CrewText { id: string; nameId: string; descId: string }
export interface CrewSkill extends CrewText {
  category: CrewSkillCategory
  cost: number
  requires: Partial<Record<CrewAttribute, number>>
  damagePct: number
  defensePct: number
}
export interface CrewTrait extends CrewText {
  category: CrewTraitCategory
  effectMods: Partial<Record<CrewSkillCategory, number>>
  learningDiscount: number
}
export interface CrewReward { kind: 'skill' | 'trait'; id: string }
export interface CrewEvent extends CrewText { tags: readonly string[]; result: CrewReward }
export interface CrewChoiceEvent extends CrewText { tags: readonly string[]; options: readonly [CrewReward, CrewReward] }

// 开发接线用中文草稿，不是全局正式文案表；运行状态和内容定义只引用 id。
const devZh: Record<string, string> = {}
function text(id: string, name: string, description: string): CrewText {
  const nameId = `crew.${id}.name`, descId = `crew.${id}.description`
  devZh[nameId] = name; devZh[descId] = description
  return { id, nameId, descId }
}
function skill(id: string, name: string, description: string, category: CrewSkillCategory, cost: number,
  requires: CrewSkill['requires'], damagePct: number, defensePct: number): CrewSkill {
  return Object.freeze({ ...text(id, name, description), category, cost, requires: Object.freeze({ ...requires }), damagePct, defensePct })
}
function trait(id: string, name: string, description: string, category: CrewTraitCategory,
  effectMods: CrewTrait['effectMods'], learningDiscount = 0): CrewTrait {
  return Object.freeze({ ...text(id, name, description), category, effectMods: Object.freeze({ ...effectMods }), learningDiscount })
}

// 本期是有界的常驻团队增量，不冒充尚未接入战斗事件的概率、维修或无人机机制。
export const CREW_SKILLS: readonly CrewSkill[] = Object.freeze([
  skill('target-reading', '目标判读', '辨认目标变化，改进本舰火力分配。', 'gunnery', 1, { fireControl: 2 }, 0.012, 0),
  skill('firing-solution', '射击解算', '统合火控与航向读数，改进本舰火力运用。', 'gunnery', 2, { fireControl: 6, engineering: 2 }, 0.025, 0),
  skill('evasive-routing', '避险航线', '预留规避路径，增强本舰防护收益。', 'maneuver', 1, { piloting: 2 }, 0, 0.012),
  skill('intercept-posture', '截击姿态', '协调接敌航向，兼顾本舰火力与防护。', 'maneuver', 2, { piloting: 5, fireControl: 3 }, 0.012, 0.008),
  skill('bulkhead-watch', '舱段值守', '保持舱段巡查，增强本舰防护收益。', 'damage-control', 1, { engineering: 2 }, 0, 0.015),
  skill('damage-routing', '损管分流', '协调损管班次，增强本舰持续防护。', 'damage-control', 2, { engineering: 6, command: 2 }, 0, 0.026),
  skill('drone-observation', '机群观测', '统合机群观测记录，改善本舰火力判断。', 'drones', 1, { command: 2 }, 0.011, 0),
  skill('drone-coordination', '机群协作', '协调机群与舰上班组，兼顾本舰火力和防护。', 'drones', 2, { command: 6, fireControl: 2 }, 0.018, 0.006),
  skill('signal-reading', '信号判读', '交叉核对战场信号，改善本舰接敌判断。', 'electronic', 1, { fireControl: 1, engineering: 1 }, 0.006, 0.006),
  skill('spectrum-watch', '频谱值守', '持续核对频谱变化，增强本舰防护收益。', 'electronic', 2, { engineering: 4, piloting: 4 }, 0.007, 0.016),
  skill('supply-check', '补给核对', '统一补给检查，增强本舰防护收益。', 'logistics', 1, { engineering: 1, command: 1 }, 0, 0.013),
  skill('watch-relay', '值班接力', '衔接各班职责，兼顾本舰火力与防护。', 'logistics', 2, { engineering: 5, command: 3 }, 0.006, 0.019),
  skill('formation-reading', '队形判读', '从队形变化中判断接敌位置，改善本舰火力。', 'formation', 1, { command: 1, piloting: 1 }, 0.013, 0),
  skill('shared-timing', '协同时序', '统一接敌时序，兼顾本舰火力和防护。', 'formation', 2, { command: 5, piloting: 3 }, 0.014, 0.012),
])
export const CREW_TRAITS: readonly CrewTrait[] = Object.freeze([
  trait('decisive', '果断判断', '强化火力运用与队形判读带来的团队收益。', 'judgement', { gunnery: 0.2, formation: 0.1 }),
  trait('cross-check', '交叉核对', '强化信号判读与损管带来的团队收益。', 'judgement', { electronic: 0.2, 'damage-control': 0.1 }),
  trait('steady-watch', '稳定值班', '强化后勤与损管带来的团队收益。', 'discipline', { logistics: 0.2, 'damage-control': 0.1 }),
  trait('precise-orders', '精确执行', '强化火力运用与机群协作带来的团队收益。', 'discipline', { gunnery: 0.1, drones: 0.2 }),
  trait('adaptive-roles', '机动分工', '强化机动与电子类技能带来的团队收益。', 'handling', { maneuver: 0.2, electronic: 0.2 }),
  trait('measured-approach', '审慎接敌', '强化机动与损管收益，减弱火力运用的额外收益。', 'handling', { maneuver: 0.3, 'damage-control': 0.15, gunnery: -0.15 }),
  trait('equipment-care', '细致整备', '强化后勤与电子类技能带来的团队收益。', 'maintenance', { logistics: 0.2, electronic: 0.15 }),
  trait('maintenance-focus', '整备优先', '强化损管与后勤收益，减弱火力运用的额外收益。', 'maintenance', { 'damage-control': 0.3, logistics: 0.2, gunnery: -0.2 }),
  trait('distributed-control', '分布调度', '强化机群与电子类技能带来的团队收益。', 'dispatch', { drones: 0.25, electronic: 0.1 }),
  trait('recovery-order', '回收有序', '强化机群与后勤技能带来的团队收益。', 'dispatch', { drones: 0.15, logistics: 0.25 }),
  trait('support-culture', '支援习惯', '强化编队与后勤收益，减弱火力运用的额外收益。', 'leadership', { formation: 0.3, logistics: 0.2, gunnery: -0.2 }),
  trait('clear-handover', '交接清楚', '强化编队与机动技能带来的团队收益。', 'leadership', { formation: 0.2, maneuver: 0.15 }),
  trait('crisis-composure', '临危不乱', '强化损管与机动技能带来的团队收益。', 'adversity', { 'damage-control': 0.2, maneuver: 0.2 }),
  trait('shared-hardship', '共度险境', '强化编队与损管技能带来的团队收益。', 'adversity', { formation: 0.15, 'damage-control': 0.25 }),
  trait('applied-learning', '学以致用', '降低学习技能所需的点数，至少仍需一点。', 'learning', {}, 1),
  trait('systems-thinking', '系统思考', '强化电子、后勤与编队技能带来的团队收益。', 'learning', { electronic: 0.15, logistics: 0.15, formation: 0.15 }),
])
const opportunity = (id: string): CrewReward => ({ kind: 'skill', id })
const permanent = (id: string): CrewReward => ({ kind: 'trait', id })
function event(id: string, name: string, description: string, tags: string[], result: CrewReward): CrewEvent {
  return Object.freeze({ ...text(id, name, description), tags: Object.freeze([...tags]), result: Object.freeze({ ...result }) })
}
export const CREW_EVENTS: readonly CrewEvent[] = Object.freeze([
  event('target-crossing', '交错航迹', '目标穿过多条航迹，火控班整理了识别记录。', ['fire-control', 'mission'], opportunity('target-reading')),
  event('solution-drift', '解算漂移', '连续读数出现偏移，班组找到了交叉验证的方法。', ['fire-control'], opportunity('firing-solution')),
  event('exit-lane', '退出航道', '接敌航线留出了新的规避余地。', ['mission', 'guard'], opportunity('evasive-routing')),
  event('intercept-angle', '接敌夹角', '模拟中的航向变化揭示了更稳妥的截击姿态。', ['fire-control', 'mission'], opportunity('intercept-posture')),
  event('sealed-section', '封闭舱段', '损管班重新划分了舱段巡查责任。', ['damage-control', 'guard'], opportunity('bulkhead-watch')),
  event('repair-handover', '损管交接', '相邻班次整理出一套清楚的损管分流方案。', ['damage-control'], opportunity('damage-routing')),
  event('drone-traces', '机群航迹', '机群观测记录补上了舰上视野的空白。', ['drones'], opportunity('drone-observation')),
  event('shared-airspace', '共享空域', '多组机群共用空域，调度班记录了衔接次序。', ['drones', 'mission'], opportunity('drone-coordination')),
  event('signal-echo', '回波差异', '两份信号记录的差异促成了新的判读办法。', ['fire-control', 'guard'], opportunity('signal-reading')),
  event('spectrum-shift', '频谱变化', '值班人员从频谱变化中辨认出接敌征兆。', ['damage-control', 'guard'], opportunity('spectrum-watch')),
  event('supply-manifest', '补给清单', '班组核对补给记录，理清了容易遗漏的交接项。', [], opportunity('supply-check')),
  event('relay-gap', '换班空隙', '一次换班暴露了职责空隙，团队补齐了接力次序。', ['damage-control', 'guard'], opportunity('watch-relay')),
  event('formation-gap', '队形空隙', '团队从队形间距中辨认出新的接敌位置。', ['mission', 'drones'], opportunity('formation-reading')),
  event('timing-window', '协同时机', '各班记录对上了同一个接敌时刻。', ['mission', 'drones'], opportunity('shared-timing')),
  event('decision-record', '判断记录', '团队对照接敌记录，统一了临场判断的次序。', ['fire-control', 'mission'], permanent('decisive')),
  event('independent-readings', '独立读数', '两组独立读数纠正了同一处误判。', [], permanent('cross-check')),
  event('night-watch', '连续值班', '班次轮换保持了记录和职责的连续。', ['guard', 'damage-control'], permanent('steady-watch')),
  event('order-confirmation', '指令确认', '机群与火控班逐项确认了协作指令。', ['drones', 'fire-control'], permanent('precise-orders')),
  event('unexpected-vector', '意外航向', '目标突然变向，团队及时调整了配合。', ['mission', 'guard'], permanent('adaptive-roles')),
  event('maintenance-ledger', '整备记录', '整备班把零散检查整理成了可靠的日常习惯。', ['damage-control'], permanent('equipment-care')),
  event('distributed-watch', '分区值守', '机群班分区核对空域，衔接了各自的观测。', ['drones'], permanent('distributed-control')),
  event('handover-log', '交接记录', '简洁明确的交接记录让各班及时接上职责。', [], permanent('clear-handover')),
  event('pressure-drill', '高压演练', '密集警报中，各班仍维持了清楚的损管次序。', ['damage-control', 'guard'], permanent('crisis-composure')),
  event('lesson-applied', '实践所得', '团队把复盘所得用进了下一轮协作。', [], permanent('applied-learning')),
])
function choice(id: string, name: string, description: string, tags: string[], a: CrewReward, b: CrewReward): CrewChoiceEvent {
  return Object.freeze({ ...text(id, name, description), tags: Object.freeze([...tags]),
    options: Object.freeze([Object.freeze({ ...a }), Object.freeze({ ...b })] as const) })
}
export const CREW_CHOICE_EVENTS: readonly CrewChoiceEvent[] = Object.freeze([
  choice('crossing-orders', '交错指令', '火控班希望抢先判断，值班组主张再核对一次。', ['fire-control', 'mission'], permanent('decisive'), permanent('cross-check')),
  choice('approach-review', '接敌复盘', '团队讨论先练截击姿态，还是先把退出航线留清楚。', ['mission', 'fire-control'], opportunity('intercept-posture'), opportunity('evasive-routing')),
  choice('watch-standard', '值班准则', '连续值班后，各班提出了稳定轮换和精确执行两条改进方向。', [], permanent('steady-watch'), permanent('precise-orders')),
  choice('changing-course', '变向之后', '临时变向化解了险情，团队讨论机动分工与审慎接敌。', ['mission', 'guard'], permanent('adaptive-roles'), permanent('measured-approach')),
  choice('maintenance-review', '整备争议', '整备班希望细化检查，损管班希望增加交叉复核。', ['damage-control'], permanent('equipment-care'), permanent('maintenance-focus')),
  choice('drone-dispatch', '机群调度', '机群班提出分区调度和统一回收两种协作侧重。', ['drones'], permanent('distributed-control'), permanent('recovery-order')),
  choice('handover-priority', '交接重点', '各班讨论形成支援习惯，还是先把职责交接讲清楚。', [], permanent('support-culture'), permanent('clear-handover')),
  choice('after-alarm', '警报之后', '险情结束，团队讨论维持冷静次序与共同承担职责。', ['guard', 'damage-control'], permanent('crisis-composure'), permanent('shared-hardship')),
  choice('learning-method', '学习方法', '团队希望尽快实践，也有人提议先梳理各系统的联系。', [], permanent('applied-learning'), permanent('systems-thinking')),
  choice('fire-review', '火控复盘', '目标识别和连续解算都暴露了问题，团队等待确定学习方向。', ['fire-control'], opportunity('target-reading'), opportunity('firing-solution')),
  choice('damage-review', '损管复盘', '巡查和班次分流各有收获，团队等待确定学习方向。', ['damage-control'], opportunity('bulkhead-watch'), opportunity('damage-routing')),
  choice('drone-review', '机群复盘', '观测记录和协作时序各有收获，机群班等待确定学习方向。', ['drones'], opportunity('drone-observation'), opportunity('drone-coordination')),
])
export const CREW_DEV_ZH: Readonly<Record<string, string>> = Object.freeze(devZh)
export const CREW_COURSES: Readonly<Record<CrewCourse, { primary: CrewAttribute; secondary: CrewAttribute }>> = Object.freeze({
  'fire-control': Object.freeze({ primary: 'fireControl', secondary: 'engineering' }),
  'damage-control': Object.freeze({ primary: 'engineering', secondary: 'command' }),
  drones: Object.freeze({ primary: 'command', secondary: 'fireControl' }),
})
