import { asMaybe, asNumber, asObject, asOptional, asString } from 'cleaners'

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
  confirmedHeight: asMaybe(asNumber, 0)
})
export type BridgelessDoc = ReturnType<typeof asBridgelessDoc>
