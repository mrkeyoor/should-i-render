import { allComponents, allPalettes, allTemplates, findByName, findPalette, findTemplate } from './data.js'
import { clamp } from './clamp.js'

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'for', 'from', 'i', 'in', 'is',
  'it', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'use', 'want',
  'with', 'component', 'components', 'need', 'should', 'render',
])

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

const PALETTE_NOTE = 'Automatic theming applies to first-party components; third-party entries need manual mapping.'
const SITE_URL = 'https://vibecodng.com'

function componentPage(component) {
  return `${SITE_URL}/components/${component.slug}/`
}

function styleLabel(component) {
  return component.style || 'unclassified'
}

function sourceUrl(component) {
  return component.sourceUrl || component.results?.sourceUrl || null
}

function installCommand(component) {
  const url = sourceUrl(component)
  return url && /\.json(?:[?#].*)?$/i.test(url)
    ? `npx shadcn@latest add "${url}"`
    : null
}

function isVerifiedCandidate(component) {
  return component.results?.mount?.ok === true && !component.isFailureWarning
}

export function cssVariables(palette) {
  const { accent, surface, text, muted } = palette.colors
  return `:root {\n  --bw-accent: ${accent};\n  --bw-surface: ${surface};\n  --bw-text: ${text};\n  --bw-muted: ${muted};\n}`
}

function paletteSummary(palette) {
  return { name: palette.name, colors: palette.colors, tags: palette.tags, cssVariables: cssVariables(palette) }
}

async function appendPalette(result, paletteName) {
  if (!paletteName) return result
  const palette = await findPalette(paletteName)
  if (!palette) {
    return {
      ...result,
      text: `${result.text}\n\nPalette "${paletteName}" is not in the bundled catalog. Use palette_pick to choose a palette.`,
      structuredContent: { ...result.structuredContent, palette: null },
    }
  }
  return {
    ...result,
    text: `${result.text}\n\nPalette: ${palette.name}\n${cssVariables(palette)}\n${PALETTE_NOTE}`,
    structuredContent: { ...result.structuredContent, palette: paletteSummary(palette) },
  }
}

function tokenize(value) {
  return String(value || '').toLowerCase().split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

function hits(tokens, value) {
  const text = String(value || '').toLowerCase()
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0)
}

function firstSentence(value) {
  const text = String(value || '').trim()
  const match = text.match(/^.*?[.!?](?=\s|$)/)
  return match ? match[0] : text
}

export function a11yCount(component) {
  return Object.values(component.results?.a11y?.counts || {})
    .reduce((sum, value) => sum + (Number(value) || 0), 0)
}

export function measured(component) {
  const results = component.results || {}
  return {
    renders: Boolean(results.mount?.ok),
    a11y: a11yCount(component),
    marginalKb: results.bundle?.marginalKb ?? null,
    bare: Boolean(results.bare?.mountOk),
    needsProvider: Boolean(results.needsProvider),
  }
}

export function measuredStrip(component) {
  const value = measured(component)
  const kb = value.marginalKb == null ? '?KB' : `${Number(value.marginalKb).toFixed(1)}KB`
  return [
    value.renders ? '✓RENDERS' : '✗RENDERS',
    `A11Y ${value.a11y}`,
    kb,
    value.bare ? '✓BARE' : '✗BARE',
    value.needsProvider ? 'PROVIDER' : 'NO PROVIDER',
  ].join(' · ')
}

function summary(component) {
  return {
    name: component.name,
    slug: component.slug,
    pattern: component.pattern,
    style: component.style,
    verdict: component.prose?.verdict || '',
    measured: measured(component),
    pageUrl: componentPage(component),
    sourceUrl: sourceUrl(component),
    failureWarning: Boolean(component.isFailureWarning),
  }
}

function quality(component) {
  const value = measured(component)
  return (value.renders ? 1000 : 0) + (value.bare ? 150 : 0) -
    (component.isFailureWarning ? 600 : 0) - (value.needsProvider ? 30 : 0) -
    value.a11y * 20 - (value.marginalKb || 0)
}

export async function findComponent({ task, pattern, style, palette }) {
  const components = await allComponents({ pattern, style })
  const tokens = tokenize(task)
  const ranked = components.filter(isVerifiedCandidate).map((component) => {
    const prose = component.prose || {}
    const proseText = [
      prose.whatIs,
      prose.verdict,
      ...(prose.useIf || []),
      ...(prose.skipIf || []),
    ].join(' ')
    const score = hits(tokens, component.name) * 8 +
      hits(tokens, component.pattern) * 6 +
      hits(tokens, component.style) * 4 +
      hits(tokens, proseText) * 2 + quality(component) / 10000
    return { component, score }
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || quality(b.component) - quality(a.component))
    .slice(0, 3)

  if (!ranked.length) {
    return appendPalette({
      text: `No verified, rendering component matched "${task}"${pattern ? ` in ${pattern}` : ''}${style ? ` with ${style} style` : ''}. Try a different pattern or style; use skip_list to inspect rejected candidates.`,
      structuredContent: { query: { task, pattern: pattern || null, style: style || null, palette: palette || null }, matches: [] },
    }, palette)
  }
  const lines = [`Best measured fits for: ${task}`]
  for (const { component } of ranked) {
    lines.push(`\n${component.name} [${component.pattern} / ${styleLabel(component)}]`)
    lines.push(firstSentence(component.prose?.verdict))
    lines.push(measuredStrip(component))
    lines.push(`Review: ${componentPage(component)}`)
  }
  return appendPalette({
    text: lines.join('\n'),
    structuredContent: {
      query: { task, pattern: pattern || null, style: style || null, palette: palette || null },
      matches: ranked.map(({ component }) => summary(component)),
    },
  }, palette)
}

export async function palettePick({ mood } = {}) {
  const palettes = await allPalettes()
  const target = String(mood || '').trim().toLowerCase()
  let picks

  const exact = target ? palettes.find((palette) => palette.name === target) : null
  if (exact) {
    picks = [exact]
  } else if (target) {
    const moodTokens = tokenize(target)
    picks = palettes.map((palette) => {
      const score = hits(moodTokens, palette.name) * 4 +
        moodTokens.reduce((total, token) => total + (palette.tags.includes(token) ? 6 : 0), 0)
      return { palette, score }
    }).filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.palette.name.localeCompare(b.palette.name))
      .slice(0, 3)
      .map(({ palette }) => palette)
  }

  if (!picks?.length) {
    const featured = ['paper-coral', 'aurora-terminal', 'sand-and-cedar']
    picks = featured.map((name) => palettes.find((palette) => palette.name === name)).filter(Boolean)
  }

  const lines = [target ? `Palette picks for: ${mood}` : 'Versatile palette picks:']
  for (const palette of picks) {
    const { accent, surface, text, muted } = palette.colors
    lines.push(`\n${palette.name} [${palette.tags.join(', ')}]`)
    lines.push(`accent ${accent} · surface ${surface} · text ${text} · muted ${muted}`)
    lines.push(cssVariables(palette))
  }
  return {
    text: lines.join('\n'),
    structuredContent: { query: { mood: mood || null }, palettes: picks.map(paletteSummary) },
  }
}

export async function checkComponent({ name }) {
  const component = await findByName(name)
  if (!component) {
    return {
      text: `"${name}" is not in the bundled should-i-render snapshot. Try the exact component name or use find_component.`,
      structuredContent: { query: { name }, component: null },
    }
  }
  const prose = component.prose || {}
  const lines = [
    `${component.name} [${component.pattern} / ${styleLabel(component)}]`,
    prose.whatIs || '',
    `Verdict: ${prose.verdict || 'No verdict recorded.'}`,
    measuredStrip(component),
  ]
  if ((prose.skipIf || []).length) {
    lines.push('Skip if:', ...(prose.skipIf || []).map((item) => `- ${item}`))
  }
  return {
    text: lines.filter(Boolean).join('\n'),
    structuredContent: {
      query: { name },
      component: { ...summary(component), whatIs: prose.whatIs || '', skipIf: prose.skipIf || [] },
    },
  }
}

export async function alternatives({ name }) {
  const component = await findByName(name)
  if (!component) {
    return {
      text: `"${name}" is not in the bundled should-i-render snapshot.`,
      structuredContent: { query: { name }, source: null, candidates: [] },
    }
  }
  const candidates = (await allComponents({ pattern: component.pattern }))
    .filter((candidate) => candidate.slug !== component.slug && isVerifiedCandidate(candidate))
    .sort((a, b) => quality(b) - quality(a) || a.name.localeCompare(b.name))
    .slice(0, 5)
  const lines = [`Alternatives to ${component.name} in ${component.pattern}:`]
  for (const candidate of candidates) {
    lines.push(`- ${candidate.name} [${styleLabel(candidate)}]: ${firstSentence(candidate.prose?.verdict)} ${measuredStrip(candidate)} ${componentPage(candidate)}`)
  }
  if (!candidates.length) lines.push('No same-pattern alternative is in this snapshot.')
  return {
    text: lines.join('\n'),
    structuredContent: {
      query: { name },
      source: summary(component),
      candidates: candidates.map(summary),
    },
  }
}

export async function installPlan({ name }) {
  const component = await findByName(name)
  if (!component) {
    return {
      text: `"${name}" is not in the bundled should-i-render snapshot.`,
      structuredContent: { query: { name }, plan: null },
    }
  }
  const results = component.results || {}
  const declared = results.deps?.declared || []
  const missing = results.deps?.missing || []
  const provider = results.needsProvider
    ? 'Required. Mount the component inside the provider used by its source demo.'
    : 'No provider requirement was measured.'
  const bare = results.bare?.mountOk
    ? 'The bare harness mounted successfully.'
    : 'The bare harness did not mount. Follow the source-distributed setup notes.'
  const credit = component.authorRepo || component.sourceUrl || 'No author repository recorded.'
  const registryUrl = sourceUrl(component)
  const command = installCommand(component)
  const lines = [
    `Install plan for ${component.name}:`,
    `Declared dependencies: ${declared.length ? declared.join(', ') : 'none recorded'}`,
    `Missing during prepared run: ${missing.length ? missing.join(', ') : 'none'}`,
    `Bare setup: ${bare}`,
    `Provider: ${provider}`,
    `Setup notes: ${component.prose?.installNotes || 'No extra setup notes recorded.'}`,
    `License: ${component.license || 'unknown'}${component.licenseUrl ? ` (${component.licenseUrl})` : ''}`,
    `Author credit: ${credit}`,
    `Measured review: ${componentPage(component)}`,
    registryUrl ? `Source: ${registryUrl}` : 'Source: not recorded',
    command ? `Install command: ${command}` : 'Install command: no shadcn registry JSON was recorded; use the source link and author instructions.',
  ]
  return {
    text: lines.join('\n'),
    structuredContent: {
      query: { name },
      plan: {
        component: summary(component), declared, missing,
        bare: results.bare?.mountOk || false,
        needsProvider: Boolean(results.needsProvider),
        installNotes: component.prose?.installNotes || '',
        license: component.license || null,
        licenseUrl: component.licenseUrl || null,
        authorRepo: component.authorRepo || null,
        pageUrl: componentPage(component),
        sourceUrl: registryUrl,
        installCommand: command,
      },
    },
  }
}

function risk(component) {
  const value = measured(component)
  return (component.isFailureWarning ? 10000 : 0) + (!value.renders ? 5000 : 0) +
    (value.needsProvider ? 500 : 0) + value.a11y * 100 + (value.marginalKb || 0)
}

export async function skipList({ pattern, style }) {
  const components = await allComponents({ pattern, style })
  const entries = components.sort((a, b) => risk(b) - risk(a) || a.name.localeCompare(b.name)).slice(0, 5)
  const lines = [`Skip-first list for ${pattern}${style ? ` / ${style}` : ''}:`]
  for (const component of entries) {
    const buildError = component.results?.build?.errors?.[0]
    const reason = component.isFailureWarning && buildError
      ? String(buildError).split('\n')[0]
      : component.prose?.skipIf?.[0] || 'Compare the measured strip before adopting it.'
    lines.push(`- ${component.name}: ${reason} ${measuredStrip(component)}`)
  }
  if (!entries.length) lines.push('No component matched that pattern and style.')
  return {
    text: lines.join('\n'),
    structuredContent: {
      query: { pattern, style: style || null },
      entries: entries.map((component) => ({ ...summary(component), reason: component.prose?.skipIf?.[0] || '' })),
    },
  }
}

function templateSummary(template) {
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    style: template.style,
    tags: template.tags,
    description: template.description,
    previewUrl: template.previewUrl,
    detailUrl: template.detailUrl,
    sourceUrl: template.sourceUrl,
    downloadUrl: template.downloadUrl,
    cloneCommand: template.cloneCommand,
    variants: template.variants.map((variant) => variant.name),
    a11y: template.a11y,
  }
}

function templateScore(template, tokens) {
  const searchable = [template.name, template.title, template.description, template.category, template.style, ...template.tags].join(' ')
  return hits(tokens, template.name) * 10 + hits(tokens, template.tags.join(' ')) * 7 +
    hits(tokens, searchable) * 2 + (template.a11y?.clean === true ? 3 : 0) -
    (template.a11y?.clean === false ? 1000 : 0)
}

export async function findTemplateTool({ task, category, style }) {
  const templates = await allTemplates({ category, style })
  const tokens = tokenize(task)
  const ranked = templates.map((template) => ({ template, score: templateScore(template, tokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name))
    .slice(0, 3)
  if (!ranked.length) {
    return {
      text: `No template matched "${task}"${category ? ` in ${category}` : ''}${style ? ` with ${style} style` : ''}. Try broader wording or omit a filter.`,
      structuredContent: { query: { task, category: category || null, style: style || null }, matches: [] },
    }
  }
  const lines = [`Best complete-template fits for: ${task}`]
  for (const { template } of ranked) {
    lines.push(`\n${template.name} [${template.category}${template.style ? ` / ${template.style}` : ''}]`)
    lines.push(firstSentence(template.description))
    lines.push(`Preview: ${template.previewUrl}`)
    lines.push(`Details: ${template.detailUrl}`)
  }
  return {
    text: lines.join('\n'),
    structuredContent: {
      query: { task, category: category || null, style: style || null },
      matches: ranked.map(({ template }) => templateSummary(template)),
    },
  }
}

export async function checkTemplate({ name }) {
  const template = await findTemplate(name)
  if (!template) {
    return {
      text: `"${name}" is not in the bundled template library. Use find_template to discover a complete starter.`,
      structuredContent: { query: { name }, template: null },
    }
  }
  const audit = template.a11y?.clean === true ? 'axe audit clean' : template.a11y?.clean === false ? 'accessibility review required' : 'audit pending'
  return {
    text: [
      `${template.name} [${template.category}${template.style ? ` / ${template.style}` : ''}]`,
      template.description,
      `Stack: ${template.stack.join(', ')} · License: ${template.license} · ${audit}`,
      `Preview: ${template.previewUrl}`,
      `Source: ${template.sourceUrl}`,
      `Download: ${template.downloadUrl}`,
    ].join('\n'),
    structuredContent: { query: { name }, template: templateSummary(template) },
  }
}

export async function templatePlan({ name, palette }) {
  const template = await findTemplate(name)
  if (!template) {
    return {
      text: `"${name}" is not in the bundled template library.`,
      structuredContent: { query: { name, palette: palette || null }, plan: null },
    }
  }
  const selected = palette ? template.variants.find((variant) => variant.name === String(palette).toLowerCase()) : null
  const paletteLine = palette
    ? selected ? `Palette preview: ${selected.previewUrl}` : `Palette "${palette}" is unavailable. Choose: ${template.variants.map((variant) => variant.name).join(', ') || 'no palette variants'}.`
    : `Palette variants: ${template.variants.map((variant) => variant.name).join(', ') || 'none; use the default design'}.`
  const lines = [
    `Template plan for ${template.name}:`,
    `1. Clone: ${template.cloneCommand}`,
    '2. Run: npm install && npm run dev',
    `3. Review the complete page: ${selected?.previewUrl || template.previewUrl}`,
    `4. Keep attribution notes in TEMPLATE.md and preserve the ${template.license} license.`,
    paletteLine,
    `Source: ${template.sourceUrl}`,
  ]
  return {
    text: lines.join('\n'),
    structuredContent: {
      query: { name, palette: palette || null },
      plan: { template: templateSummary(template), selectedPalette: selected || null },
    },
  }
}

const objectOutput = (properties, required) => ({
  type: 'object', properties, required, additionalProperties: false,
})
const summaryArray = { type: 'array', items: { type: 'object', additionalProperties: true } }

export const TOOLS = [
  {
    name: 'find_component', title: 'Find a measured component',
    description: 'Rank up to three verified, rendering React components for a UI task using prose, pattern, style, and measured harness results. Failure warnings are excluded.',
    inputSchema: objectOutput({
      task: { type: 'string', description: 'The UI task or behavior needed.' },
      pattern: { type: 'string', description: 'Optional exact pattern filter.' },
      style: { type: 'string', description: 'Optional exact visual style filter.' },
      palette: { type: 'string', description: 'Optional exact bundled palette slug to append as CSS variables.' },
    }, ['task']),
    outputSchema: objectOutput({ query: { type: 'object' }, matches: summaryArray, palette: {} }, ['query', 'matches']),
    annotations: READ_ONLY,
    handler: findComponent,
  },
  {
    name: 'palette_pick', title: 'Pick an accessible palette',
    description: 'Return one to three curated four-color palettes by mood, with hex roles and copyable CSS variables.',
    inputSchema: objectOutput({
      mood: { type: 'string', description: 'Optional mood, palette slug, or tags such as dark, pastel, warm, or cold.' },
    }, []),
    outputSchema: objectOutput({ query: { type: 'object' }, palettes: { type: 'array', items: { type: 'object', additionalProperties: true } } }, ['query', 'palettes']),
    annotations: READ_ONLY,
    handler: palettePick,
  },
  {
    name: 'check_component', title: 'Check one component',
    description: 'Return the full verdict, skip conditions, and measured render, accessibility, bundle, bare, and provider facts.',
    inputSchema: objectOutput({ name: { type: 'string', description: 'Exact component name or slug.' } }, ['name']),
    outputSchema: objectOutput({ query: { type: 'object' }, component: {} }, ['query', 'component']),
    annotations: READ_ONLY,
    handler: checkComponent,
  },
  {
    name: 'alternatives', title: 'Rank same-pattern alternatives',
    description: 'Compare same-pattern candidates using their verdicts and measured harness results.',
    inputSchema: objectOutput({ name: { type: 'string', description: 'Exact component name or slug.' } }, ['name']),
    outputSchema: objectOutput({ query: { type: 'object' }, source: {}, candidates: summaryArray }, ['query', 'source', 'candidates']),
    annotations: READ_ONLY,
    handler: alternatives,
  },
  {
    name: 'install_plan', title: 'Plan component installation',
    description: 'List dependencies, bare-harness gaps, provider requirements, setup notes, license, author credit, measured review URL, source URL, and an exact shadcn command when supported.',
    inputSchema: objectOutput({ name: { type: 'string', description: 'Exact component name or slug.' } }, ['name']),
    outputSchema: objectOutput({ query: { type: 'object' }, plan: {} }, ['query', 'plan']),
    annotations: READ_ONLY,
    handler: installPlan,
  },
  {
    name: 'skip_list', title: 'Find components to skip first',
    description: 'Show failure warnings and the worst measured offenders in a pattern, optionally filtered by visual style.',
    inputSchema: objectOutput({
      pattern: { type: 'string', description: 'Exact component pattern.' },
      style: { type: 'string', description: 'Optional exact visual style.' },
    }, ['pattern']),
    outputSchema: objectOutput({ query: { type: 'object' }, entries: summaryArray }, ['query', 'entries']),
    annotations: READ_ONLY,
    handler: skipList,
  },
  {
    name: 'find_template', title: 'Find a complete page template',
    description: 'Rank up to three complete React page templates for a product or business task. Templates with a failed accessibility audit are excluded from recommendations.',
    inputSchema: objectOutput({
      task: { type: 'string', description: 'The site, product, business, or page needed.' },
      category: { type: 'string', enum: ['base', 'style', 'industry'], description: 'Optional template category.' },
      style: { type: 'string', description: 'Optional exact style or tag filter.' },
    }, ['task']),
    outputSchema: objectOutput({ query: { type: 'object' }, matches: summaryArray }, ['query', 'matches']),
    annotations: READ_ONLY,
    handler: findTemplateTool,
  },
  {
    name: 'check_template', title: 'Check one complete template',
    description: 'Return a template summary, stack, license, accessibility status, preview, source, download, and available palette variants.',
    inputSchema: objectOutput({ name: { type: 'string', description: 'Exact template name or slug.' } }, ['name']),
    outputSchema: objectOutput({ query: { type: 'object' }, template: {} }, ['query', 'template']),
    annotations: READ_ONLY,
    handler: checkTemplate,
  },
  {
    name: 'template_plan', title: 'Plan template adoption',
    description: 'Return an exact clone and setup plan for a complete template, optionally selecting one of its built palette variants.',
    inputSchema: objectOutput({
      name: { type: 'string', description: 'Exact template name or slug.' },
      palette: { type: 'string', description: 'Optional built palette variant slug.' },
    }, ['name']),
    outputSchema: objectOutput({ query: { type: 'object' }, plan: {} }, ['query', 'plan']),
    annotations: READ_ONLY,
    handler: templatePlan,
  },
]

export function listTools() {
  return TOOLS.map(({ handler, ...definition }) => definition)
}

export async function runTool(name, args = {}) {
  const tool = TOOLS.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`unknown tool: ${name}`)
  const result = await tool.handler(args)
  return { ...result, text: clamp(result.text) }
}
