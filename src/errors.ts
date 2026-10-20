export type FinanceErrorCode =
  | 'FINANCE_UNKNOWN_ACCOUNT'
  | 'FINANCE_UNBALANCED_ENTRY'
  | 'FINANCE_LOCKED_LEDGER'
  | 'FINANCE_INVALID_POSTING'
  | 'FINANCE_UNKNOWN_ENTRY'
  | 'FINANCE_APPROVAL_REQUIRED'

export class FinanceError extends Error {
  readonly code: FinanceErrorCode

  constructor(message: string, code: FinanceErrorCode) {
    super(message)
    this.name = 'FinanceError'
    this.code = code
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON(): { name: string; code: FinanceErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message }
  }
}
