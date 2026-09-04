import './style.css'
import { PortfolioDb } from './db'
import { renderTable } from './table'

const TABLE = 'user'

const picker = document.querySelector<HTMLElement>('#picker')!
const results = document.querySelector<HTMLElement>('#results')!
const dropzone = document.querySelector<HTMLElement>('#dropzone')!
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const pickerError = document.querySelector<HTMLElement>('#picker-error')!
const source = document.querySelector<HTMLElement>('#source')!
const tableHost = document.querySelector<HTMLElement>('#table-host')!
const resetButton = document.querySelector<HTMLButtonElement>('#reset')!

let current: PortfolioDb | null = null

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
    const list = tables.length > 0 ? tables.join(', ') : 'none'
    return `No "${TABLE}" table in this database. Tables found: ${list}.`
  }
  return raw
}

async function load(file: File): Promise<void> {
  pickerError.hidden = true
  dropzone.classList.add('busy')

  let db: PortfolioDb | null = null
  let tables: string[] | null = null
  try {
    db = await PortfolioDb.open(file)
    tables = await db.tableNames()
    const result = await db.query(`SELECT * FROM "${TABLE}"`)

    await current?.close()
    current = db

    const n = result.rows.length
    source.textContent =
      `${file.name} · ${TABLE} — ${n} ${n === 1 ? 'row' : 'rows'}`
    tableHost.replaceChildren(renderTable(result))

    picker.hidden = true
    results.hidden = false
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
