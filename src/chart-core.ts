/**
 * Geometry, scales and axes shared by the charts.
 *
 * Both plots are laid out at a fixed pixel size rather than scaled through a
 * viewBox — scaling one would stretch its text and stroke width with it — so
 * they agree on padding, tick spacing and number formats here instead of each
 * picking its own and drifting out of line with the other.
 */

export const HEIGHT = 260
/* `right` leaves room for half of the last month label, which is centred on the
   final column and would otherwise be cut off by the edge of the SVG. */
export const PAD = { top: 18, right: 32, bottom: 30, left: 64 }
const TICK_COUNT = 4
/** Width one x label needs before its neighbours start colliding. */
const LABEL_WIDTH = 64

export const axisFormat = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})
export const totalFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
})
/** Amounts that only mean something with their sign attached, such as a change. */
export const signedFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
  signDisplay: 'exceptZero',
})
/** The same, with a decimal, for a percentage the caller appends `%` to. */
export const changeFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  signDisplay: 'exceptZero',
})

export function svg<K extends keyof SVGElementTagNameMap>(
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

export interface Scale {
  lo: number
  hi: number
  ticks: number[]
}

/**
 * The y domain always includes zero, so an area has an honest baseline and a
 * 2% wiggle on a large balance cannot be drawn as a cliff. Negative values (a
 * debt account in the selection, or a month the total fell) push the domain
 * below zero instead of clipping.
 */
export function scaleFor(values: readonly number[]): Scale {
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

export interface Geometry {
  /** The full SVG width, border to border of the card. */
  width: number
  innerWidth: number
  innerHeight: number
}

export function geometryFor(width: number): Geometry {
  return {
    width,
    innerWidth: Math.max(80, width - PAD.left - PAD.right),
    innerHeight: HEIGHT - PAD.top - PAD.bottom,
  }
}

export function yScale(scale: Scale, { innerHeight }: Geometry) {
  return (value: number): number =>
    PAD.top + (innerHeight * (scale.hi - value)) / (scale.hi - scale.lo)
}

/**
 * The horizontal ruling and its labels. The labels go straight onto `plot`
 * because they sit outside the plotting area and nothing ever covers them; the
 * lines come back in a group the caller places itself, since a filled chart has
 * to draw them over its fill and an empty one under it.
 */
export function yAxis(
  plot: SVGSVGElement,
  scale: Scale,
  yAt: (value: number) => number,
  { innerWidth }: Geometry,
  className = '',
): SVGGElement {
  const grid = svg('g', { class: className })
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
  return grid
}

/**
 * Month labels, thinned out until they stop colliding. Walking back from the
 * newest month keeps it labelled — it is the one a reader looks for first.
 */
export function xAxis(
  plot: SVGSVGElement,
  labels: readonly string[],
  xAt: (index: number) => number,
  { innerWidth }: Geometry,
): void {
  const stride = Math.ceil(
    labels.length / Math.max(2, Math.floor(innerWidth / LABEL_WIDTH)),
  )
  for (let index = labels.length - 1; index >= 0; index -= stride) {
    const label = svg('text', {
      class: 'chart-axis',
      x: xAt(index),
      y: HEIGHT - PAD.bottom + 18,
      'text-anchor': 'middle',
    })
    label.textContent = labels[index]!
    plot.append(label)
  }
}
