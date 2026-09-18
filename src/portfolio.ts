import type { PortfolioDb } from './db'

export interface User {
  id: number
  name: string
}

export interface Account {
  id: number
  userId: number
  userName: string
  type: string
  name: string
}

/**
 * One (account, month) observation: the join of user, account and
 * account_status, flattened. The whole table is small enough to hold in memory,
 * so the database is read once at load and every later view is a pure filter.
 */
export interface PortfolioRow {
  userId: number
  userName: string
  accountId: number
  accountType: string
  accountName: string
  /** year * 100 + month, so months sort and compare as plain numbers. */
  monthKey: number
  amount: number
}

export interface Portfolio {
  /** Every user in the `user` table, including those with no account. */
  users: User[]
  rows: PortfolioRow[]
}

/** `202501` -> `2025-01`. */
export function monthLabel(monthKey: number): string {
  const year = Math.trunc(monthKey / 100)
  const month = monthKey % 100
  return `${year}-${String(month).padStart(2, '0')}`
}

/**
 * Reads the whole portfolio into memory. `account.user_id` is the authoritative
 * owner — `account_status` carries a redundant copy, and joining on both would
 * silently drop rows whenever the two disagree.
 */
export async function loadPortfolio(db: PortfolioDb): Promise<Portfolio> {
  const users = await db.query(
    `SELECT user_id, user_name FROM "user" ORDER BY user_name`,
  )
  const flat = await db.query(
    `SELECT u.user_id,
            u.user_name,
            a.account_id,
            a.account_type,
            a.account_name,
            s.year * 100 + s.month AS month_key,
            s.amount
     FROM account_status s
     JOIN account a ON a.account_id = s.account_id
     JOIN "user" u ON u.user_id = a.user_id`,
  )

  return {
    users: users.rows.map((r) => ({
      id: Number(r['user_id']),
      name: String(r['user_name']),
    })),
    rows: flat.rows.map((r) => ({
      userId: Number(r['user_id']),
      userName: String(r['user_name']),
      accountId: Number(r['account_id']),
      accountType: String(r['account_type']),
      accountName: String(r['account_name']),
      monthKey: Number(r['month_key']),
      amount: Number(r['amount']),
    })),
  }
}

/** Distinct account types across the whole portfolio, for the type filter. */
export function accountTypes(portfolio: Portfolio): string[] {
  return [...new Set(portfolio.rows.map((r) => r.accountType))].sort()
}

/** Every month the portfolio has data for, ascending. */
export function monthKeys(portfolio: Portfolio): number[] {
  return [...new Set(portfolio.rows.map((r) => r.monthKey))].sort((a, b) => a - b)
}

export interface PivotRow {
  account: Account
  /** One entry per month in `Pivot.months`; null where the account has no row. */
  amounts: (number | null)[]
}

export interface Pivot {
  /** Ascending `monthKey`s, restricted to months the selection actually has. */
  months: number[]
  rows: PivotRow[]
}

/** One point of the aggregated series: every selected account, summed. */
export interface SeriesPoint {
  monthKey: number
  total: number
}

/**
 * The selection's total, month by month. A month an account has no row for
 * contributes nothing rather than carrying its last known balance forward, so a
 * missing record reads as a dip — the same gap the table shows as `—`.
 */
export function totalsByMonth({ months, rows }: Pivot): SeriesPoint[] {
  return months.map((monthKey, column) => ({
    monthKey,
    total: rows.reduce((sum, row) => sum + (row.amounts[column] ?? 0), 0),
  }))
}

/** One account type's contribution, aligned column-for-column with `Pivot.months`. */
export interface TypeSeries {
  type: string
  totals: number[]
}

/**
 * The same totals split by account type, for the stacked view. Types are
 * ordered by name so a band keeps its colour as the selection changes, and
 * every type present in the selection gets a series — the bands therefore add
 * up to `totalsByMonth` exactly.
 */
export function totalsByType({ months, rows }: Pivot): TypeSeries[] {
  const byType = new Map<string, number[]>()
  for (const row of rows) {
    let totals = byType.get(row.account.type)
    if (!totals) {
      totals = months.map(() => 0)
      byType.set(row.account.type, totals)
    }
    for (const [column, amount] of row.amounts.entries()) {
      totals[column] = (totals[column] ?? 0) + (amount ?? 0)
    }
  }

  return [...byType.entries()]
    .map(([type, totals]) => ({ type, totals }))
    .sort((a, b) => a.type.localeCompare(b.type))
}

export interface PivotFilter {
  users: ReadonlySet<number>
  types: ReadonlySet<string>
  /** Inclusive `monthKey` bounds. */
  from: number
  to: number
}

/**
 * Accounts as rows, months as ordered columns, for the selection only. Amounts
 * for a repeated (account, month) pair are summed rather than one silently
 * winning.
 *
 * `monthKey` is `year * 100 + month`, which is monotonic, so the window is a
 * plain numeric comparison.
 */
export function pivot(portfolio: Portfolio, filter: PivotFilter): Pivot {
  const selected = portfolio.rows.filter(
    (r) =>
      filter.users.has(r.userId) &&
      filter.types.has(r.accountType) &&
      r.monthKey >= filter.from &&
      r.monthKey <= filter.to,
  )

  const months = [...new Set(selected.map((r) => r.monthKey))].sort((a, b) => a - b)
  const columnOf = new Map(months.map((m, i) => [m, i]))

  const byAccount = new Map<number, PivotRow>()
  for (const row of selected) {
    let pivotRow = byAccount.get(row.accountId)
    if (!pivotRow) {
      pivotRow = {
        account: {
          id: row.accountId,
          userId: row.userId,
          userName: row.userName,
          type: row.accountType,
          name: row.accountName,
        },
        amounts: months.map(() => null),
      }
      byAccount.set(row.accountId, pivotRow)
    }
    const column = columnOf.get(row.monthKey)!
    pivotRow.amounts[column] = (pivotRow.amounts[column] ?? 0) + row.amount
  }

  const rows = [...byAccount.values()].sort(
    (a, b) =>
      a.account.userName.localeCompare(b.account.userName) ||
      a.account.type.localeCompare(b.account.type) ||
      a.account.name.localeCompare(b.account.name),
  )

  return { months, rows }
}
