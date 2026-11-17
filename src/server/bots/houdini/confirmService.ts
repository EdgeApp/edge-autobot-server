import { config } from '../../../config'
import type { LogFunction } from '../../types'
import type { HoudiniDoc } from './types'

// Upper bound on one `dex/confirmTx` request, so an attempt always ends
// before the retry spacing lets another caller try the same order.
export const CONFIRM_TIMEOUT_MS = 20 * 1000

// Statuses that mean Houdini did not accept Edge's key and secret. The report
// itself was never judged, so it stays pending until the credentials are fixed.
const AUTH_FAILURE_STATUSES = [401, 402, 403]

export const hasHoudiniCredentials = (): boolean =>
  config.houdiniApiKey !== '' && config.houdiniApiSecret !== ''

/**
 * Whether this server can work a report: the engine only runs the bot when
 * `enablePlugins.houdini` is set, and it needs the partner key and secret.
 */
export const isHoudiniReportingEnabled = (): boolean =>
  config.enablePlugins.houdini && hasHoudiniCredentials()

/**
 * The `dex/confirmTx` endpoint under the configured API base. `new URL`
 * replaces the last path segment of a base without a trailing slash, so the
 * slash is added when the config leaves it off.
 */
export const getConfirmTxUrl = (): URL => {
  const base = config.houdiniApiUrl.endsWith('/')
    ? config.houdiniApiUrl
    : `${config.houdiniApiUrl}/`
  return new URL('dex/confirmTx', base)
}

/**
 * Makes one `dex/confirmTx` attempt for a claimed report and returns the doc
 * with the outcome applied. Houdini starts a dex order only once it has the
 * transaction, so this call is what moves the user's funds along.
 *
 * A 2xx confirms the report. A 404 means Houdini has no open order under the
 * id (see `notFound` in `asHoudiniDoc`). Any other 4xx is Houdini refusing
 * the report, and repeating it cannot change that answer, so the doc is
 * marked rejected. 401, 402 and 403 are a problem with Edge's credentials and
 * a 429 is a rate limit; those stay pending with 5xx answers and network
 * errors for a later attempt. Every failure is logged with the order id and
 * tx hash, the pair a manual report needs.
 */
export const confirmHoudiniDoc = async (
  document: HoudiniDoc,
  log: LogFunction
): Promise<HoudiniDoc> => {
  const { orderId, txHash, attempts } = document

  let failure: string
  let status: HoudiniDoc['status'] = 'pending'
  let authFailure = false
  try {
    const response = await fetch(getConfirmTxUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `${config.houdiniApiKey}:${config.houdiniApiSecret}`
      },
      body: JSON.stringify({ id: orderId, txHash }),
      signal: AbortSignal.timeout(CONFIRM_TIMEOUT_MS)
    })
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
    authFailure = AUTH_FAILURE_STATUSES.includes(response.status)
    if (response.status === 404) {
      status = 'notFound'
    } else if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 429 &&
      !authFailure
    ) {
      status = 'rejected'
    }
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error)
  }

  const context = `order ${orderId}, tx ${txHash} (attempt ${attempts})`
  if (authFailure) {
    log.error(
      `Houdini refused Edge's API key or secret for ${context}, will retry: ${failure}`
    )
  } else if (status === 'notFound') {
    log.warn(
      `Houdini has no open order for ${context}: an unknown id, or an order an earlier attempt already confirmed. Not retrying: ${failure}`
    )
  } else {
    log.warn(
      `Houdini dex/confirmTx failed for ${context}, ${
        status === 'rejected' ? 'refused, not retrying' : 'will retry'
      }: ${failure}`
    )
  }
  return { ...document, status, lastError: failure }
}
