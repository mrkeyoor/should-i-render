// Bundled snapshot access. The stdio package never needs Mongo or the network.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'data',
  'components.json',
)
const DEFAULT_PALETTES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'data',
  'palettes.json',
)

let cache = null
let paletteCache = null

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

function loadPalettes() {
  if (paletteCache) return paletteCache
  let raw
  try {
    raw = fs.readFileSync(DEFAULT_PALETTES_PATH, 'utf8')
  } catch (error) {
    throw new Error(`cannot read palette data file at ${DEFAULT_PALETTES_PATH}: ${error.message}`)
  }
  try {
    paletteCache = JSON.parse(raw)
  } catch (error) {
    throw new Error(`cannot read palette data file at ${DEFAULT_PALETTES_PATH}: invalid JSON (${error.message})`)
  }
  if (!Array.isArray(paletteCache)) {
    throw new Error(`cannot read palette data file at ${DEFAULT_PALETTES_PATH}: expected a JSON array of palettes`)
  }
  return paletteCache
}

export async function allPalettes() {
  return loadPalettes()
}

export async function findPalette(name) {
  const target = slugify(name)
  return loadPalettes().find((palette) => palette.name === target) || null
}
