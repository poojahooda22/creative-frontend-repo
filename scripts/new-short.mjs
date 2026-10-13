// Creates shorts/<date>-<slug>/ from the template and logs it in context/shorts.md.
// Usage: pnpm run new-short <slug> ["one-line concept"] [--date YYYY-MM-DD]
import { appendFileSync, cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const templateDir = join(root, 'templates', 'short-vite-three')
const logFile = join(root, 'context', 'shorts.md')
const filesWithPlaceholders = ['package.json', 'index.html', 'SHORT.md']

function fail(message) {
  console.error(`new-short: ${message}`)
  process.exit(1)
}

// Local calendar date, not UTC, so a short started late evening keeps today's date.
function localDate() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const args = process.argv.slice(2)
let date = localDate()
const dateFlag = args.indexOf('--date')
if (dateFlag !== -1) {
  date = args[dateFlag + 1] ?? ''
  args.splice(dateFlag, 2)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date must be YYYY-MM-DD, got "${date}"`)
}

const [slug, concept = ''] = args
if (!slug) fail('usage: pnpm run new-short <slug> ["one-line concept"] [--date YYYY-MM-DD]')
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) fail(`slug must be kebab-case (a-z, 0-9, hyphens), got "${slug}"`)
if (!existsSync(templateDir)) fail(`template not found at ${templateDir}`)
if (!existsSync(logFile)) fail(`log not found at ${logFile}`)

const name = `${date}-${slug}`
const target = join(root, 'shorts', name)
if (existsSync(target)) fail(`shorts/${name} already exists`)

const title = slug
  .split('-')
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join(' ')
const values = { __NAME__: name, __TITLE__: title, __DATE__: date, __CONCEPT__: concept || 'TBD' }

cpSync(templateDir, target, { recursive: true })
for (const file of filesWithPlaceholders) {
  const path = join(target, file)
  let text = readFileSync(path, 'utf8')
  for (const [key, value] of Object.entries(values)) text = text.replaceAll(key, value)
  writeFileSync(path, text)
}

const cell = (text) => text.replaceAll('|', '\\|')
appendFileSync(logFile, `| ${date} | [${slug}](../shorts/${name}/SHORT.md) | ${cell(concept)} |  |  |\n`)

console.log(`Created shorts/${name}`)
console.log(`Next: pnpm install, then pnpm --filter ./shorts/${name} dev`)
