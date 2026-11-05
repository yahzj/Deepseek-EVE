import { startExpedition as launchExpedition } from '../../src/expedition'
import { startMining as launchMining } from '../../src/mining'
import { startSalvageOp as launchSalvage } from '../../src/salvaging'
import { finishDeparture } from './departure-ready'

export function startExpeditionArrived(...args: Parameters<typeof launchExpedition>) {
  const result = launchExpedition(...args)
  if (result.ok) finishDeparture(args[0], args[2])
  return result
}

export function startMiningArrived(...args: Parameters<typeof launchMining>) {
  const result = launchMining(...args)
  if (result.ok) finishDeparture(args[0], args[2])
  return result
}

export function startSalvageArrived(...args: Parameters<typeof launchSalvage>) {
  const result = launchSalvage(...args)
  if (result.ok) finishDeparture(args[0], args[2])
  return result
}

