import fs from 'node:fs'
import path from 'node:path'

/**
 * One Markdown document, and the links written in it.
 *
 * A link has two halves — the file it points at, and the heading inside that file —
 * and a document is sound only when both halves of every link resolve. The heading
 * half is matched against the anchor slug GitHub derives from the heading text.
 */
export default class MarkdownDocument {
  /**
   * Constructor.
   *
   * @param {{
   *   filePath: string
   *   markdown: string
   * }} params - Parameters.
   */
  constructor ({
    filePath,
    markdown,
  }) {
    this.filePath = filePath
    this.markdown = markdown
  }

  /**
   * Factory method.
   *
   * @template {X extends typeof MarkdownDocument ? X : never} T, X
   * @param {{
   *   filePath: string
   *   markdown: string
   * }} params - Parameters for the factory method.
   * @returns {InstanceType<T>} Instance of this class.
   * @this {T}
   * @public
   */
  static create ({
    filePath,
    markdown,
  }) {
    return new this({
      filePath,
      markdown,
    })
  }

  /**
   * Build the anchor slug GitHub gives a heading.
   *
   * Runs of spaces are **not** collapsed and the result is **not** trimmed:
   * `## 1. Placement & execution order` slugs to `1-placement--execution-order`,
   * and `` ## Write any as `*` `` to `write-any-as-`. Collapsing or trimming
   * reports links that are in fact correct as broken.
   *
   * @param {{
   *   heading: string
   * }} params - Parameters.
   * @returns {string} Anchor slug the heading offers.
   * @public
   */
  static buildSlug ({
    heading,
  }) {
    return heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N} _-]/gu, '')
      .replace(/ /gu, '-')
  }

  /**
   * Constructor of this instance.
   *
   * @returns {typeof MarkdownDocument} Constructor of this instance.
   */
  get Ctor () {
    return /** @type {typeof MarkdownDocument} */ (this.constructor)
  }

  /**
   * Node file system module.
   *
   * @returns {typeof fs} Node file system module.
   */
  get fs () {
    return fs
  }

  /**
   * Node path module.
   *
   * @returns {typeof path} Node path module.
   */
  get path () {
    return path
  }

  /**
   * Build the document text with its fenced code blocks dropped.
   *
   * A link shown as an example inside a fenced block points at nothing on purpose,
   * so it is never resolved.
   *
   * @returns {string} Document text outside fenced code blocks.
   * @public
   */
  buildTextOutsideFencedCode () {
    return this.markdown
      .replace(/^```[\s\S]*?^```/gmu, '')
  }

  /**
   * Collect the anchor slug of every heading this document offers.
   *
   * @returns {Array<string>} Slugs this document offers.
   * @public
   */
  collectHeadingSlugs () {
    const headings = this.buildTextOutsideFencedCode()
      .matchAll(/^#{1,6}\s+(.+?)\s*$/gmu)

    return [...headings]
      .map(([, heading]) => this.Ctor.buildSlug({
        heading,
      }))
  }

  /**
   * Collect every link target of this document that must resolve inside this repository.
   *
   * @returns {Array<string>} Targets as written, external URLs excluded.
   * @public
   */
  collectLinkTargets () {
    const links = this.buildTextOutsideFencedCode()
      .matchAll(/\[[^\]]*\]\(([^)\s]+)\)/gu)

    return [...links]
      .map(([, target]) => target)
      .filter(target => !/^(?:https?|mailto):/u.test(target))
  }

  /**
   * Tell whether one link target resolves to a file and a heading that exist.
   *
   * @param {{
   *   target: string
   * }} params - Parameters.
   * @returns {boolean} Whether the target resolves.
   * @public
   */
  resolvesLinkTarget ({
    target,
  }) {
    const [linkPath, anchor] = target.split('#')

    if (!linkPath) {
      return this.collectHeadingSlugs()
        .includes(anchor)
    }

    const targetPath = this.path.resolve(this.filePath, '..', linkPath)

    if (!this.fs.existsSync(targetPath)) {
      return false
    }

    if (!anchor || !targetPath.endsWith('.md')) {
      return true
    }

    return this.Ctor.create({
      filePath: targetPath,
      markdown: this.fs.readFileSync(targetPath, 'utf8'),
    })
      .collectHeadingSlugs()
      .includes(anchor)
  }

  /**
   * Collect every link target of this document that resolves to nothing.
   *
   * @returns {Array<string>} Targets that resolve to nothing.
   * @public
   */
  collectBrokenLinkTargets () {
    return this.collectLinkTargets()
      .filter(target => !this.resolvesLinkTarget({
        target,
      }))
  }
}
