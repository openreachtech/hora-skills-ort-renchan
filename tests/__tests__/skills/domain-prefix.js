import {
  readFileSync,
} from 'node:fs'
import {
  join,
} from 'node:path'
import {
  fileURLToPath,
} from 'node:url'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

/*
 * Which prefix belongs to this library's domain is written out in both maintenance
 * scripts on purpose, so that neither script has to import from the other. This pins
 * the two copies to one another: changing the table in one place alone fails here.
 */
describe('Skill domain prefix table', () => {
  describe('is declared identically by every script that enforces it', () => {
    const cases = [
      { scriptPath: '.claude/skills/audit/scripts/audit.js' },
      { scriptPath: '.claude/skills/flatten/scripts/build.js' },
    ]

    test.each(cases)('$scriptPath', ({ scriptPath }) => {
      const content = readFileSync(join(repoRoot, scriptPath), 'utf8')

      expect(content)
        .toContain("const DOMAIN_PREFIX = {\n  backend: 'hor',\n}")
    })
  })
})
