import { config } from '../../../config'
import type { LogFunction } from '../../types'
import type { HoudiniDoc } from './types'

// Upper bound on one `dex/confirmTx` request, so an attempt always ends
// before the attempt spacing lets another caller try the same order.
export const CONFIRM_TIMEOUT_MS = 20 * 1000

export const hasHoudiniCredentials = (): boolean =>
  config.houdiniApiKey !== '' && config.houdiniApiSecret !== ''

/**
 * Makes one `dex/confirmTx` attempt for a claimed report and returns the doc
 * with the outcome applied. Houdini starts a dex order only once it has the
 * transaction, so this call is what moves the user's funds along.
 *
 * A 2xx confirms the report. A 4xx is Houdini refusing it (unknown order,
 * malformed hash), and repeating the same report cannot change that answer,
 * so the doc is marked rejected. A 429 is a rate limit, not a refusal, and
 * stays pending with 5xx answers and network errors for the next attempt.
 * Every failure is logged with the order id and tx hash, the pair a manual
 * report needs.
 */
export const confirmHoudiniDoc = async (
  document: HoudiniDoc,
  log: LogFunction
): Promise<HoudiniDoc> => {
  const { orderId, txHash, attempts } = document

  let failure: string
  let refused = false
  try {
    const response = await fetch(
      new URL('dex/confirmTx', config.houdiniApiUrl),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `${config.houdiniApiKey}:${config.houdiniApiSecret}`
        },
        body: JSON.stringify({ id: orderId, txHash }),
        signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS)
      }
    )
    if (response.ok) {
      log(
        `Houdini confirmed order ${orderId}, tx ${txHash} (attempt ${attempts})`
      )
      return {
        ...document,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
        lastError: undefined
      }
    }
    const text = await response.text()
    failure = `${response.status} ${text.slice(0, 500)}`
    refused =
      response.status >= 400 && response.status < 500 && response.status !== 429
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error)
  }

  log.warn(
    `Houdini dex/confirmTx failed for order ${orderId}, tx ${txHash} (attempt ${attempts}, ${
      refused ? 'refused, not retrying' : 'will retry'
    }): ${failure}`
  )
  return {
    ...document,
    status: refused ? 'rejected' : 'pending',
    lastError: failure
  }
}
