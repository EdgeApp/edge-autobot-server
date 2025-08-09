export interface AutobotEngineArgs {
  log: (...args: unknown[]) => void
}

export type AutobotEngine = (args: AutobotEngineArgs) => Promise<void>

export interface Autobot {
  botId: string
  engines?: Array<{
    frequency: 'minute' | 'hour' | 'day' | 'week' | 'month'
    engine: AutobotEngine
  }>
}
