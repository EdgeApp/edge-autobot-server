import { asNumber, asObject, asOptional, asString, asValue } from 'cleaners'

// Houdini order ids are 22 alphanumerics. Holding reports to that shape also
// keeps an id off CouchDB's reserved `_` prefix, since the id is the doc id.
const asOrderId = (raw: unknown): string => {
  const orderId = asString(raw)
  if (!/^[A-Za-z0-9]{22}$/.test(orderId)) {
    throw new TypeError('Expected a 22-character alphanumeric order id')
  }
  return orderId
}

// A dex route starts from an EVM chain, so its tx hash is `0x` and 64 hex
// digits.
const asEvmTxHash = (raw: unknown): string => {
  const txHash = asString(raw)
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    throw new TypeError('Expected a 0x-prefixed 32-byte tx hash')
  }
  return txHash
}

export const asHoudiniSubmission = asObject({
  orderId: asOrderId,
  txHash: asEvmTxHash
})
export type HoudiniSubmission = ReturnType<typeof asHoudiniSubmission>

export const asHoudiniDoc = asObject({
  _id: asString,
  _rev: asOptional(asString),

  orderId: asString,
  txHash: asString,

  // Lifecycle: pending reports are retried until Houdini accepts one
  // (confirmed), refuses it with a 4xx (rejected), or answers 404 (notFound).
  // Houdini answers 404 both for an id it never issued and for an order it
  // already confirmed, which is what an earlier attempt whose answer was lost
  // leaves behind, so notFound is kept apart from rejected. Docs are kept
  // after every outcome as an audit record.
  status: asValue('pending', 'confirmed', 'rejected', 'notFound'),
  attempts: asOptional(asNumber, 0),
  createdAt: asString,
  lastAttemptAt: asOptional(asString),
  // The last failed attempt's response, or the network error behind it.
  lastError: asOptional(asString),
  confirmedAt: asOptional(asString)
})
export type HoudiniDoc = ReturnType<typeof asHoudiniDoc>
