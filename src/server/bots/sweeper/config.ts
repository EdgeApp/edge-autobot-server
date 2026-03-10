/**
 * Sweeper config cleaner. Validates pluginConfig.sweeper from serverConfig.json.
 */
import { asNumber, asObject, asOptional, asString } from 'cleaners'

export const asRangoSweeperConfig = asObject({
  appId: asOptional(asString, ''),
  rangoApiKey: asOptional(asString, ''),
  referrerAddress: asOptional(asString, ''),
  referrerFee: asOptional(asString, '0')
})

export const asLifiSweeperConfig = asObject({
  integrator: asOptional(asString, ''),
  affiliateFeeBasis: asOptional(asString, '0'),
  appId: asOptional(asString, '')
})

export const asTenderlySweeperConfig = asObject({
  accountSlug: asOptional(asString, ''),
  projectSlug: asOptional(asString, ''),
  accessKey: asOptional(asString, '')
})

const asSweeperConfigInner = asObject({
  etherscanApiKey: asOptional(asString, ''),
  infuraProjectId: asOptional(asString, ''),
  drpcApiKey: asOptional(asString, ''),
  rango: asOptional(asRangoSweeperConfig, () => asRangoSweeperConfig({})),
  lifi: asOptional(asLifiSweeperConfig, () => asLifiSweeperConfig({})),
  tenderly: asOptional(asTenderlySweeperConfig, () =>
    asTenderlySweeperConfig({})
  ),
  edgeRatesUrl: asOptional(asString, 'https://rates1.edge.app'),
  slippage: asOptional(asNumber, 3),
  dustThresholdUsd: asOptional(asNumber, 50.0)
})

export const asSweeperConfig = asOptional(asSweeperConfigInner, () =>
  asSweeperConfigInner({})
)

export type SweeperConfig = ReturnType<typeof asSweeperConfigInner>
