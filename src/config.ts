import { makeConfig } from 'cleaner-config'
import { asNumber, asObject, asOptional, asString } from 'cleaners'
import { asCouchCredentials } from 'edge-server-tools'

export const asConfig = asObject({
  httpPort: asOptional(asNumber, 8008),
  couchMainCluster: asOptional(asString, 'wusa'),
  couchUris: asOptional(asCouchCredentials, () => ({
    wusa: {
      url: 'https://autobot.edge.app:6984',
      username: 'admin',
      password: 'admin'
    }
  }))
})

export const config = makeConfig(asConfig, 'config.json')
