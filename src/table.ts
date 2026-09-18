import type { Account, Pivot } from './portfolio'
import { monthLabel } from './portfolio'

const amountFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Marks a cell as part of the frozen label block on the left. */
function markLabel(cell: HTMLTableCellElement, last: boolean): void {
  cell.classList.add('lead')
  if (last) cell.classList.add('lead-last')
}

/**
 * Pins the label columns against horizontal scroll. Each one needs a `left`
 * equal to the total width of the columns before it, and those widths come from
 * the rendered text — so this can only run once the table is in the document,
 * and again whenever its layout changes.
 */
export function freezeLabelColumns(root: ParentNode): void {
  const table = root.querySelector<HTMLTableElement>('table.pivot')
  const headRow = table?.tHead?.rows[0]
  if (!table || !headRow) return

  const offsets: number[] = []
  let offset = 0
  for (const cell of headRow.cells) {
    if (!cell.classList.contains('lead')) break
    offsets.push(offset)
    offset += cell.getBoundingClientRect().width
  }

  // A table that is not laid out yet — still display:none, say — measures zero
  // across the board. Writing those offsets would stack every label column at
  // left: 0, so leave them alone and let the next call do it.
  if (offset === 0) return

  for (const row of table.rows) {
    let index = 0
    for (const cell of row.cells) {
      if (!cell.classList.contains('lead')) break
      cell.style.left = `${offsets[index] ?? 0}px`
      index += 1
    }
  }
}

function message(text: string): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'table-wrap'
  const empty = document.createElement('p')
  empty.className = 'empty'
  empty.textContent = text
  wrapper.append(empty)
  return wrapper
}

/**
 * Accounts down the side, months across the top. The label columns are sticky
 * because the month axis is long enough to scroll on any screen.
 */
export function renderPivot(
  { months, rows }: Pivot,
  { showType, showUser }: { showType: boolean; showUser: boolean },
): HTMLElement {
  if (rows.length === 0) return message('No account data for this selection.')

  // A column that holds the same value in every row is noise, so Type and User
  // only appear once the selection actually spans more than one of them.
  const labels: { header: string; of: (account: Account) => string }[] = [
    { header: 'Account', of: (a) => a.name },
    ...(showType ? [{ header: 'Type', of: (a: Account) => a.type }] : []),
    ...(showUser ? [{ header: 'User', of: (a: Account) => a.userName }] : []),
  ]
  const lastLabel = labels.length - 1

  const headRow = document.createElement('tr')
  for (const [index, { header }] of labels.entries()) {
    const th = document.createElement('th')
    th.textContent = header
    th.scope = 'col'
    markLabel(th, index === lastLabel)
    headRow.append(th)
  }
  for (const monthKey of months) {
    const th = document.createElement('th')
    th.textContent = monthLabel(monthKey)
    th.scope = 'col'
    th.classList.add('num')
    headRow.append(th)
  }
  const thead = document.createElement('thead')
  thead.append(headRow)

  const tbody = document.createElement('tbody')
  for (const { account, amounts } of rows) {
    const tr = document.createElement('tr')

    for (const [index, { of }] of labels.entries()) {
      // The account name heads its row; the rest are ordinary cells.
      const cell = document.createElement(
        index === 0 ? 'th' : 'td',
      ) as HTMLTableCellElement
      cell.textContent = of(account)
      if (index === 0) cell.scope = 'row'
      markLabel(cell, index === lastLabel)
      tr.append(cell)
    }

    for (const amount of amounts) {
      const td = document.createElement('td')
      td.classList.add('num')
      if (amount === null) {
        td.textContent = '—'
        td.classList.add('null')
      } else {
        td.textContent = amountFormat.format(amount)
      }
      tr.append(td)
    }
    tbody.append(tr)
  }

  const table = document.createElement('table')
  table.className = 'pivot'
  table.append(thead, tbody)

  const wrapper = document.createElement('div')
  wrapper.className = 'table-wrap'
  wrapper.append(table)
  return wrapper
}
