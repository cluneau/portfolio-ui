import { monthLabel } from './portfolio'
import type { SeriesPoint, TypeSeries } from './portfolio'

/**
 * Fixed pixel geometry rather than a scaled viewBox: scaling a viewBox to the
 * container would stretch the text and the stroke with it, so the chart is laid
 * out at the width it is actually given and re-rendered when that changes.
 */
const HEIGHT = 260
/* `right` leaves room for half of the last month label, which is centred on the
   final point and would otherwise be cut off by the edge of the SVG. */
const PAD = { top: 18, right: 32, bottom: 30, left: 64 }
const TICK_COUNT = 4
/** Width one x label needs before its neighbours start colliding. */
const LABEL_WIDTH = 64
const GRADIENT_ID = 'chart-area-fill'
/** How many band colours the stylesheet defines, past which they repeat. */
const BAND_COLOURS = 6

const axisFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const totalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const changeFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})
const shareFormat = new Intl.NumberFormat(undefined, {
  style: 'percent',
  maximumFractionDigits: 0,
})

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name)
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, String(value))
  }
  return element
}

/**
 * Rounds a raw step up to 1, 2, 2.5 or 5 times a power of ten, so the y labels
 * land on round numbers instead of on whatever the data's maximum happens to be.
 */
function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const factor of [1, 2, 2.5, 5]) {
    if (raw <= factor * magnitude) return factor * magnitude
  }
  return 10 * magnitude
}

interface Scale {
  lo: number
  hi: number
  ticks: number[]
}

/**
 * The y domain always includes zero, so the area has an honest baseline and a
 * 2% wiggle on a large balance cannot be drawn as a cliff. Negative totals (a
 * debt account in the selection) push the baseline below zero instead of
 * clipping.
 */
function scaleFor(values: readonly number[]): Scale {
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  if (min === max) return { lo: 0, hi: 1, ticks: [0, 1] }

  const step = niceStep((max - min) / TICK_COUNT)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let value = lo; value <= hi + step / 2; value += step) ticks.push(value)
  return { lo, hi, ticks }
}

/**
 * The lower and upper edge of each band, month by month. A band is the running
 * sum before it and the running sum including it, so the bands always meet
 * without a seam and the top edge is the total — and a negative type (a debt)
 * simply hangs below the edge it started from instead of being dropped.
 */
function stackEdges(bands: readonly TypeSeries[], length: number): number[][] {
  const edges: number[][] = [new Array<number>(length).fill(0)]
  for (const band of bands) {
    const below = edges[edges.length - 1]!
    edges.push(below.map((value, column) => value + (band.totals[column] ?? 0)))
  }
  return edges
}

export interface ChartOptions {
  /** Draw one area per account type instead of a single total area. */
  stacked: boolean
  onStackedChange: (stacked: boolean) => void
}

/**
 * The selection's total over time, as an area chart. It renders into `host`
 * rather than returning an element because the plot is laid out in pixels, and
 * the width available to it can only be measured once the card is in the
 * document — the card's own border and padding come off it, and inserting the
 * card may itself bring out the page's scrollbar.
 */
