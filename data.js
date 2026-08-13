// Bundled snapshot access. The stdio package never needs Mongo or the network.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'data',
  'components.json',
)

let cache = null

function load() {
  if (cache) return cache
  const file = process.env.SHOULD_I_RENDER_DATA || DEFAULT_PATH
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new Error(`cannot read data file at ${file}: ${error.message}`)
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`cannot read data file at ${file}: invalid JSON (${error.message})`)
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`cannot read data file at ${file}: expected a JSON array of components`)
  }
  cache = parsed
  return cache
}

export function slugify(value) {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export async function allComponents({ pattern, style } = {}) {
  const patternFilter = pattern ? String(pattern).toLowerCase() : null
  const styleFilter = style ? String(style).toLowerCase() : null
  return load().filter((component) =>
    (!patternFilter || String(component.pattern).toLowerCase() === patternFilter) &&
    (!styleFilter || String(component.style).toLowerCase() === styleFilter)
  )
}

export async function findByName(name) {
  const target = String(name || '').toLowerCase()
  const slug = slugify(name)
  return load().find((component) =>
    component.slug === slug || String(component.name).toLowerCase() === target
  ) || null
}

export async function countComponents() {
  return load().length
}
