const REFRESH_RATE = 5000

export const snooze = async (ms: number): Promise<void> =>
  await new Promise((resolve: Function) => setTimeout(resolve, ms))

export const retryFetch = async (
  request: RequestInfo,
  init?: RequestInit,
  maxRetries: number = 5
): Promise<Response> => {
  let retries = 0
  let err: any

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
