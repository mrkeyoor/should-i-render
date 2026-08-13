import { allComponents, findByName } from './data.js'
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
  }
}

function quality(component) {
  const value = measured(component)
  return (value.renders ? 1000 : 0) + (value.bare ? 150 : 0) -
    (component.isFailureWarning ? 600 : 0) - (value.needsProvider ? 30 : 0) -
    value.a11y * 20 - (value.marginalKb || 0)
}

export async function findComponent({ task, pattern, style }) {
  const components = await allComponents({ pattern, style })
  const tokens = tokenize(task)
  const ranked = components.map((component) => {
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
    return {
      text: `No measured component matched "${task}"${pattern ? ` in ${pattern}` : ''}${style ? ` with ${style} style` : ''}. Try a concrete UI pattern or a different style name.`,
      structuredContent: { query: { task, pattern: pattern || null, style: style || null }, matches: [] },
    }
  }
  const lines = [`Best measured fits for: ${task}`]
  for (const { component } of ranked) {
    lines.push(`\n${component.name} [${component.pattern} / ${component.style}]`)
    lines.push(firstSentence(component.prose?.verdict))
    lines.push(measuredStrip(component))
  }
  return {
    text: lines.join('\n'),
    structuredContent: {
      query: { task, pattern: pattern || null, style: style || null },
      matches: ranked.map(({ component }) => summary(component)),
    },
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
    `${component.name} [${component.pattern} / ${component.style}]`,
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
    .filter((candidate) => candidate.slug !== component.slug)
    .sort((a, b) => quality(b) - quality(a) || a.name.localeCompare(b.name))
    .slice(0, 5)
  const lines = [`Alternatives to ${component.name} in ${component.pattern}:`]
  for (const candidate of candidates) {
    lines.push(`- ${candidate.name} [${candidate.style}]: ${firstSentence(candidate.prose?.verdict)} ${measuredStrip(candidate)}`)
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
  const lines = [
    `Install plan for ${component.name}:`,
    `Declared dependencies: ${declared.length ? declared.join(', ') : 'none recorded'}`,
    `Missing during prepared run: ${missing.length ? missing.join(', ') : 'none'}`,
    `Bare setup: ${bare}`,
    `Provider: ${provider}`,
    `Setup notes: ${component.prose?.installNotes || 'No extra setup notes recorded.'}`,
    `License: ${component.license || 'unknown'}${component.licenseUrl ? ` (${component.licenseUrl})` : ''}`,
    `Author credit: ${credit}`,
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

const objectOutput = (properties, required) => ({
  type: 'object', properties, required, additionalProperties: false,
})
const summaryArray = { type: 'array', items: { type: 'object', additionalProperties: true } }

export const TOOLS = [
  {
    name: 'find_component', title: 'Find a measured component',
    description: 'Rank up to three React components for a UI task using prose, pattern, style, and measured harness results.',
    inputSchema: objectOutput({
      task: { type: 'string', description: 'The UI task or behavior needed.' },
      pattern: { type: 'string', description: 'Optional exact pattern filter.' },
      style: { type: 'string', description: 'Optional exact visual style filter.' },
    }, ['task']),
    outputSchema: objectOutput({ query: { type: 'object' }, matches: summaryArray }, ['query', 'matches']),
    annotations: READ_ONLY,
    handler: findComponent,
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
    description: 'List dependencies, bare-harness gaps, provider requirements, setup notes, license, and author credit.',
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
