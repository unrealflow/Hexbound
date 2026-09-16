#!/usr/bin/env node
/**
 * Download art-reference JPEGs from refs/SOURCES.md (Steam CDN).
 * Runtime shaders never sample these files.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourcesPath = path.join(root, 'refs', 'SOURCES.md')
const refsDir = path.join(root, 'refs')
fs.mkdirSync(refsDir, { recursive: true })

const md = fs.readFileSync(sourcesPath, 'utf8')
const rowRe = /\|\s*`([^`]+\.jpg)`\s*\|\s*(https:\/\/[^|\s]+)\s*\|/g
let m
const jobs = []
while ((m = rowRe.exec(md))) {
  jobs.push({ name: m[1], url: m[2].trim() })
}

let ok = 0
for (const { name, url } of jobs) {
  const dest = path.join(refsDir, name)
  process.stdout.write(`fetch ${name} ... `)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      console.log(`FAIL ${res.status}`)
      continue
    }
    const buf = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(dest, buf)
    console.log(`${buf.length} bytes`)
    ok++
  } catch (e) {
    console.log(`ERR ${e.message}`)
  }
}
console.log(`done: ${ok}/${jobs.length}`)
if (ok === 0) process.exitCode = 1
