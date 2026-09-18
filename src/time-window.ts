import { monthLabel } from './portfolio'

/** An inclusive span of `monthKey`s. */
export interface MonthWindow {
  from: number
  to: number
}

export interface TimeWindowPicker {
  element: HTMLElement
}

/**
 * Counted in months that exist in the data, not calendar months — a preset
 * then always yields exactly that many columns, even across a gap.
 */
const PRESETS: { label: string; months: number | null }[] = [
  { label: '6M', months: 6 },
  { label: '12M', months: 12 },
  { label: '24M', months: 24 },
  { label: 'All', months: null },
]

/** The span a preset selects, given every month the data has. */
function presetWindow(months: readonly number[], count: number | null): MonthWindow {
  const first = months[0]!
  const last = months[months.length - 1]!
  if (count === null) return { from: first, to: last }
  return { from: months[Math.max(0, months.length - count)] ?? first, to: last }
}

/** How much history the table opens on. Matches the 12M preset, so it starts highlighted. */
const DEFAULT_PRESET_MONTHS = 12

/** The initial window: the most recent year of data, or all of it if shorter. */
export function defaultWindow(months: readonly number[]): MonthWindow {
  return presetWindow(months, DEFAULT_PRESET_MONTHS)
}

function monthOptions(months: readonly number[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const monthKey of months) {
    const option = document.createElement('option')
    option.value = String(monthKey)
    option.textContent = monthLabel(monthKey)
    fragment.append(option)
  }
  return fragment
}

/**
 * Preset buttons over two month selects. The presets are shortcuts that write
 * into the selects rather than a separate mode, so there is only ever one
 * source of truth — the `window` the caller owns, mutated in place.
 */
export function createTimeWindowPicker(
  months: readonly number[],
  window: MonthWindow,
  onChange: () => void,
): TimeWindowPicker {
  const element = document.createElement('div')
  element.className = 'timewindow'

  const fromSelect = document.createElement('select')
  fromSelect.className = 'tw-select'
  fromSelect.setAttribute('aria-label', 'First month')
  fromSelect.append(monthOptions(months))

  const toSelect = document.createElement('select')
  toSelect.className = 'tw-select'
  toSelect.setAttribute('aria-label', 'Last month')
  toSelect.append(monthOptions(months))

  const presetButtons = PRESETS.map((preset) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button tw-preset'
    button.textContent = preset.label
    button.addEventListener('click', () => {
      const next = presetWindow(months, preset.months)
      window.from = next.from
      window.to = next.to
      refresh()
      onChange()
    })
    return { preset, button }
  })

  /** Pushes the selects and the preset highlight back in line with `window`. */
  function refresh(): void {
    fromSelect.value = String(window.from)
    toSelect.value = String(window.to)
    for (const { preset, button } of presetButtons) {
      const span = presetWindow(months, preset.months)
      const active = span.from === window.from && span.to === window.to
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    }
  }

  // Moving one end past the other drags the other end along, so the window is
  // never inverted and no selection is silently rejected.
  fromSelect.addEventListener('change', () => {
    window.from = Number(fromSelect.value)
    if (window.to < window.from) window.to = window.from
    refresh()
    onChange()
  })
  toSelect.addEventListener('change', () => {
    window.to = Number(toSelect.value)
    if (window.from > window.to) window.from = window.to
    refresh()
    onChange()
  })

  const presetRow = document.createElement('div')
  presetRow.className = 'tw-presets'
  presetRow.append(...presetButtons.map(({ button }) => button))

  const range = document.createElement('div')
  range.className = 'tw-range'
  const fromLabel = document.createElement('span')
  fromLabel.className = 'tw-sep'
  fromLabel.textContent = 'from'
  const toLabel = document.createElement('span')
  toLabel.className = 'tw-sep'
  toLabel.textContent = 'to'
  range.append(fromLabel, fromSelect, toLabel, toSelect)

  element.append(presetRow, range)
  refresh()

  return { element }
}
