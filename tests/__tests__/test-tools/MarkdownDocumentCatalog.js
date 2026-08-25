import fs from 'node:fs'
import path from 'node:path'
import {
  fileURLToPath,
} from 'node:url'

import MarkdownDocumentCatalog from '../../tools/MarkdownDocumentCatalog.js'

import MarkdownDocument from '../../tools/MarkdownDocument.js'

describe('MarkdownDocumentCatalog', () => {
  describe('constructor', () => {
    describe('should keep property', () => {
      describe('#rootPath', () => {
        const cases = [
          {
            input: {
              rootPath: '/alpha/beta',
            },
            expected: '/alpha/beta',
          },
          {
            input: {
              rootPath: '/gamma',
            },
            expected: '/gamma',
          },
        ]

        test.each(cases)('rootPath: $input.rootPath', ({ input, expected }) => {
          const catalog = new MarkdownDocumentCatalog(input)

          expect(catalog)
            .toHaveProperty('rootPath', expected)
        })
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('.create()', () => {
    describe('should be an instance of own class', () => {
      const cases = [
        {
          input: {
            rootPath: '/alpha/beta',
          },
        },
        {
          input: {
            rootPath: '/gamma',
          },
        },
      ]

      test.each(cases)('rootPath: $input.rootPath', ({ input }) => {
        const received = MarkdownDocumentCatalog.create(input)

        expect(received)
          .toBeInstanceOf(MarkdownDocumentCatalog)
      })
    })

    describe('should call constructor', () => {
      const cases = [
        {
          tally: {
            rootPath: '/alpha/beta',
          },
        },
        {
          tally: {
            rootPath: '/gamma',
          },
        },
      ]

      test.each(cases)('rootPath: $tally.rootPath', ({ tally }) => {
        const SpyClass = constructorSpy.spyOn(MarkdownDocumentCatalog)

        SpyClass.create(tally)

        expect(SpyClass.__spy__)
          .toHaveBeenCalledWith(tally)
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('.get:MarkdownDocumentCtor', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const received = MarkdownDocumentCatalog.MarkdownDocumentCtor

        expect(received)
          .toBe(MarkdownDocument) // same reference
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('#get:Ctor', () => {
    describe('should be the constructor of the instance', () => {
      test('when instantiated as is', () => {
        const catalog = MarkdownDocumentCatalog.create({
          rootPath: '/alpha/beta',
        })

        const received = catalog.Ctor

        expect(received)
          .toBe(MarkdownDocumentCatalog) // same reference
      })

      test('when instantiated as a derived class', () => {
        class DerivedMarkdownDocumentCatalog extends MarkdownDocumentCatalog {}

        const catalog = DerivedMarkdownDocumentCatalog.create({
          rootPath: '/alpha/beta',
        })

        const received = catalog.Ctor

        expect(received)
          .toBe(DerivedMarkdownDocumentCatalog) // same reference
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('#get:fs', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const catalog = MarkdownDocumentCatalog.create({
          rootPath: '/alpha/beta',
        })

        const received = catalog.fs

        expect(received)
          .toBe(fs) // same reference
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('#get:path', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const catalog = MarkdownDocumentCatalog.create({
          rootPath: '/alpha/beta',
        })

        const received = catalog.path

        expect(received)
          .toBe(path) // same reference
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('#collectDocumentPaths()', () => {
    describe('should collect every Markdown document under the root', () => {
      const cases = [
        {
          input: {
            rootUrl: '../../fixtures/document-links/',
          },
          expected: [
            'alpha.md',
            'beta.md',
            'nested/gamma.md', // a document of a subdirectory is named in POSIX notation
          ],
        },
        {
          input: {
            rootUrl: '../../fixtures/document-links/nested/',
          },
          expected: [
            'gamma.md',
          ],
        },
      ]

      test.each(cases)('rootUrl: $input.rootUrl', ({ input, expected }) => {
        const rootPath = fileURLToPath(new URL(input.rootUrl, import.meta.url))

        const catalog = MarkdownDocumentCatalog.create({
          rootPath,
        })

        const received = catalog.collectDocumentPaths()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('#collectLinkingDocumentPaths()', () => {
    describe('should collect only the documents that hold a link', () => {
      const cases = [
        {
          input: {
            rootUrl: '../../fixtures/document-links/', // beta.md holds no link, so it is left out
          },
          expected: [
            'alpha.md',
            'nested/gamma.md',
          ],
        },
        {
          input: {
            rootUrl: '../../fixtures/document-links/nested/',
          },
          expected: [
            'gamma.md',
          ],
        },
      ]

      test.each(cases)('rootUrl: $input.rootUrl', ({ input, expected }) => {
        const rootPath = fileURLToPath(new URL(input.rootUrl, import.meta.url))

        const catalog = MarkdownDocumentCatalog.create({
          rootPath,
        })

        const received = catalog.collectLinkingDocumentPaths()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('MarkdownDocumentCatalog', () => {
  describe('#buildDocument()', () => {
    describe('should be an instance of the document class', () => {
      const cases = [
        {
          input: {
            documentPath: 'beta.md',
          },
        },
        {
          input: {
            documentPath: 'nested/gamma.md',
          },
        },
      ]

      test.each(cases)('documentPath: $input.documentPath', ({ input }) => {
        const rootPath = fileURLToPath(new URL('../../fixtures/document-links/', import.meta.url))

        const catalog = MarkdownDocumentCatalog.create({
          rootPath,
        })

        const received = catalog.buildDocument(input)

        expect(received)
          .toBeInstanceOf(MarkdownDocument)
      })
    })

    describe('should keep the path of the document', () => {
      const cases = [
        {
          input: {
            documentPath: 'beta.md',
          },
          expected: {
            fileUrl: '../../fixtures/document-links/beta.md',
          },
        },
        {
          input: {
            documentPath: 'nested/gamma.md',
          },
          expected: {
            fileUrl: '../../fixtures/document-links/nested/gamma.md',
          },
        },
      ]

      test.each(cases)('documentPath: $input.documentPath', ({ input, expected }) => {
        const rootPath = fileURLToPath(new URL('../../fixtures/document-links/', import.meta.url))

        const catalog = MarkdownDocumentCatalog.create({
          rootPath,
        })

        const received = catalog.buildDocument(input)

        expect(received)
          .toHaveProperty('filePath', fileURLToPath(new URL(expected.fileUrl, import.meta.url)))
      })
    })

    describe('should read the document off the disk', () => {
      const cases = [
        {
          input: {
            documentPath: 'beta.md',
          },
          expected: '# Beta\n\n## Existing heading\n\nBeta holds no link of its own.\n',
        },
        {
          input: {
            documentPath: 'nested/gamma.md',
          },
          expected: '# Gamma\n\n- [alpha](../alpha.md)\n',
        },
      ]

      test.each(cases)('documentPath: $input.documentPath', ({ input, expected }) => {
        const rootPath = fileURLToPath(new URL('../../fixtures/document-links/', import.meta.url))

        const catalog = MarkdownDocumentCatalog.create({
          rootPath,
        })

        const received = catalog.buildDocument(input)

        expect(received)
          .toHaveProperty('markdown', expected)
      })
    })
  })
})
