import cron from 'node-cron'

import { snooze } from '../common/utils'
import { config } from '../config'
import { mailBot } from './bots/autoForwarder/mailBot'
import { edgeTesterBot } from './bots/edgeTester/testerBot'
import type { AutobotEngineConfig } from './types'

type Frequency = 'minute' | 'hour' | 'day' | 'week' | 'month'

const frequencyToMs: Record<Frequency, number> = {
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000
}

const createEngineLoop = async (
  botId: string,
  engineConfig: AutobotEngineConfig
): Promise<void> => {
  const { engine, cron: cronExpr, frequency } = engineConfig
  const log = (...args: unknown[]): void => {
    const now = new Date().toISOString()
    const date = now.slice(5)
    const label = cronExpr ?? frequency ?? 'unknown'
    console.log(`${date}:${botId}:${label}: ${args.join(' ')}`)
  }

  if (cronExpr != null) {
    // Cron-based scheduling takes precedence
    const task = cron.schedule(cronExpr, async () => {
      try {
        await engine({ log })
      } catch (err: unknown) {
        log('Engine failed to run cron:', err)
      }
    })

    await task.start()
  } else if (frequency != null) {
    // Frequency-based scheduling as a fallback
    const delayMs = frequencyToMs[frequency]
    while (true) {
      const startTime = Date.now()
      try {
        await engine({ log })
      } catch (err) {
        log('Engine failed to run')
      }
      const timeSinceStart = Date.now() - startTime
      const timeToWait = Math.max(0, delayMs - timeSinceStart)
      await snooze(timeToWait)
    }
  } else {
    // No schedule provided; run once at startup
    log('Engine failed to run (no schedule)')
  }
}

const main = (): void => {
  const autobots = [edgeTesterBot, mailBot]
  for (const autobot of autobots) {
    const { botId, engines } = autobot
    if (engines == null) continue
    if (config.enablePlugins[botId] == null || !config.enablePlugins[botId])
      continue

    for (const engine of engines) {
      createEngineLoop(botId, engine).catch((e: unknown) => {
        console.error(`${botId}: Engine failed to initialize schedule`, e)
      })
    }
  }
}

main()
