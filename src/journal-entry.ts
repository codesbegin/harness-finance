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

/**
 * Posting 持久化快照。account 用 ID 引用，不存对象本身。
 */
export interface PostingSnapshot {
  accountId: string;
  direction: Direction;
  amount: number;
  memo: string;
}

/**
 * JournalEntry 持久化快照。
 */
export interface JournalEntrySnapshot {
  id: string;
  description: string;
  status: JournalEntryStatus;
  date: Date;
  postings: PostingSnapshot[];
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

  /**
   * 从持久化快照还原 JournalEntry。
   * 绕过 DRAFT 状态检查，直接恢复已 POSTED 的分录。
   *
   * @param snapshot 分录快照
   * @param accountsById 已加载的账户表，用于把 posting.accountId 还原成 Account 对象
   */
  static restore(snapshot: JournalEntrySnapshot, accountsById: Map<string, Account>): JournalEntry {
    const je = new JournalEntry({
      id: snapshot.id,
      description: snapshot.description,
      date: snapshot.date,
    });

    const postings = snapshot.postings.map(p => {
      const account = accountsById.get(p.accountId);
      if (!account) {
        throw new Error(`account ${p.accountId} not found while restoring entry ${snapshot.id}`);
      }
      return new Posting({ account, direction: p.direction, amount: p.amount, memo: p.memo });
    });

    ;(je as { postings: Posting[] }).postings = postings;
    ;(je as { status: JournalEntryStatus }).status = snapshot.status;
    return je;
  }

  /**
   * 导出持久化快照。
   */
  toSnapshot(): JournalEntrySnapshot {
    return {
      id: this.id,
      description: this.description,
      status: this.status,
      date: this.date,
      postings: this.postings.map(p => ({
        accountId: p.account.id,
        direction: p.direction,
        amount: p.amount,
        memo: p.memo,
      })),
    };
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
