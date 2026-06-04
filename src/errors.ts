export class ShopCliError extends Error {
  readonly status?: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message)
    this.name = 'ShopCliError'
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof ShopCliError) {
    const suffix = error.status ? ` (${error.status})` : ''
    return `${error.message}${suffix}`
  }
  if (error instanceof Error) return error.message
  return String(error)
}