export function renderChart(
  host: HTMLElement,
  series: readonly SeriesPoint[],
  bands: readonly TypeSeries[],
  options: ChartOptions,
): void {
  const card = document.createElement('section')
  card.className = 'chart-card'

  if (series.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'Nothing to plot for this selection.'
    card.append(empty)
    host.replaceChildren(card)
    return
  }

  const first = series[0]!
  const last = series[series.length - 1]!
  const stacked = options.stacked

  const head = document.createElement('div')
  head.className = 'chart-head'
  const caption = document.createElement('span')
  caption.className = 'controls-label'
  caption.textContent = 'Total'
  const total = document.createElement('p')
  total.className = 'chart-total'
  total.textContent = totalFormat.format(last.total)
  head.append(caption, total)

  // A percentage against a starting total of zero is meaningless, so that case
  // reports the move in absolute terms instead.
  if (series.length > 1) {
    const change = document.createElement('p')
    const absolute = last.total - first.total
    change.className = `chart-delta ${absolute < 0 ? 'down' : 'up'}`
    const move =
      first.total === 0
        ? totalFormat.format(absolute)
        : `${changeFormat.format((absolute / Math.abs(first.total)) * 100)}%`
    change.textContent = `${move} since ${monthLabel(first.monthKey)}`
    head.append(change)
  }

  // The toggle reports the flip and lets the caller re-render, rather than
  // swapping the drawing itself: the caller owns the flag, so the mode survives
  // every other re-render — a filter change, a resize.
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = `button secondary chart-toggle${stacked ? ' active' : ''}`
  toggle.textContent = 'By type'
  toggle.setAttribute('aria-pressed', String(stacked))
  toggle.addEventListener('click', () => options.onStackedChange(!stacked))
  head.append(toggle)

  const tip = document.createElement('div')
  tip.className = 'chart-tip'
  tip.hidden = true

  const body = document.createElement('div')
  body.className = 'chart-body'

  card.append(head, body)
  if (stacked) card.append(legendOf(bands))
  host.replaceChildren(card)

  // The empty body is already at its final width, so this is the room the plot
  // has — and reading it now, before the 260px-tall SVG exists, still risks a
  // scrollbar appearing afterwards, which is why the caller re-renders on a
  // resize of the host.
  const width = body.clientWidth
  const innerWidth = Math.max(80, width - PAD.left - PAD.right)
  const innerHeight = HEIGHT - PAD.top - PAD.bottom

  const edges = stackEdges(bands, series.length)
  const scale = scaleFor(
    stacked ? edges.flat() : series.map((point) => point.total),
  )

  const xAt = (index: number): number =>
    series.length === 1
      ? PAD.left + innerWidth / 2
      : PAD.left + (index * innerWidth) / (series.length - 1)
  const yAt = (value: number): number =>
    PAD.top + (innerHeight * (scale.hi - value)) / (scale.hi - scale.lo)

  const plot = svg('svg', {
    width,
    height: HEIGHT,
    viewBox: `0 0 ${width} ${HEIGHT}`,
    class: 'chart-plot',
    role: 'img',
    'aria-label': `Total from ${totalFormat.format(first.total)} in ${monthLabel(first.monthKey)} to ${totalFormat.format(last.total)} in ${monthLabel(last.monthKey)}${stacked ? `, split by ${bands.map((band) => band.type).join(', ')}` : ''}`,
  })

  const gradient = svg('linearGradient', {
    id: GRADIENT_ID,
    x1: 0,
    y1: 0,
    x2: 0,
    y2: 1,
  })
  gradient.append(
    svg('stop', { offset: '0%', 'stop-color': 'currentColor', 'stop-opacity': 0.28 }),
    svg('stop', { offset: '100%', 'stop-color': 'currentColor', 'stop-opacity': 0 }),
  )
  const defs = svg('defs')
  defs.append(gradient)
  plot.append(defs)

  // Bands are opaque, so under a stack the grid has to go on top of them or it
  // disappears; it is drawn in the surface colour there to read as a hairline
  // rather than a fourth band edge. The labels are outside the plot either way.
  const grid = svg('g', { class: stacked ? 'chart-grid-over' : '' })
  for (const value of scale.ticks) {
    const y = yAt(value)
    grid.append(
      svg('line', {
        class: value === 0 ? 'chart-grid chart-zero' : 'chart-grid',
        x1: PAD.left,
        y1: y,
        x2: PAD.left + innerWidth,
        y2: y,
      }),
    )
    const label = svg('text', {
      class: 'chart-axis',
      x: PAD.left - 10,
      y,
      dy: '0.32em',
      'text-anchor': 'end',
    })
    label.textContent = axisFormat.format(value)
    plot.append(label)
  }
  if (!stacked) plot.append(grid)

  const points = series.map((point, index) => `${xAt(index)},${yAt(point.total)}`)

  if (stacked && series.length > 1) {
    // Drawn bottom band first: each ribbon runs along its upper edge and back
    // along the lower one, so they tile the area under the total exactly.
    for (const [index, band] of bands.entries()) {
      const lower = edges[index]!
      const upper = edges[index + 1]!
      const up = upper.map((value, column) => `${xAt(column)},${yAt(value)}`)
      const down = lower
        .map((value, column) => `${xAt(column)},${yAt(value)}`)
        .reverse()
      plot.append(
        svg('path', {
          class: `chart-band ${bandClass(index)}`,
          d: `M ${up.join(' L ')} L ${down.join(' L ')} Z`,
          'data-type': band.type,
        }),
      )
    }
    // The total line stays on top of the stack: it is the same curve either
    // way, so switching modes does not make the shape jump.
    plot.append(grid, svg('path', { class: 'chart-line', d: `M ${points.join(' L ')}` }))
  } else if (series.length > 1) {
    const baseline = yAt(Math.max(scale.lo, 0))
    plot.append(
      svg('path', {
        class: 'chart-area',
        fill: `url(#${GRADIENT_ID})`,
        d: `M ${points.join(' L ')} L ${xAt(series.length - 1)},${baseline} L ${xAt(0)},${baseline} Z`,
      }),
      svg('path', { class: 'chart-line', d: `M ${points.join(' L ')}` }),
    )
  }

  // With few enough months, every point gets a marker; beyond that they turn
  // into a dotted band, so the line carries the shape on its own. Over a stack
  // they would sit on top of the bands as noise, so they are left out there —
  // except for a one-month window, where the marker is the only thing to draw.
  if (series.length === 1 || (series.length <= 24 && !stacked)) {
    for (const [index, point] of series.entries()) {
      plot.append(
        svg('circle', { class: 'chart-dot', cx: xAt(index), cy: yAt(point.total), r: 3 }),
      )
    }
  }

  const stride = Math.ceil(series.length / Math.max(2, Math.floor(innerWidth / LABEL_WIDTH)))
  // Walking back from the newest month keeps it labelled — it is the one a
  // reader looks for first.
  for (let index = series.length - 1; index >= 0; index -= stride) {
    const label = svg('text', {
      class: 'chart-axis',
      x: xAt(index),
      y: HEIGHT - PAD.bottom + 18,
      'text-anchor': 'middle',
    })
    label.textContent = monthLabel(series[index]!.monthKey)
    plot.append(label)
  }

  const guide = svg('line', {
    class: 'chart-guide',
    y1: PAD.top,
    y2: PAD.top + innerHeight,
    visibility: 'hidden',
  })
  const focus = svg('circle', { class: 'chart-focus', r: 4.5, visibility: 'hidden' })
  plot.append(guide, focus)

  body.append(plot, tip)

  const step = series.length === 1 ? innerWidth : innerWidth / (series.length - 1)
  plot.addEventListener('pointermove', (event) => {
    const bounds = plot.getBoundingClientRect()
    const index = Math.min(
      series.length - 1,
      Math.max(0, Math.round((event.clientX - bounds.left - PAD.left) / step)),
    )
    const point = series[index]!
    const x = xAt(index)
    const y = yAt(point.total)

    guide.setAttribute('x1', String(x))
    guide.setAttribute('x2', String(x))
    guide.setAttribute('visibility', 'visible')
    focus.setAttribute('cx', String(x))
    focus.setAttribute('cy', String(y))
    focus.setAttribute('visibility', 'visible')

    tip.hidden = false
    tip.replaceChildren(
      stacked ? breakdownTip(point, bands, index) : totalTip(point),
    )
    // Clamped to the card so the tooltip never hangs off either edge, and
    // dropped below the point when there is not enough room above it — the
    // breakdown tooltip is several lines tall and the line runs near the top.
    const half = tip.offsetWidth / 2
    tip.classList.toggle('below', y - tip.offsetHeight - 12 < 0)
    tip.style.left = `${Math.min(Math.max(x, half), width - half)}px`
    tip.style.top = `${y}px`
  })
  plot.addEventListener('pointerleave', () => {
    guide.setAttribute('visibility', 'hidden')
    focus.setAttribute('visibility', 'hidden')
    tip.hidden = true
  })
}

