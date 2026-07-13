import {
  asMaybe,
  asNumber,
  asObject,
  asOptional,
  asString,
  asValue
} from 'cleaners'

export const asBridgelessSubmission = asObject({
  chainId: asString,
  txHash: asString,
  txNonce: asString
})
export type BridgelessSubmission = ReturnType<typeof asBridgelessSubmission>

export const asBridgelessDoc = asObject({
  _id: asString,
  _rev: asOptional(asString),

  chainId: asString,
  txHash: asString,
  txNonce: asString,
  confirmedHeight: asMaybe(asNumber, 0),

  // Lifecycle: docs are kept after submission as an audit record. Older docs
  // predate the status field, so treat a missing value as pending.
  status: asOptional(asValue('pending', 'submitted'), 'pending'),
  // Human-readable chain name, stamped by the engine from the bridge's
  // /chains/{id} response.
  chainName: asOptional(asString),
  submittedAt: asOptional(asString),
  // Only recorded when the values submitted to the TSS differ from this doc's
  // own txHash/txNonce (TON deposits resolve to the bridge tx hash + lt).
  submitted: asOptional(
    asObject({
      txHash: asString,
      txNonce: asString
    })
  )
})
export type BridgelessDoc = ReturnType<typeof asBridgelessDoc>
