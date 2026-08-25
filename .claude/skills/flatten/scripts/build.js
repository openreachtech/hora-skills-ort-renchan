import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const sourceRoot = join(repoRoot, 'kit/skills')
const outputRoot = join(repoRoot, 'dist/skills')
const namePattern = /^h[cbf]-[a-z0-9-]{1,61}$/u

const DOMAIN_PREFIX = {
  backend: 'hb',
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
 * @param {string} dir - Directory to search, relative paths accumulated from it.
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
 * Read one child of a domain directory.
 *
 * @param {string} domain - Domain directory name directly under kit/skills/ (e.g. 'core').
 * @param {import('node:fs').Dirent} dirent - Child of the domain directory.
 * @returns {{domain: string, folderName: string, absolutePath: string, isDirectory: boolean, hasSkillMd: boolean, name: string | null, nestedSkillMds: Array<string>}} The entry.
 */
function readDomainEntry (
  domain,
  dirent
) {
  const absolutePath = join(sourceRoot, domain, dirent.name)

  if (!dirent.isDirectory()) {
    return {
      domain,
      folderName: dirent.name,
      absolutePath,
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
    absolutePath,
    isDirectory: true,
    hasSkillMd,
    name: hasSkillMd
      ? readSkillName(join(absolutePath, 'SKILL.md'))
      : null,
    nestedSkillMds: findNestedSkillMds(absolutePath, []),
  }
}

/**
 * Read every skill directory of one domain.
 *
 * @param {string} domain - Domain directory name directly under kit/skills/ (e.g. 'core').
 * @returns {Array<{domain: string, folderName: string, absolutePath: string, isDirectory: boolean, hasSkillMd: boolean, name: string | null, nestedSkillMds: Array<string>}>} One entry per child of the domain directory.
 */
function readDomainEntries (domain) {
  return readdirSync(join(sourceRoot, domain), { withFileTypes: true })
    .map(it => readDomainEntry(domain, it))
}

const domains = Object.keys(DOMAIN_PREFIX)

const missingDomains = domains.filter(it => !existsSync(join(sourceRoot, it)))

const unexpectedRootEntries = readdirSync(sourceRoot, { withFileTypes: true })
  .filter(it => !(it.isDirectory() && domains.includes(it.name)))
  .map(it => `Unexpected entry directly under kit/skills/: ${it.name}`)

const skillEntries = domains
  .filter(it => !missingDomains.includes(it))
  .flatMap(it => readDomainEntries(it))

const issues = [
  ...missingDomains.map(it => `Missing domain directory: kit/skills/${it}/`),

  ...unexpectedRootEntries,

  ...skillEntries
    .filter(it => !it.isDirectory)
    .map(it => `Not a skill directory: kit/skills/${it.domain}/${it.folderName}`),

  ...skillEntries
    .filter(it => it.isDirectory && !it.hasSkillMd)
    .map(it => `No SKILL.md: kit/skills/${it.domain}/${it.folderName}/`),

  ...skillEntries
    .flatMap(it => it.nestedSkillMds
      .map(nested => `Nested skill: kit/skills/${it.domain}/${it.folderName}/${nested}`)),

  ...skillEntries
    .filter(it => it.isDirectory && !namePattern.test(it.folderName))
    .map(it => `Invalid folder name: kit/skills/${it.domain}/${it.folderName}/`),

  ...skillEntries
    .filter(it =>
      it.isDirectory
      && namePattern.test(it.folderName)
      && !it.folderName.startsWith(`${DOMAIN_PREFIX[it.domain]}-`))
    .map(it => `Wrong prefix for ${it.domain}/ (expected ${DOMAIN_PREFIX[it.domain]}-): kit/skills/${it.domain}/${it.folderName}/`),

  ...skillEntries
    .filter(it => it.hasSkillMd && it.name === null)
    .map(it => `Missing name: kit/skills/${it.domain}/${it.folderName}/SKILL.md`),

  ...skillEntries
    .filter(it => it.name !== null && it.name !== it.folderName)
    .map(it => `name: ${it.name} does not match its folder: kit/skills/${it.domain}/${it.folderName}/`),
]

if (issues.length > 0) {
  const details = issues
    .map(it => `  - ${it}`)
    .join('\n')

  throw new Error(
    `Cannot flatten kit/skills:\n${details}\n`
  )
}

rmSync(outputRoot, { recursive: true, force: true })

mkdirSync(outputRoot, { recursive: true })

skillEntries.forEach(({ absolutePath, folderName }) => {
  cpSync(
    absolutePath,
    join(outputRoot, folderName),
    { recursive: true }
  )
})

process.stdout.write(`Flattened ${skillEntries.length} skills into ${outputRoot}\n`)
