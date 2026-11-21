
import staticDocument from './static/modules.json'
import type { DataDocument } from '../../../tools/data-editor-contract'
import { staticDataGroup } from './staticData'

const MODULES_0_TEXT_BINDINGS: Record<string, Record<string, unknown>> = {
  'mod-gravekeeper-rebirth': { name: L10N['mod.gravekeeperGear.001']!.zh, description: L10N['mod.gravekeeperGear.002']!.zh },
  'mod-gravekeeper-crisis': { name: L10N['mod.gravekeeperGear.003']!.zh, description: L10N['mod.gravekeeperGear.007']!.zh },
  'mod-gravekeeper-rail': { name: L10N['mod.gravekeeperGear.005']!.zh, description: L10N['mod.gravekeeperGear.006']!.zh },
  'mod-alien-acid-launcher': { name: L10N['mod.alienLoot.001']!.zh, description: L10N['mod.alienLoot.002']!.zh },
  'mod-alien-pressure-chamber': { name: L10N['mod.alienLoot.003']!.zh, description: L10N['mod.alienLoot.004']!.zh },
  'mod-drone-launch-1': { name: L10N['mod.launchCalibration.001']!.zh, description: L10N['mod.launchCalibration.006']!.zh },
  'mod-drone-launch-2': { name: L10N['mod.launchCalibration.002']!.zh, description: L10N['mod.launchCalibration.006']!.zh },
  'mod-drone-launch-3': { name: L10N['mod.launchCalibration.003']!.zh, description: L10N['mod.launchCalibration.006']!.zh },
  'mod-laser-calibration-2': { name: L10N['mod.launchCalibration.004']!.zh, description: L10N['mod.launchCalibration.007']!.zh },
  'mod-laser-calibration-3': { name: L10N['mod.launchCalibration.005']!.zh, description: L10N['mod.launchCalibration.007']!.zh },
  "mod-miner-civ": {
    name: '民用采集器',
    description: L10N['mod.signalSpace.001']!.zh,
  },
  "mod-miner-1": {
    name: '强化采集器 MK1',
    description: L10N['mod.signalSpace.001']!.zh,
  },
  "mod-miner-2": {
    name: '强化采集器 MK2',
    description: L10N['mod.signalSpace.001']!.zh,
  },
  "mod-miner-3": {
    name: '精密采集器 MK3',
    description: L10N['mod.signalSpace.001']!.zh,
  },
  "mod-miner-proto": {
    name: '异星原型采集器',
    description: L10N['mod.signalSpace.002']!.zh,
  },
  "mod-cargo-civ": {
    name: '民用货舱扩展',
    description: L10N['mod.copy.003']!.zh,
  },
  "mod-cargo-1": {
    name: '货舱扩展 MK1',
    description: L10N['mod.copy.003']!.zh,
  },
  "mod-cargo-2": {
    name: '货舱扩展 MK2',
    description: L10N['mod.copy.003']!.zh,
  },
  "mod-cargo-3": {
    name: '折叠货舱扩展 MK3',
    description: L10N['mod.copy.003']!.zh,
  },
  "mod-cargo-proto": {
    name: '异星原型货舱',
    description: L10N['mod.copy.004']!.zh,
  },
  "mod-turret-civ": {
    name: '民用舰炮',
    description: L10N['mod.copy.005']!.zh,
  },
  "mod-turret-kin-1": {
    name: '轻型炮台 MK1·动能型',
    description: L10N['mod.copy.006']!.zh,
  },
  "mod-turret-kin-2": {
    name: '重型炮台 MK2·动能型',
    description: L10N['mod.copy.007']!.zh,
  },
  "mod-turret-kin-3": {
    name: '攻坚炮台 MK3·动能型',
    description: L10N['mod.copy.008']!.zh,
  },
  "mod-pd-e": {
    name: '近防炮 MK1',
    description: L10N['mod.copy.009']!.zh,
  },
  "mod-pd-e-2": {
    name: '近防炮 MK2',
    description: L10N['mod.copy.009']!.zh,
  },
  "mod-pd-e-3": {
    name: '近防炮 MK3',
    description: L10N['mod.copy.009']!.zh,
  },
  "mod-laser-1": {
    name: '轻型激光炮 MK1',
    description: L10N['mod.copy.010']!.zh,
  },
  "mod-laser-2": {
    name: '重型激光炮 MK2',
    description: L10N['mod.copy.011']!.zh,
  },
  "mod-laser-3": {
    name: '攻坚激光炮 MK3',
    description: L10N['mod.copy.012']!.zh,
  },
  "mod-laser-proto": {
    name: '异星原型激光炮',
    description: L10N['mod.copy.013']!.zh,
  },
  "mod-missile-1": {
    name: '轻型导弹架 MK1',
    description: L10N['mod.copy.014']!.zh,
  },
  "mod-missile-2": {
    name: '重型导弹架 MK2',
    description: L10N['mod.copy.015']!.zh,
  },
  "mod-missile-3": {
    name: '巡航导弹架 MK3',
    description: L10N['mod.copy.016']!.zh,
  },
  "mod-drone-rack-1": {
    name: '无人机甲板扩展 MK1',
    description: L10N['mod.copy.017']!.zh,
  },
  "mod-drone-rack-2": {
    name: '无人机甲板扩展 MK2',
    description: L10N['mod.copy.017']!.zh,
  },
  "mod-drone-rack-3": {
    name: '无人机甲板扩展 MK3',
    description: L10N['mod.copy.017']!.zh,
  },
  "mod-drone-tac-1": {
    name: '战术导控阵列 MK1',
    description: L10N['mod.copy.018']!.zh,
  },
  "mod-drone-tac-2": {
    name: '战术导控阵列 MK2',
    description: L10N['mod.copy.018']!.zh,
  },
  "mod-drone-tac-3": {
    name: '战术导控阵列 MK3',
    description: L10N['mod.copy.018']!.zh,
  },
  "mod-drone-relay-1": {
    name: '无人机中继天线 MK1',
    description: L10N['mod.copy.019']!.zh,
  },
  "mod-drone-relay-2": {
    name: '无人机中继天线 MK2',
    description: L10N['mod.copy.019']!.zh,
  },
  "mod-drone-relay-3": {
    name: '无人机中继天线 MK3',
    description: L10N['mod.copy.019']!.zh,
  },
  "mod-drone-shield-2": {
    name: '无人机护盾投射仪 MK2',
    description: L10N['mod.copy.020']!.zh,
  },
  "mod-drone-shield-3": {
    name: '无人机护盾投射仪 MK3',
    description: L10N['mod.copy.020']!.zh,
  },
  "mod-drone-deck-1": {
    name: '无人机储备甲板 MK1',
    description: L10N['mod.copy.021']!.zh,
  },
  "mod-drone-deck-2": {
    name: '无人机储备甲板 MK2',
    description: L10N['mod.copy.021']!.zh,
  },
  "mod-drone-deck-3": {
    name: '无人机储备甲板 MK3',
    description: L10N['mod.copy.021']!.zh,
  },
  "mod-shield-kin-1": {
    name: '护盾增强器 MK1·动能型',
    description: L10N['mod.copy.022']!.zh,
  },
  "mod-shield-exp-1": {
    name: '护盾增强器 MK1·高爆型',
    description: L10N['mod.copy.023']!.zh,
  },
  "mod-shield-pla-1": {
    name: '护盾增强器 MK1·能量型',
    description: L10N['mod.copy.024']!.zh,
  },
  "mod-shield-kin-2": {
    name: '护盾增强器 MK2·动能型',
    description: L10N['mod.copy.022']!.zh,
  },
  "mod-shield-exp-2": {
    name: '护盾增强器 MK2·高爆型',
    description: L10N['mod.copy.023']!.zh,
  },
  "mod-shield-pla-2": {
    name: '护盾增强器 MK2·能量型',
    description: L10N['mod.copy.024']!.zh,
  },
  "mod-shield-kin-3": {
    name: '护盾增强器 MK3·动能型',
    description: L10N['mod.copy.022']!.zh,
  },
  "mod-shield-exp-3": {
    name: '护盾增强器 MK3·高爆型',
    description: L10N['mod.copy.023']!.zh,
  },
  "mod-shield-pla-3": {
    name: '护盾增强器 MK3·能量型',
    description: L10N['mod.copy.024']!.zh,
  },
  "mod-shield-ext-1": {
    name: '护盾扩展器 MK1',
    description: L10N['mod.copy.025']!.zh,
  },
  "mod-shield-ext-2": {
    name: '护盾扩展器 MK2',
    description: L10N['mod.copy.025']!.zh,
  },
  "mod-shield-ext-3": {
    name: '护盾扩展器 MK3',
    description: L10N['mod.copy.025']!.zh,
  },
  "mod-shieldchg-1": {
    name: '护盾充能装置 MK1',
    description:
      L10N['mod.copy.026']!.zh,
  },
  "mod-shieldchg-2": {
    name: '护盾充能装置 MK2',
    description:
      L10N['mod.copy.026']!.zh,
  },
  "mod-shieldchg-3": {
    name: '护盾充能装置 MK3',
    description:
      L10N['mod.copy.026']!.zh,
  },
  "mod-shieldfield-2": {
    name: L10N['mod.fleetSupport.001']!.zh,
    description: L10N['mod.fleetSupport.003']!.zh,
  },
  "mod-shieldfield-3": {
    name: L10N['mod.fleetSupport.002']!.zh,
    description: L10N['mod.fleetSupport.003']!.zh,
  },
  "mod-armor-kin-1": {
    name: '装甲镀层 MK1·动能型',
    description: L10N['mod.copy.028']!.zh,
  },
  "mod-armor-exp-1": {
    name: '装甲镀层 MK1·高爆型',
    description: L10N['mod.copy.029']!.zh,
  },
  "mod-armor-pla-1": {
    name: '装甲镀层 MK1·能量型',
    description: L10N['mod.copy.030']!.zh,
  },
  "mod-armor-kin-2": {
    name: '装甲镀层 MK2·动能型',
    description: L10N['mod.copy.028']!.zh,
  },
  "mod-armor-exp-2": {
    name: '装甲镀层 MK2·高爆型',
    description: L10N['mod.copy.029']!.zh,
  },
  "mod-armor-pla-2": {
    name: '装甲镀层 MK2·能量型',
    description: L10N['mod.copy.030']!.zh,
  },
  "mod-armor-kin-3": {
    name: '装甲镀层 MK3·动能型',
    description: L10N['mod.copy.028']!.zh,
  },
  "mod-armor-exp-3": {
    name: '装甲镀层 MK3·高爆型',
    description: L10N['mod.copy.029']!.zh,
  },
  "mod-armor-pla-3": {
    name: '装甲镀层 MK3·能量型',
    description: L10N['mod.copy.030']!.zh,
  },
  "mod-dc-1": {
    name: '损伤管制装置 MK1',
    description: L10N['mod.copy.031']!.zh,
  },
  "mod-dc-2": {
    name: '损伤管制装置 MK2',
    description: L10N['mod.copy.031']!.zh,
  },
  "mod-dc-3": {
    name: '损伤管制装置 MK3',
    description: L10N['mod.copy.031']!.zh,
  },
  "mod-armor-plate-1": {
    name: '装甲增厚板 MK1',
    description: L10N['mod.copy.032']!.zh,
  },
  "mod-armor-plate-2": {
    name: '装甲增厚板 MK2',
    description: L10N['mod.copy.032']!.zh,
  },
  "mod-armor-plate-3": {
    name: '装甲增厚板 MK3',
    description: L10N['mod.copy.032']!.zh,
  },
  "mod-prop-1": {
    name: '矢量推进器 MK1',
    description: L10N['mod.copy.033']!.zh,
  },
  "mod-prop-2": {
    name: '矢量推进器 MK2',
    description: L10N['mod.copy.033']!.zh,
  },
  "mod-prop-3": {
    name: '矢量推进器 MK3',
    description: L10N['mod.copy.033']!.zh,
  },
  "mod-mwd-1": {
    name: '微型跃迁引擎 MK1',
    description: L10N['mod.copy.034']!.zh,
  },
  "mod-mwd-2": {
    name: '微型跃迁引擎 MK2',
    description: L10N['mod.copy.034']!.zh,
  },
  "mod-mwd-3": {
    name: '微型跃迁引擎 MK3',
    description: L10N['mod.copy.034']!.zh,
  },
  "mod-stab-kin-1": {
    name: '动能稳定器 MK1',
    description: L10N['mod.copy.035']!.zh,
  },
  "mod-stab-kin-2": {
    name: '动能稳定器 MK2',
    description: L10N['mod.copy.035']!.zh,
  },
  "mod-stab-kin-3": {
    name: '动能稳定器 MK3',
    description: L10N['mod.copy.035']!.zh,
  },
  "mod-stab-exp-1": {
    name: '高爆稳定器 MK1',
    description: L10N['mod.copy.036']!.zh,
  },
  "mod-stab-exp-2": {
    name: '高爆稳定器 MK2',
    description: L10N['mod.copy.036']!.zh,
  },
  "mod-stab-exp-3": {
    name: '高爆稳定器 MK3',
    description: L10N['mod.copy.036']!.zh,
  },
  "mod-stab-pla-1": {
    name: '等离子稳定器 MK1',
    description: L10N['mod.copy.037']!.zh,
  },
  "mod-stab-pla-2": {
    name: '等离子稳定器 MK2',
    description: L10N['mod.copy.037']!.zh,
  },
  "mod-stab-pla-3": {
    name: '等离子稳定器 MK3',
    description: L10N['mod.copy.037']!.zh,
  },
  "mod-rof-1": {
    name: '射速计算机 MK1',
    description: L10N['mod.copy.038']!.zh,
  },
  "mod-rof-2": {
    name: '射速计算机 MK2',
    description: L10N['mod.copy.038']!.zh,
  },
  "mod-rof-3": {
    name: '射速计算机 MK3',
    description: L10N['mod.copy.038']!.zh,
  },
  "mod-warpcomp-2": {
    name: '跃迁计算机 MK2',
    description: L10N['mod.copy.039']!.zh,
  },
  "mod-warpcomp-3": {
    name: '跃迁计算机 MK3',
    description: L10N['mod.copy.039']!.zh,
  },
  "mod-track-1": {
    name: '索敌阵列 MK1',
    description: L10N['mod.copy.040']!.zh,
  },
  "mod-track-2": {
    name: '索敌阵列 MK2',
    description: L10N['mod.copy.040']!.zh,
  },
  "mod-track-3": {
    name: '索敌阵列 MK3',
    description: L10N['mod.copy.040']!.zh,
  },
  "mod-gyro-1": {
    name: '姿态陀螺 MK1',
    description: L10N['mod.copy.041']!.zh,
  },
  "mod-gyro-2": {
    name: '姿态陀螺 MK2',
    description: L10N['mod.copy.041']!.zh,
  },
  "mod-gyro-3": {
    name: '姿态陀螺 MK3',
    description: L10N['mod.copy.041']!.zh,
  },
  "mod-cpu-1": {
    name: '协处理器 MK1',
    description: L10N['mod.copy.042']!.zh,
  },
  "mod-cpu-2": {
    name: '协处理器 MK2',
    description: L10N['mod.copy.042']!.zh,
  },
  "mod-cpu-3": {
    name: '协处理器 MK3',
    description: L10N['mod.copy.043']!.zh,
  },
  "mod-salvager-1": {
    name: '打捞器 MK1',
    description: L10N['mod.signalSpace.003']!.zh,
  },
  "mod-salvager-2": {
    name: '打捞器 MK2',
    description: L10N['mod.signalSpace.003']!.zh,
  },
  "mod-salvager-3": {
    name: '打捞器 MK3',
    description: L10N['mod.signalSpace.003']!.zh,
  },
  "mod-hullrep-civ": {
    name: '民用船体维修装置',
    description: L10N['mod.copy.045']!.zh,
  },
  "mod-hullrep-1": {
    name: '船体维修装置 MK1',
    description: L10N['mod.copy.046']!.zh,
  },
  "mod-hullrep-2": {
    name: '船体维修装置 MK2',
    description: L10N['mod.copy.046']!.zh,
  },
  "mod-lock-1": {
    name: '目标锁定阵列 MK1',
    description: L10N['mod.fleetSupport.005']!.zh,
  },
  "mod-lock-2": {
    name: '目标锁定阵列 MK2',
    description: L10N['mod.fleetSupport.005']!.zh,
  },
  "mod-lock-3": {
    name: '目标锁定阵列 MK3',
    description: L10N['mod.fleetSupport.005']!.zh,
  },
  "mod-stealth-2": {
    name: '隐秘行动装置 MK2',
    description:
      L10N['mod.copy.048']!.zh,
  },
  "mod-stealth-3": {
    name: '隐秘行动装置 MK3',
    description:
      L10N['mod.copy.048']!.zh,
  },
  "mod-lair-turret-a": {
    name: '劫掠者转管炮',
    description:
      L10N['mod.copy.049']!.zh,
  },
  "mod-lair-missile-a": {
    name: '掠袭导弹巢',
    description:
      L10N['mod.copy.050']!.zh,
  },
  "mod-lair-cargo-a": {
    name: '赃物强化舱',
    description:
      L10N['mod.copy.051']!.zh,
  },
  "mod-lair-armor-c": {
    name: '生体甲壳板',
    description:
      L10N['mod.copy.052']!.zh,
  },
  "mod-lair-dc-c": {
    name: '生体损管腔',
    description: L10N['mod.copy.053']!.zh,
  },
  "mod-lair-laser-c": {
    name: '酸液喷吐器',
    description:
      L10N['mod.copy.054']!.zh,
  },
  "mod-lair-shield-d": {
    name: '陵墓护盾阵列',
    description:
      L10N['mod.copy.055']!.zh,
  },
  "mod-lair-turret-d": {
    name: '守墓者长炮',
    description:
      L10N['mod.copy.056']!.zh,
  },
  "mod-lair-armor-d": {
    name: '陵寝装甲层',
    description:
      L10N['mod.copy.057']!.zh,
  },
  "mod-lair-turret-e": {
    name: '巨构残骸炮',
    description:
      L10N['mod.copy.058']!.zh,
  },
  "mod-lair-hangar-e": {
    name: '深层机库',
    description:
      L10N['mod.copy.059']!.zh,
  },
  "mod-lair-frame-e": {
    name: '巨构骨架',
    description:
      L10N['mod.copy.060']!.zh,
  },
  "mod-lair-drone-tac-g": {
    name: '鱿蜂群导控',
    description:
      L10N['mod.copy.061']!.zh,
  },
  "mod-lair-drone-relay-g": {
    name: '流亡中继桅',
    description:
      L10N['mod.copy.062']!.zh,
  },
  "mod-lair-ecm-h": {
    name: '墨潮电子舱',
    description:
      L10N['mod.copy.063']!.zh,
  },
  "mod-lair-web-h": {
    name: '墨潮捕获网',
    description:
      L10N['mod.copy.064']!.zh,
  },
  "mod-lair-laser-r": {
    name: '叠光激光炮',
    description:
      L10N['mod.copy.065']!.zh,
  },
  "mod-lair-blink-r": {
    name: '短距离跃迁装置',
    description: L10N['mod.copy.066']!.zh,
  },
  "mod-lair-beam-r": {
    name: '三叉戟光束炮',
    description: L10N['mod.copy.067']!.zh,
  },
  "mod-lair-pd-r": {
    name: 'PD激光',
    description: L10N['mod.copy.068']!.zh,
  },
  "mod-wh-a-frag": {
    name: '掠袭破片炮',
    description:
      L10N['mod.copy.069']!.zh,
  },
  "mod-wh-a-hangar": {
    name: '掠袭机库',
    description:
      L10N['mod.copy.070']!.zh,
  },
  "mod-wh-a-prop": {
    name: '掠袭加力器',
    description:
      L10N['mod.copy.071']!.zh,
  },
  "mod-wh-a-coat": {
    name: '掠袭折射涂层',
    description:
      L10N['mod.copy.072']!.zh,
  },
  "mod-wh-a-scan": {
    name: '赃物扫描阵',
    description:
      L10N['mod.copy.073']!.zh,
  },
  "mod-wh-a-shield": {
    name: '掠袭者护盾笼',
    description:
      L10N['mod.copy.074']!.zh,
  },
  "mod-wh-c-laser": {
    name: '生体棱镜束',
    description:
      L10N['mod.copy.075']!.zh,
  },
  "mod-wh-c-prism": {
    name: '甲壳棱镜层',
    description:
      L10N['mod.copy.076']!.zh,
  },
  "mod-wh-c-pulse": {
    name: '生体脉搏加速器',
    description:
      L10N['mod.copy.077']!.zh,
  },
  "mod-wh-c-missile": {
    name: '孢子导弹巢',
    description:
      L10N['mod.copy.078']!.zh,
  },
  "mod-wh-c-frame": {
    name: '几丁质骨架层',
    description:
      L10N['mod.copy.079']!.zh,
  },
  "mod-wh-d-turret": {
    name: '陵卫连装炮',
    description:
      L10N['mod.copy.080']!.zh,
  },
  "mod-wh-d-shield": {
    name: '陵墓护盾芯',
    description:
      L10N['mod.copy.081']!.zh,
  },
  "mod-wh-d-lock": {
    name: '守墓者丧钟',
    description: L10N['mod.fleetSupport.005']!.zh,
  },
  "mod-wh-d-laser": {
    name: '陵寝棱镜炮',
    description:
      L10N['mod.copy.083']!.zh,
  },
  "mod-wh-d-loader": {
    name: '守墓者速装填机',
    description:
      L10N['mod.copy.084']!.zh,
  },
  "mod-wh-d-steady": {
    name: '陵墓弹道铭文',
    description:
      L10N['mod.copy.085']!.zh,
  },
  "mod-wh-e-dc": {
    name: '巨构损管阵列',
    description:
      L10N['mod.copy.086']!.zh,
  },
  "mod-wh-e-tac": {
    name: '巨构导控塔',
    description:
      L10N['mod.copy.087']!.zh,
  },
  "mod-wh-e-cpu": {
    name: '巨构协处理器',
    description:
      L10N['mod.copy.088']!.zh,
  },
  "mod-wh-e-pd": {
    name: '巨构近防阵列',
    description:
      L10N['mod.copy.089']!.zh,
  },
  "mod-wh-e-shield": {
    name: '巨构护盾矩阵',
    description:
      L10N['mod.copy.090']!.zh,
  },
  "mod-wh-g-hangar": {
    name: '亡军蜂巢坞',
    description:
      L10N['mod.copy.091']!.zh,
  },
  "mod-wh-g-fcs": {
    name: '亡军火控',
    description:
      L10N['mod.copy.092']!.zh,
  },
  "mod-wh-g-ballistic": {
    name: '幽灵弹道校正器',
    description:
      L10N['mod.copy.093']!.zh,
  },
  "mod-wh-g-hull": {
    name: '鱿蜂结构层',
    description:
      L10N['mod.copy.094']!.zh,
  },
  "mod-wh-g-turret": {
    name: '亡军残炮',
    description:
      L10N['mod.copy.095']!.zh,
  },
  "mod-wh-g-prop": {
    name: '幽灵推进器',
    description:
      L10N['mod.copy.096']!.zh,
  },
}

import type { ModuleDef } from '@whale/core'
import { SHIP_PLUGS } from './plugs'
import { L10N } from './l10n/table'
// ⟪文案调整 2026-10-04⟫ 船长授权整批说明重写，数值与功能不变。

export const MODULES: readonly ModuleDef[] = [
  ...staticDataGroup<ModuleDef>(staticDocument as unknown as DataDocument, 'MODULES_0', MODULES_0_TEXT_BINDINGS),
  ...SHIP_PLUGS,
]

export function buildModuleCatalog(): ReadonlyMap<string, ModuleDef> {
  return new Map(MODULES.map((m) => [m.id, m]))
}
