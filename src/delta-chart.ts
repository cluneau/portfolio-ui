import {
  HEIGHT,
  PAD,
  changeFormat,
  geometryFor,
  scaleFor,
  signedFormat,
  svg,
  totalFormat,
  xAxis,
  yAxis,
  yScale,
} from './chart-core'
import { monthLabel } from './portfolio'
import type { DeltaPoint } from './portfolio'

/** Widest a single bar gets, so a short window does not draw slabs. */
const MAX_BAR = 34
/** Share of its slot a bar fills, leaving the rest as the gap to its neighbour. */
const BAR_FILL = 0.66

/**
 * The month-over-month change in the total, as bars, with the mean change over
 * the window drawn across them as a reference line.
 *
 * Like the area chart it renders into `host` instead of returning an element:
 * the plot is laid out in pixels, and the width it has can only be measured
 * once the card is in the document.
 */
export function renderDeltaChart(
  host: HTMLElement,
  changes: readonly DeltaPoint[],
): void {
  const card = document.createElement('section')
  card.className = 'chart-card'

  if (changes.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent =
      'A month-over-month change needs two months — widen the time window.'
    card.append(empty)
    host.replaceChildren(card)
    return
  }

  const last = changes[changes.length - 1]!
  // The mean of the changes, which is also the total move spread evenly over
  // the window — one number for "how fast is this growing per month".
  const average =
    changes.reduce((sum, point) => sum + point.change, 0) / changes.length

  const head = document.createElement('div')
  head.className = 'chart-head'
  const caption = document.createElement('span')
  caption.className = 'controls-label'
  caption.textContent = 'Monthly change'
  const latest = document.createElement('p')
  latest.className = `chart-total ${last.change < 0 ? 'down' : 'up'}`
  latest.textContent = signedFormat.format(last.change)
  const when = document.createElement('p')
  when.className = 'chart-note'
  when.textContent = `in ${monthLabel(last.monthKey)}`
  const mean = document.createElement('p')
  mean.className = 'chart-note chart-mean'
  // A dash in the line's own colour keys this figure to the line in the plot.
  // The alternative, labelling the line where it is drawn, puts text over the
  // newest bars — the right-hand end is where the line has least room.
  const dash = document.createElement('span')
  dash.className = 'chart-dash'
  const meanText = document.createElement('span')
  meanText.textContent = `${signedFormat.format(average)} / month on average`
  mean.append(dash, meanText)
  head.append(caption, latest, when, mean)

  const tip = document.createElement('div')
  tip.className = 'chart-tip'
  tip.hidden = true

  const body = document.createElement('div')
  body.className = 'chart-body'
  card.append(head, body)
  host.replaceChildren(card)

  const width = body.clientWidth
  const geometry = geometryFor(width)
  const { innerWidth } = geometry

  // The average is part of the domain, not just drawn over it: a window whose
  // mean sits above every bar would otherwise push the line off the top.
  const scale = scaleFor([...changes.map((point) => point.change), average])
  const yAt = yScale(scale, geometry)

  // Bars own a slot each and are centred in it, rather than sitting on the
  // edges the way a line's points do — a bar on the first point would be half
  // outside the plotting area.
  const slot = innerWidth / changes.length
  const barWidth = Math.max(1, Math.min(MAX_BAR, slot * BAR_FILL))
  const xAt = (index: number): number => PAD.left + (index + 0.5) * slot
  const zero = yAt(0)

  const plot = svg('svg', {
    width,
    height: HEIGHT,
    viewBox: `0 0 ${width} ${HEIGHT}`,
    class: 'chart-plot chart-plot-delta',
    role: 'img',
    'aria-label': `Month-over-month change, ${monthLabel(changes[0]!.monthKey)} to ${monthLabel(last.monthKey)}, averaging ${signedFormat.format(average)} per month`,
  })

  plot.append(yAxis(plot, scale, yAt, geometry))

  // A bar is drawn from the zero line to its value, so a fall hangs below the
  // axis instead of being drawn upwards in a different colour and read as a
  // gain. Zero changes still get a sliver, or a flat month would look like a
  // missing one.
  const bars = changes.map((point, index) => {
    const y = yAt(point.change)
    const bar = svg('rect', {
      class: `delta-bar ${point.change < 0 ? 'down' : 'up'}`,
      x: xAt(index) - barWidth / 2,
      y: Math.min(y, zero),
      width: barWidth,
      height: Math.max(1, Math.abs(y - zero)),
      rx: Math.min(2, barWidth / 2),
    })
    plot.append(bar)
    return bar
  })

  const meanY = yAt(average)
  plot.append(
    svg('line', {
      class: 'delta-average',
      x1: PAD.left,
      y1: meanY,
      x2: PAD.left + innerWidth,
      y2: meanY,
    }),
  )
  xAxis(plot, changes.map((point) => monthLabel(point.monthKey)), xAt, geometry)
  body.append(plot, tip)

  plot.addEventListener('pointermove', (event) => {
    const bounds = plot.getBoundingClientRect()
    const index = Math.min(
      changes.length - 1,
      Math.max(0, Math.floor((event.clientX - bounds.left - PAD.left) / slot)),
    )
    const point = changes[index]!
    for (const [barIndex, bar] of bars.entries()) {
      bar.classList.toggle('active', barIndex === index)
    }

    tip.hidden = false
    tip.replaceChildren(changeTip(point, average))
    // Anchored to the outer end of the bar, so the tooltip sits clear of it
    // whichever way the bar points, and clamped to the card's width. A fall
    // reads downwards, and so does a rise too tall to leave room above it.
    const y = yAt(point.change)
    const outer = point.change < 0 ? Math.max(y, zero) : Math.min(y, zero)
    const half = tip.offsetWidth / 2
    tip.classList.toggle('below', point.change < 0 || outer - tip.offsetHeight - 12 < 0)
    tip.style.left = `${Math.min(Math.max(xAt(index), half), width - half)}px`
    tip.style.top = `${outer}px`
  })
  plot.addEventListener('pointerleave', () => {
    for (const bar of bars) bar.classList.remove('active')
    tip.hidden = true
  })
}

/**
 * The hovered month's change, as an amount and — when there was something to
 * grow from — as a share of the month before, with the window's average beside
 * it for comparison.
 */
function changeTip(point: DeltaPoint, average: number): DocumentFragment {
  const fragment = document.createDocumentFragment()
  const heading = document.createElement('div')
  heading.className = 'tip-head'
  heading.textContent = monthLabel(point.monthKey)
  fragment.append(heading)

  const rows = document.createElement('div')
  rows.className = 'tip-rows tip-rows-delta'
  const percent =
    point.previous === 0
      ? ''
      : ` · ${changeFormat.format((point.change / Math.abs(point.previous)) * 100)}%`
  for (const [label, text] of [
    ['Change', `${signedFormat.format(point.change)}${percent}`],
    ['Average', signedFormat.format(average)],
    ['Total', totalFormat.format(point.previous + point.change)],
  ] as const) {
    const name = document.createElement('span')
    name.textContent = label
    const value = document.createElement('span')
    value.className = 'tip-value'
    value.textContent = text
    rows.append(name, value)
  }

  fragment.append(rows)
  return fragment
}
