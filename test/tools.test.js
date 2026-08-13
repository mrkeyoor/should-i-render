import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allComponents, countComponents } from '../data.js'
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
  assert.equal(definitions.length, 5)
  for (const tool of definitions) {
    assert.ok(tool.title)
    assert.equal(tool.annotations.readOnlyHint, true)
    assert.ok(tool.outputSchema)
    assert.equal('handler' in tool, false)
  }
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
  ]
  for (const [name, args] of calls) {
    const result = await runTool(name, args)
    assert.ok(result.text.length > 0, `${name} returned no text`)
    assert.ok(result.structuredContent, `${name} returned no structuredContent`)
  }
})

test('every tool stays inside the 500-token text clamp', async () => {
  const { first, alternatives: group, failure } = await getFixtures()
  const args = {
    find_component: { task: `${first.pattern} ${first.style}`, pattern: first.pattern },
    check_component: { name: first.name },
    alternatives: { name: group[0].name },
    install_plan: { name: first.name },
    skip_list: { pattern: failure.pattern },
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
