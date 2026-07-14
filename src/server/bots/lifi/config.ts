/**
 * LiFi bot config cleaner. Validates pluginConfig.lifi from serverConfig.json.
 */
import { asNumber, asObject, asOptional, asString } from 'cleaners'

import { asTenderlySweeperConfig } from '../sweeper/config'

const asLifiConfigInner = asObject({
  evmAddress: asOptional(asString, ''),
  integrator: asOptional(asString, ''),
  lifiApiKey: asOptional(asString, ''),
  infuraProjectId: asOptional(asString, ''),
  drpcApiKey: asOptional(asString, ''),
  tenderly: asOptional(asTenderlySweeperConfig, () =>
    asTenderlySweeperConfig({})
  ),
  dustThresholdUsd: asOptional(asNumber, 1)
})

export const asLifiConfig = asOptional(asLifiConfigInner, () =>
  asLifiConfigInner({})
)

export type LifiConfig = ReturnType<typeof asLifiConfigInner>
