import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const sourceRoot = join(repoRoot, 'kit/skills')
const outputRoot = join(repoRoot, 'dist/skills')
const namePattern = /^hor-[a-z0-9-]{1,60}$/u

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
 * Read one child of kit/skills/.
 *
 * @param {import('node:fs').Dirent} dirent - Child of kit/skills/.
 * @returns {{folderName: string, absolutePath: string, isDirectory: boolean, hasSkillMd: boolean, name: string | null, nestedSkillMds: Array<string>}} The entry.
 */
function readSkillEntry (dirent) {
  const absolutePath = join(sourceRoot, dirent.name)

  if (!dirent.isDirectory()) {
    return {
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

const skillEntries = readdirSync(sourceRoot, { withFileTypes: true })
  .map(it => readSkillEntry(it))

const issues = [
  ...skillEntries
    .filter(it => !it.isDirectory)
    .map(it => `Not a skill directory: kit/skills/${it.folderName}`),

  ...skillEntries
    .filter(it => it.isDirectory && !it.hasSkillMd)
    .map(it => `No SKILL.md: kit/skills/${it.folderName}/`),

  ...skillEntries
    .flatMap(it => it.nestedSkillMds
      .map(nested => `Nested skill: kit/skills/${it.folderName}/${nested}`)),

  ...skillEntries
    .filter(it => it.isDirectory && !namePattern.test(it.folderName))
    .map(it => `Invalid folder name: kit/skills/${it.folderName}/`),

  ...skillEntries
    .filter(it => it.hasSkillMd && it.name === null)
    .map(it => `Missing name: kit/skills/${it.folderName}/SKILL.md`),

  ...skillEntries
    .filter(it => it.name !== null && it.name !== it.folderName)
    .map(it => `name: ${it.name} does not match its folder: kit/skills/${it.folderName}/`),
]

if (issues.length > 0) {
  const details = issues
    .map(it => `  - ${it}`)
    .join('\n')

  throw new Error(
    `Cannot build kit/skills:\n${details}\n`
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

process.stdout.write(`Copied ${skillEntries.length} skills into ${outputRoot}\n`)
