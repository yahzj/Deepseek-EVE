import { describe, expect, it } from 'vitest'
import {
  DRONE_LAUNCH_GAP_MS,
  DRONE_LAUNCH_PREVIEW_MODES,
  droneLaunchGapMs,
  isPreviewSentryDrone,
  previewDroneLaunchGate,
  previewDroneLaunchObserve,
} from '../../../tools/drone-launch-preview-curves'

describe('无人机首次出击错峰隔离候选', () => {
  it('只提供现行、500ms队列和8%缩短队列三种预演模式', () => {
    expect(DRONE_LAUNCH_PREVIEW_MODES).toEqual(['current', 'queue', 'queue-cut'])
  })
  it('队列间隔为500ms，甲板候选只缩短等待而不改变攻击间隔', () => {
    expect(droneLaunchGapMs('current')).toBe(500)
    expect(droneLaunchGapMs('queue')).toBe(DRONE_LAUNCH_GAP_MS)
    expect(droneLaunchGapMs('queue-cut')).toBe(460)
  })
  it('两种哨戒机都不进入错峰队列', () => {
    expect(isPreviewSentryDrone('drone-sentry')).toBe(true)
    expect(isPreviewSentryDrone('drone-wh-e-sentry')).toBe(true)
    expect(isPreviewSentryDrone('drone-heavy')).toBe(false)
  })
  it('普通无人机按本舰队列错峰，哨戒机立即放行', () => {
    const battle = {
      lastTickGameMs: 0,
      dronePools: {
        'player:0': { alive: true, artId: 'drone-heavy' },
        'player:1': { alive: true, artId: 'drone-heavy' },
        'player:2': { alive: true, artId: 'drone-sentry' },
      },
    }
    expect(previewDroneLaunchGate('queue', battle, 'player', 0, battle.dronePools['player:0'])).toBe(true)
    expect(previewDroneLaunchGate('queue', battle, 'player', 1, battle.dronePools['player:1'])).toBe(false)
    expect(previewDroneLaunchGate('queue', battle, 'player', 2, battle.dronePools['player:2'])).toBe(true)
    battle.lastTickGameMs = 500
    expect(previewDroneLaunchGate('queue', battle, 'player', 1, battle.dronePools['player:1'])).toBe(true)
  })
  it('复活的普通无人机排到本舰队尾，哨戒机不受该门控影响', () => {
    const battle = {
      lastTickGameMs: 0,
      dronePools: {
        'player:0': { alive: true, artId: 'drone-heavy' },
        'player:1': { alive: true, artId: 'drone-heavy' },
      },
    }
    expect(previewDroneLaunchGate('queue', battle, 'player', 0, battle.dronePools['player:0'])).toBe(true)
    expect(previewDroneLaunchGate('queue', battle, 'player', 1, battle.dronePools['player:1'])).toBe(false)
    battle.dronePools['player:0'].alive = false
    previewDroneLaunchObserve('queue', battle, 'player', 0, battle.dronePools['player:0'])
    battle.lastTickGameMs = 500
    battle.dronePools['player:0'].alive = true
    previewDroneLaunchObserve('queue', battle, 'player', 0, battle.dronePools['player:0'])
    expect(previewDroneLaunchGate('queue', battle, 'player', 0, battle.dronePools['player:0'])).toBe(false)
    battle.lastTickGameMs = 1000
    expect(previewDroneLaunchGate('queue', battle, 'player', 0, battle.dronePools['player:0'])).toBe(true)
  })
})
