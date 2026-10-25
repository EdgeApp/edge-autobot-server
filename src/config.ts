import { makeConfig } from 'cleaner-config'
import { asBoolean, asNumber, asObject, asOptional, asString } from 'cleaners'
import { asCouchCredentials } from 'edge-server-tools'

export const asConfig = asObject({
  httpPort: asOptional(asNumber, 8008),
  couchMainCluster: asOptional(asString, 'wusa'),
  etherscanApiKey: asOptional(asString, ''),
  houdiniApiUrl: asOptional(
    asString,
    'https://api-partner.houdiniswap.com/v2/'
  ),
  houdiniApiKey: asOptional(asString, ''),
  houdiniApiSecret: asOptional(asString, ''),
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
    houdini: true,
    mailForwarder: true,
    syncGitCouch: true
  })
}).withRest

export const config = makeConfig(asConfig, 'serverConfig.json')
