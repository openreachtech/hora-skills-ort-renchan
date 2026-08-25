import {
  fileURLToPath,
} from 'node:url'

import MarkdownDocumentCatalog from '../../tools/MarkdownDocumentCatalog.js'

/*
 * Markdown links inside kit/ are checked here because nothing else does: lint
 * never opens a .md file, and the name audit only compares directory names.
 * A section renamed without its links repointed therefore ships silently, and
 * has done — the change that added this test repaired 32 links already broken.
 *
 * dist/ is a verbatim copy made by the flatten build, so checking kit/ covers
 * what is published.
 */
describe('Documents under kit/', () => {
  describe('should hold no link that resolves to nothing', () => {
    const rootPath = fileURLToPath(new URL('../../../kit/', import.meta.url))

    const catalog = MarkdownDocumentCatalog.create({
      rootPath,
    })

    const cases = catalog.collectLinkingDocumentPaths()

    test.each(cases)('%s', documentPath => {
      const received = catalog.buildDocument({
        documentPath,
      })
        .collectBrokenLinkTargets()

      expect(received)
        .toEqual([])
    })
  })
})
