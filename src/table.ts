import type { Column, QueryResult, Row } from './db'

/** Epoch millis -> "YYYY-MM-DD HH:MM:SS" (UTC), or just the date part. */
function formatEpochMillis(millis: number, withTime: boolean): string {
  const iso = new Date(millis).toISOString()
  return withTime ? iso.slice(0, 19).replace('T', ' ') : iso.slice(0, 10)
}

function formatCell(value: unknown, kind: Column['kind']): string {
  if (value === null || value === undefined) return '—'

  if (kind === 'date' || kind === 'timestamp') {
    if (typeof value === 'number') return formatEpochMillis(value, kind === 'timestamp')
    if (value instanceof Date) return formatEpochMillis(value.getTime(), kind === 'timestamp')
  }

  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function cell(row: Row, column: Column): HTMLTableCellElement {
  const td = document.createElement('td')
  const value = row[column.name]
  td.textContent = formatCell(value, column.kind)
  if (value === null || value === undefined) td.classList.add('null')
  else if (column.kind === 'number') td.classList.add('num')
  return td
}

/**
 * Renders a result generically from its schema — no hardcoded columns, so it
 * keeps working as the table evolves and is reusable for other tables.
 */
export function renderTable({ columns, rows }: QueryResult): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'table-wrap'

  if (rows.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'This table has no rows.'
    wrapper.append(empty)
    return wrapper
  }

  const headRow = document.createElement('tr')
  for (const column of columns) {
    const th = document.createElement('th')
    th.textContent = column.name
    if (column.kind === 'number') th.classList.add('num')
    headRow.append(th)
  }
  const thead = document.createElement('thead')
  thead.append(headRow)

  const tbody = document.createElement('tbody')
  for (const row of rows) {
    const tr = document.createElement('tr')
    for (const column of columns) tr.append(cell(row, column))
    tbody.append(tr)
  }

  const table = document.createElement('table')
  table.append(thead, tbody)
  wrapper.append(table)
  return wrapper
}
