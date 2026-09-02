import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const sourceRoot = join(repoRoot, 'kit/skills')
const namePattern = /^ho[crf]-[a-z0-9-]{1,60}$/u

const DOMAIN_PREFIX = {
  backend: 'hor',
}

/**
 * Every place a document states how many skills this package distributes.
 *
 * A count is a fact about `kit/skills/`, restated in prose. Each entry names
 * the file, a pattern whose one capture group is the stated number, and what
 * the place is called in a report.
 *
 * @returns {Array<{file: string, pattern: RegExp, label: string}>} One entry per place.
 */
function countedPlaces () {
  return [
    { file: 'docs/skills.md', pattern: /— (\d+) in total —/u, label: 'catalog heading' },
    { file: 'docs/skills.ja.md', pattern: /全 ?(\d+) ?スキル|全スキル\((\d+) 件\)/u, label: 'catalog heading (ja)' },
    { file: 'README.md', pattern: /^(\d+) skills are distributed/mu, label: 'README opening' },
    { file: 'README.ja.md', pattern: /^配布されるスキルは (\d+) 件/mu, label: 'README opening (ja)' },
    { file: 'README.md', pattern: /\(this one\) \| `[a-z]{3}-` \| `[a-z]+` \| (\d+) \|/u, label: 'package table, own row' },
    { file: 'README.ja.md', pattern: /\(このパッケージ\) \| `[a-z]{3}-` \| `[a-z]+` \| (\d+) \|/u, label: 'package table, own row (ja)' },
  ]
}

/**
 * Compare one stated count against the skills actually counted.
 *
 * @param {{file: string, pattern: RegExp, label: string}} place - Where the count is stated.
 * @param {number} counted - How many skills sit under kit/skills/.
 * @returns {string | null} A report line when the two disagree or the place is gone, else null.
 */
function readStatedCount (
  place,
  counted
) {
  const absolutePath = join(repoRoot, place.file)

  if (!existsSync(absolutePath)) {
    return `${place.file}  (${place.label} — file is missing)`
  }

  const match = readFileSync(absolutePath, 'utf8')
    .match(place.pattern)

  if (!match) {
    return `${place.file}  (${place.label} — no count found where one is expected)`
  }

  const stated = Number(
    match
      .slice(1)
      .find(it => typeof it === 'string')
  )

  return stated === counted
    ? null
    : `${place.file}  (${place.label} — states ${stated}, counted ${counted})`
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
 * Read one entry of a domain directory.
 *
 * @param {string} domain - Domain directory name directly under kit/skills/ (e.g. 'core').
 * @param {import('node:fs').Dirent} dirent - Child of the domain directory.
 * @returns {{domain: string, folderName: string, path: string, isDirectory: boolean, hasSkillMd: boolean, name: string | null, nestedSkillMds: Array<string>}} The entry.
 */
function readDomainEntry (
  domain,
  dirent
) {
  const absolutePath = join(sourceRoot, domain, dirent.name)
  const path = `kit/skills/${domain}/${dirent.name}`

  if (!dirent.isDirectory()) {
    return {
      domain,
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
    domain,
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

/**
 * Read every entry of one domain directory.
 *
 * @param {string} domain - Domain directory name directly under kit/skills/ (e.g. 'core').
 * @returns {Array<{domain: string, folderName: string, path: string, isDirectory: boolean, hasSkillMd: boolean, name: string | null, nestedSkillMds: Array<string>}>} One entry per child of the domain directory.
 */
function readDomainEntries (domain) {
  return readdirSync(join(sourceRoot, domain), { withFileTypes: true })
    .map(it => readDomainEntry(domain, it))
}

const domains = Object.keys(DOMAIN_PREFIX)

const missingDomains = domains.filter(it => !existsSync(join(sourceRoot, it)))

const unexpectedRootEntries = readdirSync(sourceRoot, { withFileTypes: true })
  .filter(it => !(it.isDirectory() && domains.includes(it.name)))
  .map(it => `kit/skills/${it.name}`)

const skillEntries = domains
  .filter(it => !missingDomains.includes(it))
  .flatMap(it => readDomainEntries(it))

const problemGroups = [
  {
    heading: 'Missing domain directory',
    lines: missingDomains.map(it => `kit/skills/${it}/`),
  },
  {
    heading: 'Not the backend domain directory',
    lines: unexpectedRootEntries,
  },
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
    heading: 'Prefix does not match the domain',
    lines: skillEntries
      .filter(it =>
        it.isDirectory
        && namePattern.test(it.folderName)
        && !it.folderName.startsWith(`${DOMAIN_PREFIX[it.domain]}-`))
      .map(it => `${it.path}/  (expected ${DOMAIN_PREFIX[it.domain]}-)`),
  },
  {
    heading: 'Missing name:',
    lines: skillEntries
      .filter(it => it.hasSkillMd && it.name === null)
      .map(it => `${it.path}/SKILL.md`),
  },
  {
    heading: 'Stated skill count does not match what is under kit/skills/',
    lines: countedPlaces()
      .map(it => readStatedCount(it, skillEntries.filter(entry => entry.hasSkillMd).length))
      .filter(it => it !== null),
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
    'Every skill sits one level under its domain and declares a name: equal to its folder name\n'
  )
}

process.exit(
  problemGroups.length > 0
    ? 1
    : 0
)
