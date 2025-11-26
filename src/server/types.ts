export type LogFunction = ((...args: unknown[]) => void) & {
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
}
export interface AutobotEngineArgs {
  log: LogFunction
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
