import { snooze } from '../common/utils'
import { mailBot } from './bots/autoForwarder/mailBot'
import type { AutobotEngine } from './types'

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
  engine: AutobotEngine,
  frequency: 'minute' | 'hour' | 'day' | 'week' | 'month'
): Promise<void> => {
  const delayMs = frequencyToMs[frequency]
  const log = (...args: unknown[]): void => {
    const now = new Date().toISOString()
    const date = now.slice(5)
    console.log(`${date}:${botId}:${frequency}: ${args.join(' ')}`)
  }

  while (true) {
    const startTime = Date.now()
    try {
      await engine({ log })
    } catch (err) {
      console.error(`${botId}: Engine failed to run ${frequency}':`, err)
    }

    const now = Date.now()
    const timeSinceStart = now - startTime
    const timeToWait = Math.max(0, delayMs - timeSinceStart)
    await snooze(timeToWait)
  }
}

const main = (): void => {
  const autobots = [mailBot]
  for (const autobot of autobots) {
    const { botId, engines } = autobot
    if (engines == null) continue

    for (const engine of engines) {
      createEngineLoop(botId, engine.engine, engine.frequency).catch(
        (e: unknown) => {
          console.error(
            `${botId}: Engine failed to initialize ${engine.frequency}':`,
            e
          )
        }
      )
    }
  }
}

main()
