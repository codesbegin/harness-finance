import { AccountCategory, Direction, NormalBalance, CATEGORY_NORMAL_BALANCE } from './types.js';

export interface AccountProps {
  id: string;
  name: string;
  category: AccountCategory;
  openingBalance?: number;
}

/**
 * 持久化快照 — SQLite Repository 用这个还原 Account。
 *
 * 注意 signedBalance 是有符号余额：
 *   - 借方正常的账户（asset/expense）：正数表示借余，负数表示贷余
 *   - 贷方正常的账户（liability/equity/income）：负数表示贷余，正数表示借余
 */
export interface AccountSnapshot {
  id: string;
  name: string;
  category: AccountCategory;
  signedBalance: number;
}

export class Account {
  readonly id: string;
  readonly name: string;
  readonly category: AccountCategory;
  readonly normalBalance: NormalBalance;
  private _signedBalance: number;

  constructor({ id, name, category, openingBalance = 0 }: AccountProps) {
    this.id = id;
    this.name = name;
    this.category = category;
    this.normalBalance = CATEGORY_NORMAL_BALANCE[category];
    this._signedBalance = this.normalBalance === 'debit' ? openingBalance : -openingBalance;
  }

  /**
   * 从持久化快照还原 Account。
   * 不走构造函数的 openingBalance 逻辑，直接恢复有符号余额。
   */
  static restore(snapshot: AccountSnapshot): Account {
    const acc = new Account({
      id: snapshot.id,
      name: snapshot.name,
      category: snapshot.category,
      openingBalance: 0,
    });
    ;(acc as { _signedBalance: number })._signedBalance = snapshot.signedBalance;
    return acc;
  }

  /**
   * 导出持久化快照（SQLite 写入用）。
   */
  toSnapshot(): AccountSnapshot {
    return {
      id: this.id,
      name: this.name,
      category: this.category,
      signedBalance: this._signedBalance,
    };
  }

  applyPosting(direction: Direction, amount: number): void {
    if (amount <= 0) throw new Error('posting amount must be positive');
    this._signedBalance += direction === 'debit' ? amount : -amount;
  }

  /** 对外展示的余额（无符号）。方向看 signedBalance / isNormalDirection。 */
  get balance(): number { return Math.abs(this._signedBalance); }
  /** 有符号余额：借余为正、贷余为负（与账户类别无关，纯记账符号）。 */
  get signedBalance(): number { return this._signedBalance; }
  /**
   * 余额是否处于该账户类别的"正常方向"。
   *
   * 借方正常账户（asset/expense）：正余额（借余）是正常方向；
   * 贷方正常账户（liability/equity/income）：负余额（贷余）是正常方向。
   * 注意不能统一用 `signedBalance >= 0` 判断——对所有贷方账户都会误报。
   */
  get isNormalDirection(): boolean {
    return this.normalBalance === 'debit' ? this._signedBalance >= 0 : this._signedBalance <= 0;
  }
}
