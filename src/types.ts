export type AccountCategory = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type Direction = 'debit' | 'credit';
export type NormalBalance = Direction;
export type JournalEntryStatus = 'DRAFT' | 'POSTED' | 'LOCKED';

export const CATEGORY_NORMAL_BALANCE: Readonly<Record<AccountCategory, NormalBalance>> = {
  ASSET: 'debit',
  EXPENSE: 'debit',
  LIABILITY: 'credit',
  EQUITY: 'credit',
  INCOME: 'credit',
};
