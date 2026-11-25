#!/usr/bin/env node
import { fileURLToPath } from 'node:url'
import path from 'node:path'
// Validates .pen files inside /design:
//   node design/scripts/check-pen-refs.mjs
//   node design/scripts/check-pen-refs.mjs --unused
//
// Rules:
//   - every local `url` resolves to an existing file inside /design
//   - every `imports` entry resolves to an existing .pen file inside /design
//   - every component instance ("ref") resolves to a reusable node in the file or an imported library
//   - --unused also flags unreferenced assets, shader layers, loose unnamed image rectangles, and duplicate board names
import fs from 'node:fs'

const designRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const checkUnused = args.includes('--unused')
const wanted = args.filter(a => !a.startsWith('--'))
const knownPath = path.join(designRoot, 'scripts/known-missing.json')
const known = fs.existsSync(knownPath) ? JSON.parse(fs.readFileSync(knownPath, 'utf8')) : []
const knownKey = new Set(known.map(k => `${k.pen}\u0000${k.url ?? `ref:${k.ref}`}`))

const ignoredDirs = new Set(['.git', 'node_modules', 'scripts', 'exports'])
const topDirs = fs
  .readdirSync(designRoot, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('.') && !ignoredDirs.has(d.name))
  .map(d => d.name)

for (const w of wanted) {
  if (!topDirs.includes(w)) {
    console.error(`unknown directory "${w}" (have: ${topDirs.join(', ')})`)
    process.exit(2)
  }
}
const dirs = wanted.length ? [...new Set(['foundation', ...wanted])].filter(d => topDirs.includes(d)) : topDirs

const walkFiles = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walkFiles(p) : [p]
  })
const rel = p => path.relative(designRoot, p).split(path.sep).join('/')
const insideRoot = p => !path.relative(designRoot, p).startsWith('..')
const decode = (u) => {
  try {
    return decodeURIComponent(u)
  } catch {
    return u
  }
}

const errors = []
const warnings = []
const referenced = new Set()
const penDocs = new Map()
let pens = 0
let urls = 0

for (const dir of dirs) {
  const dirPath = path.join(designRoot, dir)
  if (!fs.existsSync(dirPath)) continue
  for (const file of walkFiles(dirPath).filter(f => f.endsWith('.pen'))) {
    pens++
    let doc
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch (e) {
      errors.push(`${rel(file)}: not valid JSON (${e.message})`)
      continue
    }
    const check = (kind, value) => {
      const target = path.resolve(path.dirname(file), decode(value))
      const ok = insideRoot(target) && fs.existsSync(target) && fs.statSync(target).isFile()
      if (ok) {
        referenced.add(target)
        return
      }
      const msg = `${rel(file)}: ${kind} "${value}" ${insideRoot(target) ? 'does not exist' : 'points outside design/'}`
      ;(knownKey.has(`${rel(file)}\u0000${value}`) ? warnings : errors).push(msg)
    }
    for (const [alias, value] of Object.entries(doc.imports ?? {})) check(`import "${alias}"`, value)
    const walk = (o) => {
      if (Array.isArray(o)) return o.forEach(walk)
      if (!o || typeof o !== 'object') return
      for (const [k, v] of Object.entries(o)) {
        if (k === 'url' && typeof v === 'string') {
          if (v && o.type !== 'browser' && !/^(https?|data):/i.test(v)) {
            urls++
            check('url', v)
          }
        } else if (k !== 'imports') {
          walk(v)
        }
      }
    }
    walk(doc)

    const local = new Set()
    const collect = (o, prefix, into) => {
      if (Array.isArray(o)) return o.forEach(x => collect(x, prefix, into))
      if (!o || typeof o !== 'object') return
      if (o.reusable && o.id) into.add(prefix + o.id)
      for (const v of Object.values(o)) collect(v, prefix, into)
    }
    collect(doc.children, '', local)
    for (const [alias, value] of Object.entries(doc.imports ?? {})) {
      const target = path.resolve(path.dirname(file), decode(value))
      if (fs.existsSync(target)) {
        collect(JSON.parse(fs.readFileSync(target, 'utf8')).children, `${alias}:`, local)
      }
    }
    const missingRefs = new Map()
    const refs = (o) => {
      if (Array.isArray(o)) return o.forEach(refs)
      if (!o || typeof o !== 'object') return
      if (o.type === 'ref' && typeof o.ref === 'string' && !local.has(o.ref)) {
        missingRefs.set(o.ref, (missingRefs.get(o.ref) ?? 0) + 1)
      }
      for (const v of Object.values(o)) refs(v)
    }
    refs(doc.children)
    for (const [ref, n] of missingRefs) {
      const msg = `${rel(file)}: ${n} instance(s) of missing component "${ref}"`
      ;(knownKey.has(`${rel(file)}\u0000ref:${ref}`) ? warnings : errors).push(msg)
    }

    if (checkUnused) {
      const stray = (o) => {
        if (Array.isArray(o)) return o.forEach(stray)
        if (!o || typeof o !== 'object') return
        for (const v of Object.values(o)) {
          for (const layer of Array.isArray(v) ? v : [v]) {
            if (layer && layer.type === 'shader') {
              errors.push(`${rel(file)}: node ${o.id ?? '?'} has a shader fill layer (${layer.url})`)
            }
          }
        }
        for (const v of Object.values(o)) stray(v)
      }
      stray(doc.children)
      for (const top of doc.children ?? []) {
        if (!top.name && top.type === 'rectangle' && JSON.stringify(top.fill ?? '').includes('"image"')) {
          errors.push(`${rel(file)}: loose screenshot ${top.id} on the canvas`)
        }
      }
      penDocs.set(file, doc)
    }
  }
}

if (checkUnused) {
  for (const [file, doc] of penDocs) {
    for (const value of Object.values(doc.imports ?? {})) {
      const libPath = path.resolve(path.dirname(file), decode(value))
      const lib = penDocs.get(libPath)
      if (!lib) continue
      const names = new Set((doc.children ?? []).map(b => b.name).filter(Boolean))
      for (const b of lib.children ?? []) {
        if (names.has(b.name)) {
          errors.push(`${rel(libPath)}: board "${b.name}" (${b.id}) duplicates a board in ${rel(file)}`)
        }
      }
    }
  }
  for (const dir of dirs) {
    const assets = path.join(designRoot, dir, 'assets')
    if (!fs.existsSync(assets)) continue
    for (const f of walkFiles(assets)) {
      if (!referenced.has(f) && path.basename(f) !== '.gitkeep') {
        errors.push(`${rel(f)}: no .pen file references it`)
      }
    }
  }
}

for (const w of warnings) console.warn(`warn  ${w}`)
for (const e of errors) console.error(`error ${e}`)
console.log(`${dirs.join(', ')}: ${pens} .pen files, ${urls} local urls, ${errors.length} errors, ${warnings.length} known-missing`)
process.exit(errors.length ? 1 : 0)
