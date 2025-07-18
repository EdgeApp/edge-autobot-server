const REFRESH_RATE = 5000

// Logging control
const VERBOSE_LOG = (process.env.VERBOSE_LOG_MAIL ?? 'true') === 'true'
const VERBOSE_LOG_MAIL = (process.env.VERBOSE_LOG_MAIL ?? 'true') === 'true'

export const logger = {
  log: (...args: unknown[]): void => {
    if (VERBOSE_LOG) {
      console.log(...args)
    }
  },
  mail: (...args: unknown[]): void => {
    if (VERBOSE_LOG_MAIL && VERBOSE_LOG) {
      console.log(...args)
    }
  },
  error: (...args: unknown[]): void => {
    console.error(...args)
  }
}

export const snooze = async (ms: number): Promise<void> =>
  await new Promise((resolve: () => void) => setTimeout(resolve, ms))

export const retryFetch = async (
  request: RequestInfo,
  init?: RequestInit,
  maxRetries: number = 5
): Promise<Response> => {
  let retries = 0
  let err: unknown

  while (retries++ < maxRetries) {
    try {
      const response = await fetch(request, init)
      return response
    } catch (e) {
      err = e
      await snooze(REFRESH_RATE * retries)
    }
  }
  throw err
}

export const sanitizeEmail = (email: string): string => {
  return email.toLowerCase().trim()
}

export const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

export const matchesSubject = (
  subject: string,
  searchPattern: string
): boolean => {
  const normalizedSubject = subject.toLowerCase()
  const normalizedPattern = searchPattern.toLowerCase()
  return normalizedSubject.includes(normalizedPattern)
}

export const formatEmailBody = (
  originalBody: string,
  originalFrom: string,
  originalSubject: string
): string => {
  return `Forwarded from: ${originalFrom}
Original subject: ${originalSubject}

${originalBody}`
}