/** `chart-band-1` … `chart-band-6`, cycling, so each type keeps one colour. */
function bandClass(index: number): string {
  return `chart-band-${(index % BAND_COLOURS) + 1}`
}

function legendOf(bands: readonly TypeSeries[]): HTMLElement {
  const legend = document.createElement('ul')
  legend.className = 'chart-legend'
  // Top band first, matching the stack read from the top down.
  for (const [index, band] of [...bands.entries()].reverse()) {
    const item = document.createElement('li')
    const swatch = document.createElement('span')
    swatch.className = `chart-swatch ${bandClass(index)}`
    const name = document.createElement('span')
    name.textContent = band.type
    item.append(swatch, name)
    legend.append(item)
  }
  return legend
}

function totalTip(point: SeriesPoint): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const line = document.createElement('div')
  line.className = 'tip-head'
  line.textContent = `${monthLabel(point.monthKey)} · ${totalFormat.format(point.total)}`
  fragment.append(line)
  return fragment
}

/**
 * Each type's amount for the hovered month, with its share of the total — the
 * question the stacked view is there to answer. Shares are left out when the
 * total is zero, where they would all divide by nothing.
 */
function breakdownTip(
  point: SeriesPoint,
  bands: readonly TypeSeries[],
  index: number,
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const heading = document.createElement('div')
  heading.className = 'tip-head'
  heading.textContent = monthLabel(point.monthKey)
  fragment.append(heading)

  const rows = document.createElement('div')
  rows.className = 'tip-rows'
  for (const [bandIndex, band] of [...bands.entries()].reverse()) {
    const amount = band.totals[index] ?? 0
    const swatch = document.createElement('span')
    swatch.className = `chart-swatch ${bandClass(bandIndex)}`
    const name = document.createElement('span')
    name.textContent = band.type
    const value = document.createElement('span')
    value.className = 'tip-value'
    value.textContent =
      point.total === 0
        ? totalFormat.format(amount)
        : `${totalFormat.format(amount)} · ${shareFormat.format(amount / point.total)}`
    rows.append(swatch, name, value)
  }

  const label = document.createElement('span')
  label.className = 'tip-total'
  label.textContent = 'Total'
  const value = document.createElement('span')
  value.className = 'tip-value tip-total'
  value.textContent = totalFormat.format(point.total)
  rows.append(document.createElement('span'), label, value)

  fragment.append(rows)
  return fragment
}
