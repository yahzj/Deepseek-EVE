import { buildSimContext } from '@whale/data'
import { createBountyWinTask } from './bountyWinTask'
import type { BountyWinRequest, BountyWinResponse } from './bountyWinProtocol'

const scope = globalThis as unknown as {
  onmessage: ((event: { data: BountyWinRequest }) => void) | null
  postMessage(response: BountyWinResponse): void
}
const run = createBountyWinTask(buildSimContext, () => performance.now())
scope.onmessage = ({ data }) => {
  const response = run(data)
  if (response) scope.postMessage(response)
}
