import { AccountCategory, Direction, NormalBalance, CATEGORY_NORMAL_BALANCE } from './types.js';

export interface AccountProps {
  id: string;
  name: string;
  category: AccountCategory;
  openingBalance?: number;
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

  applyPosting(direction: Direction, amount: number): void {
    if (amount <= 0) throw new Error('posting amount must be positive');
    this._signedBalance += direction === 'debit' ? amount : -amount;
  }

  get balance(): number { return Math.abs(this._signedBalance); }
  get isNormalDirection(): boolean { return this._signedBalance >= 0; }
}
