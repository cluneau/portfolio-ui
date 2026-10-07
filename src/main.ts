import './style.css'
import { PortfolioDb } from './db'
import { freezeLabelColumns, renderPivot } from './table'
import { renderChart } from './chart'
import { renderDeltaChart } from './delta-chart'
import { pickFromDrive, prefetchDrive } from './drive'
import {
  accountTypes,
  changesByMonth,
  loadPortfolio,
  monthKeys,
  pivot,
  totalsByMonth,
  totalsByType,
} from './portfolio'
import type { DeltaPoint, Portfolio, SeriesPoint, TypeSeries } from './portfolio'
import { createMultiSelect } from './multi-select'
import type { MultiSelect } from './multi-select'
import { createTimeWindowPicker, defaultWindow } from './time-window'
import type { MonthWindow } from './time-window'

const REQUIRED_TABLES = ['user', 'account', 'account_balance']

const picker = document.querySelector<HTMLElement>('#picker')!
const results = document.querySelector<HTMLElement>('#results')!
const dropzone = document.querySelector<HTMLElement>('#dropzone')!
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const pickerError = document.querySelector<HTMLElement>('#picker-error')!
const pickerStatus = document.querySelector<HTMLElement>('#picker-status')!
const driveButton = document.querySelector<HTMLButtonElement>('#drive-button')!
const source = document.querySelector<HTMLElement>('#source')!
const chartHost = document.querySelector<HTMLElement>('#chart-host')!
const deltaHost = document.querySelector<HTMLElement>('#delta-host')!
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

// Kept between renders so a resize can redraw the charts at the new width
// without recomputing the pivot or resetting the table's scroll position.
let series: SeriesPoint[] = []
let bands: TypeSeries[] = []
let changes: DeltaPoint[] = []
/** Width each chart was last drawn at, so a resize can tell whether it matters. */
let chartWidth = 0
let deltaWidth = 0
/** Whether the area chart splits the total into one area per account type. */
let stacked = false

function showError(message: string): void {
  pickerError.textContent = message
  pickerError.hidden = false
}

/** Progress and waiting notices, which are not failures. Null clears the line. */
function showStatus(message: string | null): void {
  pickerStatus.textContent = message ?? ''
  pickerStatus.hidden = message === null
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

/** Draws the stored series at the host's current width. */
function drawChart(): void {
  if (series.length === 0) {
    chartHost.replaceChildren()
    chartWidth = 0
    return
  }
  chartWidth = chartHost.clientWidth
  renderChart(chartHost, series, bands, {
    stacked,
    onStackedChange: (next) => {
      stacked = next
      drawChart()
    },
  })
}

/** The same for the month-over-month bars below it. */
function drawDelta(): void {
  if (series.length === 0) {
    deltaHost.replaceChildren()
    deltaWidth = 0
    return
  }
  deltaWidth = deltaHost.clientWidth
  renderDeltaChart(deltaHost, changes)
}

// The charts are laid out in pixels, so each has to be redrawn whenever its box
// changes width — a window resize, but also the page's own scrollbar appearing
// once they are in place. Comparing widths first keeps that from looping.
new ResizeObserver(() => {
  if (chartHost.clientWidth !== chartWidth) drawChart()
}).observe(chartHost)
new ResizeObserver(() => {
  if (deltaHost.clientWidth !== deltaWidth) drawDelta()
}).observe(deltaHost)

function renderPortfolio(): void {
  if (!portfolio) return

  if (selectedUsers.size === 0) {
    series = []
    bands = []
    changes = []
    drawChart()
    drawDelta()
    tableHost.replaceChildren(emptyNote('Select at least one user.'))
    return
  }
  if (selectedTypes.size === 0) {
    series = []
    bands = []
    changes = []
    drawChart()
    drawDelta()
    tableHost.replaceChildren(emptyNote('Select at least one account type.'))
    return
  }

  const result = pivot(portfolio, {
    users: selectedUsers,
    types: selectedTypes,
    from: monthWindow.from,
    to: monthWindow.to,
  })
  series = totalsByMonth(result)
  bands = totalsByType(result)
  changes = changesByMonth(series)
  drawChart()
  drawDelta()

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

/**
 * Opens a database and shows it. The file is a `File` whether it came from the
 * local picker or from Drive, so `origin` is only there to say so on screen.
 */
async function load(file: File, origin?: string): Promise<void> {
  pickerError.hidden = true
  dropzone.classList.add('busy')
  driveButton.disabled = true

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
    const from = origin ? ` from ${origin}` : ''
    source.textContent = `${file.name}${from} — ${n} ${n === 1 ? 'user' : 'users'}, ${loaded.rows.length} monthly balances`

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
    driveButton.disabled = false
    showStatus(null)
    // Let the same file be picked again after a failure.
    fileInput.value = ''
  }
}

const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
const percentFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})

/**
 * The Drive path, which differs from the local one only in how it gets hold of
 * the file: sign in, pick, download, then hand the bytes to the same loader.
 */
async function loadFromDrive(): Promise<void> {
  pickerError.hidden = true
  driveButton.disabled = true
  // Signing in and picking both happen in Google's own windows, so the page
  // says what it is waiting for rather than looking idle.
  showStatus('Waiting for Google…')
  try {
    const file = await pickFromDrive(({ loaded, total }) => {
      const done = `${sizeFormat.format(loaded / 1e6)} MB`
      showStatus(
        total > 0
          ? `Downloading… ${percentFormat.format(loaded / total)} of ${sizeFormat.format(total / 1e6)} MB`
          : `Downloading… ${done}`,
      )
    })
    // Null means the user closed the sign-in window or the Picker, which needs
    // no explaining.
    if (!file) return
    showStatus(`Reading ${file.name}…`)
    await load(file, 'Google Drive')
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err))
  } finally {
    driveButton.disabled = false
    showStatus(null)
  }
}

// Google's scripts are fetched on the way to the button, not on the click: the
// sign-in pop-up has to open inside the gesture that asked for it.
driveButton.addEventListener('pointerenter', prefetchDrive)
driveButton.addEventListener('focus', prefetchDrive)
driveButton.addEventListener('click', () => void loadFromDrive())

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
  showStatus(null)
})
