export interface AutobotEngineArgs {
  log: (...args: unknown[]) => void
}

export type AutobotEngine = (args: AutobotEngineArgs) => Promise<void>

export interface AutobotEngineConfig {
  frequency?: 'minute' | 'hour' | 'day' | 'week' | 'month'
  cron?: string // Standard "* * * * *" style string; if provided, takes precedence over frequency
  engine: AutobotEngine
}

export interface Autobot {
  botId: string
  engines?: AutobotEngineConfig[]
}
