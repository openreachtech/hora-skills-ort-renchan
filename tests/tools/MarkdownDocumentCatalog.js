import fs from 'node:fs'
import path from 'node:path'

import MarkdownDocument from './MarkdownDocument.js'

/**
 * The Markdown documents held under one directory.
 *
 * A document is addressed by its path relative to the root, in POSIX notation, so
 * that the name a test case carries reads the same on every platform.
 */
export default class MarkdownDocumentCatalog {
  /**
   * Constructor.
   *
   * @param {{
   *   rootPath: string
   * }} params - Parameters.
   */
  constructor ({
    rootPath,
  }) {
    this.rootPath = rootPath
  }

  /**
   * Factory method.
   *
   * @template {X extends typeof MarkdownDocumentCatalog ? X : never} T, X
   * @param {{
   *   rootPath: string
   * }} params - Parameters for the factory method.
   * @returns {InstanceType<T>} Instance of this class.
   * @this {T}
   * @public
   */
  static create ({
    rootPath,
  }) {
    return new this({
      rootPath,
    })
  }

  /**
   * Constructor of the document class this catalog builds.
   *
   * @returns {typeof MarkdownDocument} Constructor of the document class.
   */
  static get MarkdownDocumentCtor () {
    return MarkdownDocument
  }

  /**
   * Constructor of this instance.
   *
   * @returns {typeof MarkdownDocumentCatalog} Constructor of this instance.
   */
  get Ctor () {
    return /** @type {typeof MarkdownDocumentCatalog} */ (this.constructor)
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
   * Collect the path of every Markdown document under the root, relative to it.
   *
   * @returns {Array<string>} Paths in POSIX notation, in ascending order.
   * @public
   */
  collectDocumentPaths () {
    return this.fs.readdirSync(this.rootPath, {
      recursive: true,
    })
      .map(entry =>
        String(entry)
          .replaceAll('\\', '/')
      )
      .filter(entry => entry.endsWith('.md'))
      .toSorted()
  }

  /**
   * Collect the path of every document that holds at least one link to resolve.
   *
   * @returns {Array<string>} Paths in POSIX notation, in ascending order.
   * @public
   */
  collectLinkingDocumentPaths () {
    return this.collectDocumentPaths()
      .filter(documentPath =>
        this.buildDocument({ documentPath })
          .collectLinkTargets()
          .length > 0
      )
  }

  /**
   * Build the document sitting at one path.
   *
   * @param {{
   *   documentPath: string
   * }} params - Parameters.
   * @returns {MarkdownDocument} Document read from the root.
   * @public
   */
  buildDocument ({
    documentPath,
  }) {
    const filePath = this.path.join(this.rootPath, documentPath)

    return this.Ctor.MarkdownDocumentCtor.create({
      filePath,
      markdown: this.fs.readFileSync(filePath, 'utf8'),
    })
  }
}
