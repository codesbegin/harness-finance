import { Account } from './account.js';
import { Direction, JournalEntryStatus } from './types.js';

export interface PostingProps {
  account: Account;
  direction: Direction;
  amount: number;
  memo?: string;
}

export class Posting {
  readonly account: Account;
  readonly direction: Direction;
  readonly amount: number;
  readonly memo: string;

  constructor({ account, direction, amount, memo = '' }: PostingProps) {
    if (amount <= 0) throw new Error('posting amount must be positive');
    this.account = account;
    this.direction = direction;
    this.amount = amount;
    this.memo = memo;
  }
}

export interface JournalEntryProps {
  id: string;
  description: string;
  date?: Date;
}

export class JournalEntry {
  readonly id: string;
  readonly description: string;
  readonly date: Date;
  postings: Posting[] = [];
  status: JournalEntryStatus = 'DRAFT';

  constructor({ id, description, date = new Date() }: JournalEntryProps) {
    this.id = id;
    this.description = description;
    this.date = date;
  }

  addPosting(posting: Posting): void {
    if (this.status !== 'DRAFT') throw new Error('only DRAFT entries can accept postings');
    this.postings.push(posting);
  }

  get totalDebit(): number {
    return this.postings.filter(p => p.direction === 'debit').reduce((s, p) => s + p.amount, 0);
  }

  get totalCredit(): number {
    return this.postings.filter(p => p.direction === 'credit').reduce((s, p) => s + p.amount, 0);
  }

  get isBalanced(): boolean {
    return Math.round(this.totalDebit * 100) === Math.round(this.totalCredit * 100);
  }

  post(): void {
    if (this.status !== 'DRAFT') throw new Error('only DRAFT entries can be posted');
    if (this.postings.length < 2) throw new Error('journal entry needs at least two postings');
    if (!this.isBalanced) throw new Error(`unbalanced: debit ${this.totalDebit} != credit ${this.totalCredit}`);
    for (const p of this.postings) p.account.applyPosting(p.direction, p.amount);
    this.status = 'POSTED';
  }

  lock(): void {
    if (this.status !== 'POSTED') throw new Error('only POSTED entries can be locked');
    this.status = 'LOCKED';
  }
}
