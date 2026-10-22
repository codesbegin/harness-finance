export type FinanceErrorCode =
  | 'FINANCE_UNKNOWN_ACCOUNT'
  | 'FINANCE_UNBALANCED_ENTRY'
  | 'FINANCE_LOCKED_LEDGER'
  | 'FINANCE_INVALID_POSTING'
  | 'FINANCE_UNKNOWN_ENTRY'
  | 'FINANCE_APPROVAL_REQUIRED'
  | 'FINANCE_ONTOLOGY_INCONSISTENT'

export class FinanceError extends Error {
  readonly code: FinanceErrorCode
  /** 可选：reasoner 返回的矛盾解释（一组三元组的集合），给 agent 看。 */
  readonly explain?: string[][]

  constructor(message: string, code: FinanceErrorCode, explain?: string[][]) {
    super(message)
    this.name = 'FinanceError'
    this.code = code
    this.explain = explain
    Object.setPrototypeOf(this, new.target.prototype)
  }

  toJSON(): { name: string; code: FinanceErrorCode; message: string; explain?: string[][] } {
    return { name: this.name, code: this.code, message: this.message, explain: this.explain }
  }
}
