// A fake element table and tree helpers for pure renders, and the engine's tree rules checked on a fake tree.

type El = Record<string, (props: Record<string, unknown>) => unknown>

/** An element table that builds plain descriptions, for unit-level renders. */
export function fakeElements(tags = ['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown']): El {
  return Object.fromEntries(tags.map((type) => [type, (props: Record<string, unknown>) => ({ type, props })]))
}

/** Every element in a fake tree, depth first. */
export function walk(node: any, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out
  out.push(node)
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) walk(child, out)
  return out
}

export const byKey = (tree: unknown, key: string) => walk(tree).find((node) => node.props?.key === key)

/** All strings under a fake node, joined with spaces. */
export function textOf(node: any): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  const children = node.props?.children
  return (Array.isArray(children) ? children : [children]).map(textOf).filter(Boolean).join(' ')
}

const SPACING_PROPS = ['gap', 'columnGap', 'rowGap', 'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight']
const LAYOUT_PROPS = ['position', 'top', 'left', 'right', 'bottom', 'flexDirection', 'flexGrow', 'flexShrink', 'flexWrap', 'alignItems', 'alignSelf', 'justifyContent', 'width', 'height', 'minWidth', 'minHeight', 'borderStyle', 'borderColor', 'borderDimColor', 'overflow', 'display', ...SPACING_PROPS]
/** The engine's ThemeKey colour names (2.1.295 and 2.1.299). */
const THEME_COLOURS = new Set(['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide', 'diffAdded', 'diffRemoved', 'diffAddedDimmed', 'diffRemovedDimmed', 'diffAddedWord', 'diffRemovedWord'])
const childrenOf = (node: any) => {
  const children = node.props?.children
  return children === undefined || children === null ? [] : Array.isArray(children) ? children : [children]
}

/**
 * The tree rules the engine enforces, checked on a fake tree: a Text has no
 * key and no layout props; a Button holds only strings and Text; every key is
 * unique; no style prop outside the engine's vocabulary (no hex colours);
 * nothing engine 2.1.295 (the one inside Claude Desktop) refuses.
 * Returns the problems found (empty: valid).
 */
export function treeProblems(tree: unknown): string[] {
  const problems: string[] = []
  const keys = new Set<string>()
  for (const node of walk(tree)) {
    const props = node.props ?? {}
    if (typeof props.key === 'string') {
      if (keys.has(props.key)) problems.push(`duplicate key ${props.key}`)
      keys.add(props.key)
    }
    if (node.type === 'Text') {
      if ('key' in props) problems.push('Text with a key')
      for (const prop of LAYOUT_PROPS) if (prop in props) problems.push(`Text with layout prop ${prop}`)
      for (const child of childrenOf(node)) if (child && typeof child === 'object' && child.type !== 'Text') problems.push(`Text holds ${child.type}`)
    }
    if (node.type === 'Button') {
      for (const child of childrenOf(node)) if (child !== null && typeof child !== 'string' && child?.type !== 'Text') problems.push(`Button ${props.key} holds ${child?.type}`)
      if (typeof props.onPress !== 'function') problems.push(`Button ${props.key} without onPress`)
    }
    if (node.type === 'Input') {
      if (typeof props.key !== 'string') problems.push('Input without a key')
      if (typeof props.onSubmit !== 'function') problems.push(`Input ${props.key} without onSubmit`)
    }
    // Engine 2.1.295 (Claude Desktop) refuses a whole pane over these 2.1.299
    // additions: Text size / weight / tabular / mono, and spacing step names.
    if (node.type === 'Text') for (const prop of ['size', 'weight', 'tabular', 'mono']) if (prop in props) problems.push(`Text ${prop} (engine 2.1.299+ only)`)
    for (const prop of SPACING_PROPS) {
      if (prop in props && typeof props[prop] !== 'number') problems.push(`${node.type} ${prop}=${props[prop]} (step names are engine 2.1.299+ only)`)
    }
    for (const name of ['color', 'borderColor', 'backgroundColor']) {
      if (typeof props[name] === 'string' && !THEME_COLOURS.has(props[name])) problems.push(`${name} ${props[name]} is not a theme colour`)
    }
  }
  return problems
}
