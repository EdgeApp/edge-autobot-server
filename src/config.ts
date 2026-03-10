import { makeConfig } from 'cleaner-config'
import { asBoolean, asNumber, asObject, asOptional, asString } from 'cleaners'
import { asCouchCredentials } from 'edge-server-tools'

import { asLifiConfig } from './server/bots/lifi/config'
import { asSweeperConfig } from './server/bots/sweeper/config'

const asPluginConfig = asObject({
  sweeper: asSweeperConfig,
  lifi: asLifiConfig
})

export const asConfig = asObject({
  httpPort: asOptional(asNumber, 8008),
  couchMainCluster: asOptional(asString, 'wusa'),
  couchUris: asOptional(asCouchCredentials, () => ({
    wusa: {
      url: 'https://autobot.edge.app:6984',
      username: 'admin',
      password: 'admin'
    }
  })),
  enablePlugins: asOptional(asObject(asBoolean), {
    bridgeless: true,
    edgeTester: true,
    mailForwarder: true,
    syncGitCouch: true,
    sweeper: false,
    lifi: false
  }),
  pluginConfig: asOptional(asPluginConfig, () => asPluginConfig({}))
}).withRest

export const config = makeConfig(asConfig, 'serverConfig.json')
