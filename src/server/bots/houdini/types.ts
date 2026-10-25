import { asNumber, asObject, asOptional, asString, asValue } from 'cleaners'

export const asHoudiniSubmission = asObject({
  orderId: asString,
  txHash: asString
})
export type HoudiniSubmission = ReturnType<typeof asHoudiniSubmission>

export const asHoudiniDoc = asObject({
  _id: asString,
  _rev: asOptional(asString),

  orderId: asString,
  txHash: asString,

  // Lifecycle: pending reports are retried until Houdini accepts one
  // (confirmed) or refuses it with a 4xx (rejected). Docs are kept after
  // either outcome as an audit record.
  status: asValue('pending', 'confirmed', 'rejected'),
  attempts: asOptional(asNumber, 0),
  createdAt: asString,
  lastAttemptAt: asOptional(asString),
  // The last failed attempt's response, or the network error behind it.
  lastError: asOptional(asString),
  confirmedAt: asOptional(asString)
})
export type HoudiniDoc = ReturnType<typeof asHoudiniDoc>
