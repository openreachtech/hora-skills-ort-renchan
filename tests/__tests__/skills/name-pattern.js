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
 * The rule for a valid skill name is written out in both scripts on purpose, so
 * that neither skill's script has to import from the other's. This pins the two
 * copies to one another: changing the rule in one place alone fails here.
 */
describe('Skill name pattern', () => {
  describe('is declared identically by every script that enforces it', () => {
    const cases = [
      { scriptPath: '.claude/skills/audit/scripts/audit.js' },
      { scriptPath: '.claude/skills/flatten/scripts/build.js' },
    ]

    test.each(cases)('$scriptPath', ({ scriptPath }) => {
      const content = readFileSync(join(repoRoot, scriptPath), 'utf8')

      expect(content)
        .toContain('const namePattern = /^h[cbf]-[a-z0-9-]{1,61}$/u')
    })
  })
})
