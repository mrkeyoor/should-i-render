import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allComponents, allPalettes, allTemplates, countComponents, countTemplates } from '../data.js'
import { clamp, estimateTokens } from '../clamp.js'
import { TOOLS, listTools, runTool } from '../tools.js'

let fixtures

test('bundled snapshot contains the full measured index', async () => {
  const count = await countComponents()
  assert.ok(count >= 380, `expected at least 380 components, got ${count}`)
  const components = await allComponents()
  assert.equal(components.length, count)
  assert.ok(components.every((component) => typeof component.results?.needsProvider === 'boolean'))
})

test('all tools expose discovery metadata required by MCP clients', () => {
  const definitions = listTools()
  assert.equal(definitions.length, 9)
  for (const tool of definitions) {
    assert.ok(tool.title)
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.ok(tool.outputSchema)
    assert.equal('handler' in tool, false)
  }
})

test('bundled palette catalog exposes accessible four-role palettes', async () => {
  const palettes = await allPalettes()
  assert.equal(palettes.length, 24)
  assert.ok(palettes.every((palette) => ['accent', 'surface', 'text', 'muted'].every((role) => /^#[0-9A-F]{6}$/.test(palette.colors[role]))))
})

async function getFixtures() {
  if (fixtures) return fixtures
  const components = await allComponents()
  const grouped = new Map()
  for (const component of components) {
    const group = grouped.get(component.pattern) || []
    group.push(component)
    grouped.set(component.pattern, group)
  }
  const alternatives = [...grouped.values()].find((group) => group.length > 1)
  const failure = components.find((component) => component.isFailureWarning) || components[0]
  fixtures = { first: components[0], alternatives, failure }
  return fixtures
}

test('tool functions return structured measured answers', async () => {
  const { first, alternatives: group, failure } = await getFixtures()
  const calls = [
    ['find_component', { task: `${first.pattern} ${first.style}`, pattern: first.pattern }],
    ['check_component', { name: first.name }],
    ['alternatives', { name: group[0].name }],
    ['install_plan', { name: first.name }],
    ['skip_list', { pattern: failure.pattern }],
    ['palette_pick', { mood: 'light' }],
    ['find_template', { task: 'healthcare clinic landing page', category: 'industry' }],
    ['check_template', { name: 'landing-01' }],
    ['template_plan', { name: 'landing-01', palette: 'paper-coral' }],
  ]
  for (const [name, args] of calls) {
    const result = await runTool(name, args)
    assert.ok(result.text.length > 0, `${name} returned no text`)
    assert.ok(result.structuredContent, `${name} returned no structuredContent`)
  }
})

test('find_component never recommends a failed or warning entry as a best fit', async () => {
  const result = await runTool('find_component', {
    task: 'responsive pricing table for SaaS with accessible toggle',
    pattern: 'pricing',
  })
  assert.ok(result.structuredContent.matches.length > 0)
  assert.ok(result.structuredContent.matches.every((match) => match.measured.renders === true))
  assert.ok(result.structuredContent.matches.every((match) => match.failureWarning === false))
  assert.doesNotMatch(result.text, /✗RENDERS/)
})

test('bundled template catalog exposes complete public starters and adoption actions', async () => {
  assert.equal(await countTemplates(), 35)
  const templates = await allTemplates()
  assert.equal(templates.length, 35)
  assert.ok(templates.every((template) => template.previewUrl.startsWith('https://vibecodng.com/templates/')))
  const found = await runTool('find_template', { task: 'clinic healthcare doctors', category: 'industry' })
  assert.ok(found.structuredContent.matches.length > 0)
  assert.ok(found.structuredContent.matches.every((template) => template.a11y?.clean !== false))
  const plan = await runTool('template_plan', { name: 'landing-01', palette: 'paper-coral' })
  assert.match(plan.text, /npx degit mrkeyoor\/vibecodng-templates/)
  assert.equal(plan.structuredContent.plan.selectedPalette.name, 'paper-coral')
})

test('install_plan gives the agent an actionable review and source path', async () => {
  const components = await allComponents()
  const component = components.find((candidate) => candidate.sourceUrl) || components[0]
  const result = await runTool('install_plan', { name: component.name })
  assert.equal(result.structuredContent.plan.pageUrl, `https://vibecodng.com/components/${component.slug}/`)
  assert.equal(result.structuredContent.plan.sourceUrl, component.sourceUrl)
  assert.match(result.text, /Measured review: https:\/\/vibecodng\.com\/components\//)
  assert.match(result.text, /Source:/)
})

test('palette_pick returns matching palettes and find_component appends honest theming guidance', async () => {
  const picked = await runTool('palette_pick', { mood: 'light' })
  assert.ok(picked.structuredContent.palettes.length >= 1)
  assert.ok(picked.structuredContent.palettes.length <= 3)
  assert.ok(picked.structuredContent.palettes.every((palette) => palette.tags.includes('light')))
  assert.match(picked.text, /--bw-accent:/)

  const { first } = await getFixtures()
  const result = await runTool('find_component', {
    task: `${first.pattern} ${first.style}`,
    pattern: first.pattern,
    palette: 'paper-coral',
  })
  assert.equal(result.structuredContent.palette.name, 'paper-coral')
  assert.match(result.text, /--bw-surface: #FFF7F1;/)
  assert.match(result.text, /Automatic theming applies to first-party components; third-party entries need manual mapping\./)
})

test('every tool stays inside the 500-token text clamp', async () => {
  const { first, alternatives: group, failure } = await getFixtures()
  const args = {
    find_component: { task: `${first.pattern} ${first.style}`, pattern: first.pattern },
    check_component: { name: first.name },
    alternatives: { name: group[0].name },
    install_plan: { name: first.name },
    skip_list: { pattern: failure.pattern },
    palette_pick: { mood: 'retro' },
    find_template: { task: 'agency landing page', category: 'base' },
    check_template: { name: 'landing-01' },
    template_plan: { name: 'landing-01', palette: 'paper-coral' },
  }
  for (const tool of TOOLS) {
    const result = await runTool(tool.name, args[tool.name])
    assert.ok(estimateTokens(result.text) <= 500, `${tool.name} exceeded cap`)
  }
})

test('clamp cuts oversized text at or under the requested cap', () => {
  const result = clamp('A measured sentence. '.repeat(1000), 40)
  assert.ok(estimateTokens(result) <= 40)
})
