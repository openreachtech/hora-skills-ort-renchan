import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const sourceRoot = join(repoRoot, 'kit/skills')
const namePattern = /^hor-[a-z0-9-]{1,60}$/u

/**
 * Every catalog the documents keep of the skills this package distributes.
 *
 * A catalog restates `kit/skills/` as a table, one row per skill. Each entry
 * names the file and what the catalog is called in a report.
 *
 * @returns {Array<{file: string, label: string}>} One entry per catalog.
 */
function catalogFiles () {
  return [
    { file: 'docs/skills.md', label: 'catalog' },
    { file: 'docs/skills.ja.md', label: 'catalog (ja)' },
  ]
}

/**
 * Compare one catalog's rows against the skills actually there.
 *
 * @param {{file: string, label: string}} catalog - Which catalog to read.
 * @param {Array<string>} folderNames - The skill folders under kit/skills/.
 * @returns {Array<string>} A report line per skill with no row, and per row naming no skill.
 */
function readCatalogedNames (
  catalog,
  folderNames
) {
  const absolutePath = join(repoRoot, catalog.file)

  if (!existsSync(absolutePath)) {
    return [
      `${catalog.file}  (${catalog.label} — file is missing)`,
    ]
  }

  const cataloged = Array.from(
    readFileSync(absolutePath, 'utf8')
      .matchAll(/^\| `([^`]+)` \|/gmu),
    it => it[1]
  )

  return [
    ...folderNames
      .filter(it => !cataloged.includes(it))
      .map(it => `${catalog.file}  (${catalog.label} — no row for ${it})`),
    ...cataloged
      .filter(it => !folderNames.includes(it))
      .map(it => `${catalog.file}  (${catalog.label} — a row for ${it}, which is not under kit/skills/)`),
  ]
}

/**
 * Read the `name:` value from a SKILL.md's frontmatter.
 *
 * @param {string} skillMdPath - Path to the SKILL.md to read.
 * @returns {string | null} The declared name, or null when absent or unparsable.
 */
function readSkillName (skillMdPath) {
  const content = readFileSync(skillMdPath, 'utf8')
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n/u)

  if (!frontmatterMatch) {
    return null
  }

  const nameMatch = frontmatterMatch[1].match(/^name:[ \t]*(.*)$/mu)

  if (!nameMatch) {
    return null
  }

  const value = nameMatch[1]
    .trim()
    .replace(/^(['"])([\s\S]*)\1$/u, '$2')
    .trim()

  return value === ''
    ? null
    : value
}

/**
 * Find every SKILL.md below a skill directory's own top level.
 *
 * @param {string} dir - Directory to search.
 * @param {Array<string>} segments - Path segments accumulated so far, relative to the skill directory.
 * @returns {Array<string>} Paths of nested SKILL.md files, relative to the skill directory.
 */
function findNestedSkillMds (
  dir,
  segments
) {
  return readdirSync(dir, { withFileTypes: true })
    .filter(it => it.isDirectory())
    .flatMap(it => {
      const entries = readdirSync(join(dir, it.name), { withFileTypes: true })
      const nested = entries.some(entry => entry.isFile() && entry.name === 'SKILL.md')
        ? [[...segments, it.name, 'SKILL.md'].join('/')]
        : []

      return [
        ...nested,
        ...findNestedSkillMds(join(dir, it.name), [...segments, it.name]),
      ]
    })
}

/**
 * Read one entry directly under kit/skills/.
 *
 * @param {import('node:fs').Dirent} dirent - Child of kit/skills/.
 * @returns {{folderName: string, path: string, isDirectory: boolean, hasSkillMd: boolean, name: string | null, nestedSkillMds: Array<string>}} The entry.
 */
function readSkillEntry (dirent) {
  const absolutePath = join(sourceRoot, dirent.name)
  const path = `kit/skills/${dirent.name}`

  if (!dirent.isDirectory()) {
    return {
      folderName: dirent.name,
      path,
      isDirectory: false,
      hasSkillMd: false,
      name: null,
      nestedSkillMds: [],
    }
  }

  const hasSkillMd = readdirSync(absolutePath, { withFileTypes: true })
    .some(entry => entry.isFile() && entry.name === 'SKILL.md')

  return {
    folderName: dirent.name,
    path,
    isDirectory: true,
    hasSkillMd,
    name: hasSkillMd
      ? readSkillName(join(absolutePath, 'SKILL.md'))
      : null,
    nestedSkillMds: findNestedSkillMds(absolutePath, []),
  }
}

const skillEntries = readdirSync(sourceRoot, { withFileTypes: true })
  .map(it => readSkillEntry(it))

const presentSkillFolderNames = skillEntries
  .filter(it => it.hasSkillMd)
  .map(it => it.folderName)

const problemGroups = [
  {
    heading: 'Not a skill directory',
    lines: skillEntries
      .filter(it => !it.isDirectory)
      .map(it => it.path),
  },
  {
    heading: 'No SKILL.md',
    lines: skillEntries
      .filter(it => it.isDirectory && !it.hasSkillMd)
      .map(it => `${it.path}/`),
  },
  {
    heading: 'Nested skill below a skill directory',
    lines: skillEntries
      .flatMap(it => it.nestedSkillMds.map(nested => `${it.path}/${nested}`)),
  },
  {
    heading: `Folder name is not ${namePattern.source}`,
    lines: skillEntries
      .filter(it => it.isDirectory && !namePattern.test(it.folderName))
      .map(it => `${it.path}/`),
  },
  {
    heading: 'Missing name:',
    lines: skillEntries
      .filter(it => it.hasSkillMd && it.name === null)
      .map(it => `${it.path}/SKILL.md`),
  },
  {
    heading: 'Catalog rows do not match what is under kit/skills/',
    lines: catalogFiles()
      .flatMap(it => readCatalogedNames(it, presentSkillFolderNames)),
  },
  {
    heading: 'name: does not match the folder name',
    lines: skillEntries
      .filter(it => it.name !== null && it.name !== it.folderName)
      .map(it => `${it.path}/SKILL.md  (declares ${it.name})`),
  },
]
  .filter(it => it.lines.length > 0)

process.stdout.write(`Checked ${skillEntries.length} skills under kit/skills/\n`)

problemGroups.forEach(({ heading, lines }) => {
  process.stdout.write(`\n${heading}: ${lines.length}\n\n`)

  lines.forEach(line => {
    process.stdout.write(`    ${line}\n`)
  })
})

if (problemGroups.length === 0) {
  process.stdout.write(
    'Every skill sits directly under kit/skills/ and declares a name: equal to its folder name\n'
  )
}

process.exit(
  problemGroups.length > 0
    ? 1
    : 0
)
