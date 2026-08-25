import fs from 'node:fs'
import path from 'node:path'
import {
  fileURLToPath,
} from 'node:url'

import MarkdownDocument from '../../tools/MarkdownDocument.js'

describe('MarkdownDocument', () => {
  describe('constructor', () => {
    describe('should keep property', () => {
      describe('#filePath', () => {
        const cases = [
          {
            input: {
              filePath: '/alpha/beta.md',
              markdown: '# Beta\n',
            },
            expected: '/alpha/beta.md',
          },
          {
            input: {
              filePath: '/gamma/delta/epsilon.md',
              markdown: '# Epsilon\n',
            },
            expected: '/gamma/delta/epsilon.md',
          },
        ]

        test.each(cases)('filePath: $input.filePath', ({ input, expected }) => {
          const markdownDocument = new MarkdownDocument(input)

          expect(markdownDocument)
            .toHaveProperty('filePath', expected)
        })
      })

      describe('#markdown', () => {
        const cases = [
          {
            input: {
              filePath: '/alpha/beta.md',
              markdown: '# Beta\n',
            },
            expected: '# Beta\n',
          },
          {
            input: {
              filePath: '/alpha/beta.md',
              markdown: '# Beta\n\n[gamma](./gamma.md)\n',
            },
            expected: '# Beta\n\n[gamma](./gamma.md)\n',
          },
          {
            input: {
              filePath: '/alpha/beta.md',
              markdown: '',
            },
            expected: '',
          },
        ]

        test.each(cases)('markdown: $input.markdown', ({ input, expected }) => {
          const markdownDocument = new MarkdownDocument(input)

          expect(markdownDocument)
            .toHaveProperty('markdown', expected)
        })
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('.create()', () => {
    describe('should be an instance of own class', () => {
      const cases = [
        {
          input: {
            filePath: '/alpha/beta.md',
            markdown: '# Beta\n',
          },
        },
        {
          input: {
            filePath: '/gamma/delta.md',
            markdown: '',
          },
        },
      ]

      test.each(cases)('filePath: $input.filePath', ({ input }) => {
        const received = MarkdownDocument.create(input)

        expect(received)
          .toBeInstanceOf(MarkdownDocument)
      })
    })

    describe('should call constructor', () => {
      const cases = [
        {
          tally: {
            filePath: '/alpha/beta.md',
            markdown: '# Beta\n',
          },
        },
        {
          tally: {
            filePath: '/gamma/delta.md',
            markdown: '# Delta\n',
          },
        },
      ]

      test.each(cases)('filePath: $tally.filePath', ({ tally }) => {
        const SpyClass = constructorSpy.spyOn(MarkdownDocument)

        SpyClass.create(tally)

        expect(SpyClass.__spy__)
          .toHaveBeenCalledWith(tally)
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('.buildSlug()', () => {
    describe('should build the anchor slug of the heading', () => {
      const cases = [
        {
          input: {
            heading: 'Alpha',
          },
          expected: 'alpha',
        },
        {
          input: {
            heading: 'Alpha Beta Gamma',
          },
          expected: 'alpha-beta-gamma',
        },
        {
          input: {
            heading: 'describe() Structure',
          },
          expected: 'describe-structure',
        },
        {
          input: {
            heading: '1. Placement & execution order', // a run of spaces is left uncollapsed
          },
          expected: '1-placement--execution-order',
        },
        {
          input: {
            heading: 'Write any as `*`', // the tail is left untrimmed
          },
          expected: 'write-any-as-',
        },
        {
          input: {
            heading: 'snake_case and dash-case', // `_` and `-` survive
          },
          expected: 'snake_case-and-dash-case',
        },
        {
          input: {
            heading: '日本語の見出し', // a letter of any script survives
          },
          expected: '日本語の見出し',
        },
      ]

      test.each(cases)('heading: $input.heading', ({ input, expected }) => {
        const received = MarkdownDocument.buildSlug(input)

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#get:Ctor', () => {
    describe('should be the constructor of the instance', () => {
      test('when instantiated as is', () => {
        const markdownDocument = MarkdownDocument.create({
          filePath: '/alpha/beta.md',
          markdown: '# Beta\n',
        })

        const received = markdownDocument.Ctor

        expect(received)
          .toBe(MarkdownDocument) // same reference
      })

      test('when instantiated as a derived class', () => {
        class DerivedMarkdownDocument extends MarkdownDocument {}

        const markdownDocument = DerivedMarkdownDocument.create({
          filePath: '/alpha/beta.md',
          markdown: '# Beta\n',
        })

        const received = markdownDocument.Ctor

        expect(received)
          .toBe(DerivedMarkdownDocument) // same reference
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#get:fs', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const markdownDocument = MarkdownDocument.create({
          filePath: '/alpha/beta.md',
          markdown: '# Beta\n',
        })

        const received = markdownDocument.fs

        expect(received)
          .toBe(fs) // same reference
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#get:path', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const markdownDocument = MarkdownDocument.create({
          filePath: '/alpha/beta.md',
          markdown: '# Beta\n',
        })

        const received = markdownDocument.path

        expect(received)
          .toBe(path) // same reference
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#buildTextOutsideFencedCode()', () => {
    describe('should drop the fenced code blocks', () => {
      const cases = [
        {
          input: {
            markdown: '# Alpha\n\n[beta](./beta.md)\n', // no fence at all
          },
          expected: '# Alpha\n\n[beta](./beta.md)\n',
        },
        {
          input: {
            markdown: '[alpha](./alpha.md)\n\n```md\n[beta](./beta.md)\n```\n',
          },
          expected: '[alpha](./alpha.md)\n\n\n',
        },
        {
          input: {
            markdown: '# Alpha\n\n```\n# Beta\n```\n', // a heading inside a fence goes too
          },
          expected: '# Alpha\n\n\n',
        },
        {
          input: {
            markdown: '```\n[alpha](./alpha.md)\n```\n\n[beta](./beta.md)\n\n```\n[gamma](./gamma.md)\n```\n',
          },
          expected: '\n\n[beta](./beta.md)\n\n\n',
        },
        {
          input: {
            markdown: '',
          },
          expected: '',
        },
      ]

      test.each(cases)('markdown: $input.markdown', ({ input, expected }) => {
        const markdownDocument = MarkdownDocument.create({
          filePath: '/alpha/beta.md', // neutral value; not under test
          markdown: input.markdown,
        })

        const received = markdownDocument.buildTextOutsideFencedCode()

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#collectHeadingSlugs()', () => {
    describe('should collect the slug of every heading', () => {
      const cases = [
        {
          input: {
            markdown: '# Alpha\n',
          },
          expected: [
            'alpha',
          ],
        },
        {
          input: {
            markdown: '# Alpha\n\n## Beta heading\n\n###### Gamma\n',
          },
          expected: [
            'alpha',
            'beta-heading',
            'gamma',
          ],
        },
        {
          input: {
            markdown: '# Alpha   \n', // the trailing run of spaces is not part of the heading
          },
          expected: [
            'alpha',
          ],
        },
        {
          input: {
            markdown: '# Alpha\n\n```\n# Beta\n```\n', // a heading inside a fence offers no anchor
          },
          expected: [
            'alpha',
          ],
        },
        {
          input: {
            markdown: '#NoSpace\n', // a hash run without a space is not a heading
          },
          expected: [],
        },
        {
          input: {
            markdown: 'Alpha holds no heading.\n',
          },
          expected: [],
        },
      ]

      test.each(cases)('markdown: $input.markdown', ({ input, expected }) => {
        const markdownDocument = MarkdownDocument.create({
          filePath: '/alpha/beta.md', // neutral value; not under test
          markdown: input.markdown,
        })

        const received = markdownDocument.collectHeadingSlugs()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#collectLinkTargets()', () => {
    describe('should collect the targets that must resolve in this repository', () => {
      const cases = [
        {
          input: {
            markdown: '[alpha](./alpha.md)\n',
          },
          expected: [
            './alpha.md',
          ],
        },
        {
          input: {
            markdown: '[alpha](./alpha.md#beta)\n[gamma](#delta)\n',
          },
          expected: [
            './alpha.md#beta',
            '#delta',
          ],
        },
        {
          input: {
            markdown: '[alpha](./alpha.md)\n\n```\n[beta](./beta.md)\n```\n', // a target inside a fence is an example
          },
          expected: [
            './alpha.md',
          ],
        },
        {
          input: {
            markdown: 'Alpha holds no link.\n',
          },
          expected: [],
        },
      ]

      test.each(cases)('markdown: $input.markdown', ({ input, expected }) => {
        const markdownDocument = MarkdownDocument.create({
          filePath: '/alpha/beta.md', // neutral value; not under test
          markdown: input.markdown,
        })

        const received = markdownDocument.collectLinkTargets()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should exclude the targets outside this repository', () => {
      const cases = [
        {
          input: {
            markdown: '[alpha](https://example.com/alpha)\n',
          },
        },
        {
          input: {
            markdown: '[alpha](http://example.com/alpha)\n',
          },
        },
        {
          input: {
            markdown: '[alpha](mailto:alpha@example.com)\n',
          },
        },
      ]

      test.each(cases)('markdown: $input.markdown', ({ input }) => {
        const markdownDocument = MarkdownDocument.create({
          filePath: '/alpha/beta.md', // neutral value; not under test
          markdown: input.markdown,
        })

        const received = markdownDocument.collectLinkTargets()

        expect(received)
          .toEqual([])
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#resolvesLinkTarget()', () => {
    const filePath = fileURLToPath(new URL('../../fixtures/document-links/alpha.md', import.meta.url))

    const markdown = '# Alpha\n\n## Existing heading\n'

    describe('should resolve the target', () => {
      const cases = [
        {
          input: {
            target: '#existing-heading', // a heading of the linking document itself
          },
        },
        {
          input: {
            target: './beta.md',
          },
        },
        {
          input: {
            target: './beta.md#existing-heading',
          },
        },
        {
          input: {
            target: './nested/gamma.md#gamma',
          },
        },
        {
          input: {
            target: '../document-links/beta.md',
          },
        },
        {
          input: {
            target: './delta.txt#anything', // no heading is read out of a file that is not Markdown
          },
        },
      ]

      test.each(cases)('target: $input.target', ({ input }) => {
        const markdownDocument = MarkdownDocument.create({
          filePath,
          markdown,
        })

        const received = markdownDocument.resolvesLinkTarget(input)

        expect(received)
          .toBe(true)
      })
    })

    describe('should not resolve the target', () => {
      const cases = [
        {
          input: {
            target: '#missing-heading',
          },
        },
        {
          input: {
            target: './missing.md',
          },
        },
        {
          input: {
            target: './beta.md#missing-heading',
          },
        },
        {
          input: {
            target: '../missing-directory/beta.md',
          },
        },
      ]

      test.each(cases)('target: $input.target', ({ input }) => {
        const markdownDocument = MarkdownDocument.create({
          filePath,
          markdown,
        })

        const received = markdownDocument.resolvesLinkTarget(input)

        expect(received)
          .toBe(false)
      })
    })
  })
})

describe('MarkdownDocument', () => {
  describe('#collectBrokenLinkTargets()', () => {
    describe('should collect the targets that resolve to nothing', () => {
      const cases = [
        {
          input: {
            markdown: '# Alpha\n\n## Existing heading\n\n[alpha](#existing-heading)\n[beta](#missing-heading)\n',
          },
          expected: [
            '#missing-heading',
          ],
        },
        {
          input: {
            markdown: '[alpha](./beta.md)\n[gamma](./missing.md)\n',
          },
          expected: [
            './missing.md',
          ],
        },
        {
          input: {
            markdown: '[alpha](./beta.md#existing-heading)\n[gamma](./beta.md#missing-heading)\n',
          },
          expected: [
            './beta.md#missing-heading',
          ],
        },
        {
          input: {
            markdown: '[alpha](./beta.md)\n[gamma](https://example.com/gamma)\n',
          },
          expected: [],
        },
        {
          input: {
            markdown: 'Alpha holds no link.\n',
          },
          expected: [],
        },
      ]

      test.each(cases)('markdown: $input.markdown', ({ input, expected }) => {
        const filePath = fileURLToPath(new URL('../../fixtures/document-links/alpha.md', import.meta.url))

        const markdownDocument = MarkdownDocument.create({
          filePath,
          markdown: input.markdown,
        })

        const received = markdownDocument.collectBrokenLinkTargets()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})
