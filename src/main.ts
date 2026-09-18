import './style.css'
import { PortfolioDb } from './db'
import { freezeLabelColumns, renderPivot } from './table'
import { accountTypes, loadPortfolio, monthKeys, pivot } from './portfolio'
import type { Portfolio } from './portfolio'
import { createMultiSelect } from './multi-select'
import type { MultiSelect } from './multi-select'
import { createTimeWindowPicker, defaultWindow } from './time-window'
import type { MonthWindow } from './time-window'

const REQUIRED_TABLES = ['user', 'account', 'account_status']

const picker = document.querySelector<HTMLElement>('#picker')!
const results = document.querySelector<HTMLElement>('#results')!
const dropzone = document.querySelector<HTMLElement>('#dropzone')!
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const pickerError = document.querySelector<HTMLElement>('#picker-error')!
const source = document.querySelector<HTMLElement>('#source')!
const tableHost = document.querySelector<HTMLElement>('#table-host')!
const userSelectHost = document.querySelector<HTMLElement>('#user-select-host')!
const typeSelectHost = document.querySelector<HTMLElement>('#type-select-host')!
const timeWindowHost = document.querySelector<HTMLElement>('#time-window-host')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!

let current: PortfolioDb | null = null
let portfolio: Portfolio | null = null
let userSelect: MultiSelect | null = null
let typeSelect: MultiSelect | null = null

// The live filter state. Each control mutates its own slice in place, so there
// is exactly one source of truth for what the table shows.
const selectedUsers = new Set<number>()
const selectedTypes = new Set<string>()
let monthWindow: MonthWindow = { from: 0, to: 0 }

function showError(message: string): void {
  pickerError.textContent = message
  pickerError.hidden = false
}

/** Turns the raw failure into something a human can act on. */
function explain(err: unknown, tables: string[] | null): string {
  const raw = err instanceof Error ? err.message : String(err)

  if (/can only read versions between/i.test(raw)) {
    return `This database was written with a newer DuckDB storage format than the browser engine can read. Re-export it with the default storage version. Original error: ${raw}`
  }
  if (/not a valid DuckDB database file|Corrupt database file|magic bytes/i.test(raw)) {
    return `That does not look like a DuckDB database file. Original error: ${raw}`
  }
  if (tables && /Table with name .* does not exist|does not have a table named/i.test(raw)) {
    const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t))
    const list = tables.length > 0 ? tables.join(', ') : 'none'
    return `Missing table${missing.length === 1 ? '' : 's'} ${missing.join(', ')}. Tables found: ${list}.`
  }
  return raw
}

/** Points the dropdown's button at the visible caption beside it. */
function labelControl(element: HTMLElement, labelId: string): void {
  element.querySelector('.ms-toggle')?.setAttribute('aria-labelledby', labelId)
}

function emptyNote(text: string): HTMLElement {
  const p = document.createElement('p')
  p.className = 'empty'
  p.textContent = text
  return p
}

function renderPortfolio(): void {
  if (!portfolio) return

  if (selectedUsers.size === 0) {
    tableHost.replaceChildren(emptyNote('Select at least one user.'))
    return
  }
  if (selectedTypes.size === 0) {
    tableHost.replaceChildren(emptyNote('Select at least one account type.'))
    return
  }

  const result = pivot(portfolio, {
    users: selectedUsers,
    types: selectedTypes,
    from: monthWindow.from,
    to: monthWindow.to,
  })
  tableHost.replaceChildren(
    renderPivot(result, {
      showType: selectedTypes.size > 1,
      showUser: selectedUsers.size > 1,
    }),
  )
  freezeLabelColumns(tableHost)
}

// Column widths are content-driven, so they only shift when the table is
// re-rendered or the viewport changes.
window.addEventListener('resize', () => freezeLabelColumns(tableHost))

async function load(file: File): Promise<void> {
  pickerError.hidden = true
  dropzone.classList.add('busy')

  let db: PortfolioDb | null = null
  let tables: string[] | null = null
  try {
    db = await PortfolioDb.open(file)
    tables = await db.tableNames()
    const loaded = await loadPortfolio(db)

    await current?.close()
    current = db
    portfolio = loaded

    // Everything selected by default: the first view shows the whole portfolio.
    const types = accountTypes(loaded)
    const months = monthKeys(loaded)
    selectedUsers.clear()
    for (const user of loaded.users) selectedUsers.add(user.id)
    selectedTypes.clear()
    for (const type of types) selectedTypes.add(type)
    monthWindow = defaultWindow(months)

    userSelect?.destroy()
    userSelect = createMultiSelect(
      loaded.users.map((u) => ({ value: u.id, label: u.name })),
      selectedUsers,
      { one: 'user', many: 'users' },
      renderPortfolio,
    )
    labelControl(userSelect.element, 'user-select-label')
    userSelectHost.replaceChildren(userSelect.element)

    typeSelect?.destroy()
    typeSelect = createMultiSelect(
      types.map((t) => ({ value: t, label: t })),
      selectedTypes,
      { one: 'account type', many: 'account types' },
      renderPortfolio,
    )
    labelControl(typeSelect.element, 'type-select-label')
    typeSelectHost.replaceChildren(typeSelect.element)

    timeWindowHost.replaceChildren(
      createTimeWindowPicker(months, monthWindow, renderPortfolio).element,
    )

    const n = loaded.users.length
    source.textContent = `${file.name} — ${n} ${n === 1 ? 'user' : 'users'}, ${loaded.rows.length} monthly balances`

    // Reveal before rendering, not after: freezing the label columns measures
    // their rendered widths, and a display:none table measures zero.
    picker.hidden = true
    results.hidden = false
    renderPortfolio()
  } catch (err) {
    if (db && db !== current) await db.close().catch(() => {})
    showError(explain(err, tables))
  } finally {
    dropzone.classList.remove('busy')
    // Let the same file be picked again after a failure.
    fileInput.value = ''
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) void load(file)
})

for (const event of ['dragenter', 'dragover'] as const) {
  dropzone.addEventListener(event, (e) => {
    e.preventDefault()
    dropzone.classList.add('over')
  })
}
for (const event of ['dragleave', 'dragend'] as const) {
  dropzone.addEventListener(event, () => dropzone.classList.remove('over'))
}
dropzone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropzone.classList.remove('over')
  const file = e.dataTransfer?.files?.[0]
  if (file) void load(file)
})

resetButton.addEventListener('click', () => {
  results.hidden = true
  picker.hidden = false
  pickerError.hidden = true
})
