export interface MultiSelectItem<K> {
  value: K
  label: string
}

/** What the collapsed button says, e.g. `{ one: 'user', many: 'users' }`. */
export interface Noun {
  one: string
  many: string
}

export interface MultiSelect {
  element: HTMLElement
  /** Removes the document-level listeners that close the panel. */
  destroy(): void
}

function summarize<K>(
  items: readonly MultiSelectItem<K>[],
  selected: ReadonlySet<K>,
  noun: Noun,
): string {
  if (selected.size === 0) return `No ${noun.one} selected`
  if (selected.size === items.length) return `All ${noun.many}`
  if (selected.size === 1) {
    const only = items.find((item) => selected.has(item.value))
    if (only) return only.label
  }
  return `${selected.size} ${noun.many}`
}

/**
 * A dropdown with a checkbox per item. Native <select multiple> is a flat
 * always-open list with ctrl-click semantics, which is not what "pick one or
 * more from a menu" should feel like.
 *
 * `selected` is mutated in place, so the caller keeps one source of truth.
 */
export function createMultiSelect<K extends string | number>(
  items: readonly MultiSelectItem<K>[],
  selected: Set<K>,
  noun: Noun,
  onChange: () => void,
): MultiSelect {
  const element = document.createElement('div')
  element.className = 'multiselect'

  const label = document.createElement('span')
  label.className = 'ms-label'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'button ms-toggle'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.append(label)

  const panel = document.createElement('div')
  panel.className = 'ms-panel'
  panel.hidden = true

  const refresh = (): void => {
    label.textContent = summarize(items, selected, noun)
  }

  const boxes: HTMLInputElement[] = []

  const allBox = document.createElement('input')
  allBox.type = 'checkbox'
  allBox.addEventListener('change', () => {
    selected.clear()
    if (allBox.checked) for (const item of items) selected.add(item.value)
    for (const box of boxes) box.checked = allBox.checked
    refresh()
    onChange()
  })
  const allOption = document.createElement('label')
  allOption.className = 'ms-option ms-all'
  allOption.append(allBox, document.createTextNode(`All ${noun.many}`))
  panel.append(allOption)

  const syncAllBox = (): void => {
    allBox.checked = items.length > 0 && selected.size === items.length
    allBox.indeterminate = selected.size > 0 && selected.size < items.length
  }

  for (const item of items) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = selected.has(item.value)
    box.addEventListener('change', () => {
      if (box.checked) selected.add(item.value)
      else selected.delete(item.value)
      syncAllBox()
      refresh()
      onChange()
    })
    boxes.push(box)

    const option = document.createElement('label')
    option.className = 'ms-option'
    option.append(box, document.createTextNode(item.label))
    panel.append(option)
  }

  syncAllBox()
  refresh()

  const close = (): void => {
    panel.hidden = true
    toggle.setAttribute('aria-expanded', 'false')
  }

  toggle.addEventListener('click', () => {
    const open = panel.hidden
    panel.hidden = !open
    toggle.setAttribute('aria-expanded', String(open))
  })

  const onDocumentClick = (event: MouseEvent): void => {
    if (!panel.hidden && !element.contains(event.target as Node)) close()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && !panel.hidden) {
      close()
      toggle.focus()
    }
  }
  document.addEventListener('click', onDocumentClick)
  document.addEventListener('keydown', onKeyDown)

  element.append(toggle, panel)

  return {
    element,
    destroy() {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    },
  }
}
