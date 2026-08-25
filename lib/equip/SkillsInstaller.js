import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import SkillsManifestFile from './SkillsManifestFile.js'

/**
 * Installer that copies the distributed skills into a consuming repository.
 *
 * One run replaces what the previous run wrote: the skills recorded in the manifest,
 * along with the folders named after a distributed skill, are removed first, then the
 * distributed skills are copied and recorded again.
 *
 * A folder named after nothing this package distributes, and recorded by no previous
 * run, is never removed — that is what keeps a skill the consuming repository authored
 * out of the way of an installation, including the very first one.
 */
export default class SkillsInstaller {
  /**
   * Constructor.
   *
   * @param {{
   *   sourceDirectoryPath: string
   *   targetDirectoryPath: string
   *   manifestFile: SkillsManifestFile
   * }} params - Parameters.
   */
  constructor ({
    sourceDirectoryPath,
    targetDirectoryPath,
    manifestFile,
  }) {
    this.sourceDirectoryPath = sourceDirectoryPath
    this.targetDirectoryPath = targetDirectoryPath
    this.manifestFile = manifestFile
  }

  /**
   * Factory method.
   *
   * @template {X extends typeof SkillsInstaller ? X : never} T, X
   * @param {{
   *   workingDirectoryPath: string
   *   targetDirectoryPath: string
   *   sourceDirectoryPath?: string
   * }} params - Parameters for the factory method.
   * @returns {InstanceType<T>} Instance of this class.
   * @this {T}
   * @public
   */
  static create ({
    workingDirectoryPath,
    targetDirectoryPath,
    sourceDirectoryPath = this.buildDefaultSourceDirectoryPath(),
  }) {
    const manifestFile = this.createSkillsManifestFile({
      workingDirectoryPath,
      targetDirectoryPath,
    })

    return new this({
      sourceDirectoryPath,
      targetDirectoryPath,
      manifestFile,
    })
  }

  /**
   * Constructor of the manifest file.
   *
   * @returns {typeof SkillsManifestFile} Constructor of the manifest file.
   */
  static get SkillsManifestFileCtor () {
    return SkillsManifestFile
  }

  /**
   * Path segments of the manifest, relative to the working directory.
   *
   * The manifest belongs to this package rather than to Claude Code, so it is kept
   * out of the installation directory and placed under a directory of its own.
   *
   * It is named after this package, so that the sibling skill libraries installing into
   * one repository each record their own installation instead of one overwriting another.
   *
   * @returns {Array<string>} Path segments of the manifest.
   */
  static get manifestPathSegments () {
    return [
      '.hora',
      'hora-skills-renchan.json',
    ]
  }

  /**
   * Build the path of the distributed skills shipped inside this package.
   *
   * @returns {string} Absolute path of `dist/skills/`.
   */
  static buildDefaultSourceDirectoryPath () {
    return fileURLToPath(
      new URL('../../dist/skills/', import.meta.url)
    )
  }

  /**
   * Create the manifest file recording the installation into the target directory.
   *
   * @param {{
   *   workingDirectoryPath: string
   *   targetDirectoryPath: string
   * }} params - Parameters.
   * @returns {SkillsManifestFile} Manifest file of the working directory.
   */
  static createSkillsManifestFile ({
    workingDirectoryPath,
    targetDirectoryPath,
  }) {
    return this.SkillsManifestFileCtor.create({
      filePath: path.join(
        workingDirectoryPath,
        ...this.manifestPathSegments
      ),
      installationPath: this.buildInstallationPath({
        workingDirectoryPath,
        targetDirectoryPath,
      }),
    })
  }

  /**
   * Build the key an installation is recorded under.
   *
   * The path is relative to the working directory and uses forward slashes, so that
   * the same installation is recorded under one key on every platform.
   *
   * @param {{
   *   workingDirectoryPath: string
   *   targetDirectoryPath: string
   * }} params - Parameters.
   * @returns {string} Key of the installation.
   */
  static buildInstallationPath ({
    workingDirectoryPath,
    targetDirectoryPath,
  }) {
    return path.relative(
      workingDirectoryPath,
      targetDirectoryPath
    )
      .split(path.sep)
      .join('/')
  }

  /**
   * Tell whether a skill name addresses a folder directly inside an installation directory.
   *
   * A skill name is one name of one folder, so it never carries a path. Reading one that
   * does would let a manifest of the consuming repository name a path outside the
   * installation directory, and a removal follows what the manifest names.
   *
   * The separators of both platforms are refused, rather than the one this platform uses,
   * so that a manifest written on either is read the same way on either.
   *
   * @param {{
   *   skillName: string
   * }} params - Parameters.
   * @returns {boolean} Whether the skill name addresses a folder of an installation directory.
   * @public
   */
  static isPlainSkillName ({
    skillName,
  }) {
    return skillName !== ''
      && skillName !== '.'
      && skillName !== '..'
      && !skillName.includes('/')
      && !skillName.includes('\\')
  }

  /**
   * Constructor of this instance.
   *
   * @returns {typeof SkillsInstaller} Constructor of this instance.
   */
  get Ctor () {
    return /** @type {typeof SkillsInstaller} */ (this.constructor)
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
   * Install the selected skills, replacing whatever the previous run installed.
   *
   * @returns {{
   *   installedSkillNames: Array<string>
   *   removedSkillNames: Array<string>
   * }} Skill folder names installed and removed by this run.
   * @public
   */
  install () {
    const removedSkillNames = this.removeInstalledSkills()
    const installedSkillNames = this.copyDistributedSkills()

    this.saveManifest({
      skillNames: installedSkillNames,
    })

    return {
      installedSkillNames,
      removedSkillNames,
    }
  }

  /**
   * Remove the skills the previous run installed.
   *
   * @returns {Array<string>} Removed skill folder names.
   */
  removeInstalledSkills () {
    const skillNames = this.collectRemovableSkillNames()

    skillNames.forEach(it => {
      this.fs.rmSync(
        this.buildTargetSkillPath({ skillName: it }),
        {
          recursive: true,
          force: true,
        }
      )
    })

    return skillNames
  }

  /**
   * Collect the skill folder names this run may remove.
   *
   * The manifest records what the previous run wrote, and a folder carrying the name of
   * a distributed skill is one this package would have written, so both are replaced.
   * A folder named after nothing this package distributes is left alone, which is what
   * keeps a skill the consuming repository authored out of the removal.
   *
   * What the manifest records is read as a claim rather than as a fact, so a name that
   * does not address a folder of the installation directory is dropped before anything
   * is removed.
   *
   * @returns {Array<string>} Skill folder names to remove.
   */
  collectRemovableSkillNames () {
    return [
      ...new Set([
        ...this.manifestFile.loadSkillNames(),
        ...this.collectDistributedSkillNamesInTarget(),
      ]),
    ]
      .filter(it => this.Ctor.isPlainSkillName({ skillName: it }))
      .toSorted()
  }

  /**
   * Collect the distributed skill folder names present in the target directory.
   *
   * Every distributed name is considered, whether or not the manifest records it, so
   * that a run following a version that installed more removes what it left behind.
   *
   * @returns {Array<string>} Distributed skill folder names sitting in the target directory.
   */
  collectDistributedSkillNamesInTarget () {
    const installedSkillNames = this.collectDirectoryNames({
      directoryPath: this.targetDirectoryPath,
    })

    return this.collectDistributedSkillNames()
      .filter(it => installedSkillNames.includes(it))
  }

  /**
   * Collect the names of the directories directly under a directory.
   *
   * @param {{
   *   directoryPath: string
   * }} params - Parameters.
   * @returns {Array<string>} Directory names, empty when the directory is absent.
   */
  collectDirectoryNames ({
    directoryPath,
  }) {
    if (!this.fs.existsSync(directoryPath)) {
      return []
    }

    return this.fs.readdirSync(
      directoryPath,
      { withFileTypes: true }
    )
      .filter(it => it.isDirectory())
      .map(it => it.name)
      .toSorted()
  }

  /**
   * Build the path a skill is installed at.
   *
   * @param {{
   *   skillName: string
   * }} params - Parameters.
   * @returns {string} Path of the installed skill.
   */
  buildTargetSkillPath ({
    skillName,
  }) {
    return this.path.join(
      this.targetDirectoryPath,
      skillName
    )
  }

  /**
   * Copy the distributed skills into the target directory.
   *
   * @returns {Array<string>} Copied skill folder names.
   */
  copyDistributedSkills () {
    const skillNames = this.collectDistributedSkillNames()

    this.fs.mkdirSync(
      this.targetDirectoryPath,
      { recursive: true }
    )

    skillNames.forEach(it => {
      this.fs.cpSync(
        this.buildSourceSkillPath({ skillName: it }),
        this.buildTargetSkillPath({ skillName: it }),
        { recursive: true }
      )
    })

    return skillNames
  }

  /**
   * Collect every skill folder name this package distributes.
   *
   * @returns {Array<string>} Distributed skill folder names.
   * @public
   */
  collectDistributedSkillNames () {
    return this.collectDirectoryNames({
      directoryPath: this.sourceDirectoryPath,
    })
  }

  /**
   * Build the path a skill is distributed at.
   *
   * @param {{
   *   skillName: string
   * }} params - Parameters.
   * @returns {string} Path of the distributed skill.
   */
  buildSourceSkillPath ({
    skillName,
  }) {
    return this.path.join(
      this.sourceDirectoryPath,
      skillName
    )
  }

  /**
   * Record what this run installed.
   *
   * @param {{
   *   skillNames: Array<string>
   * }} params - Parameters.
   * @returns {void}
   */
  saveManifest ({
    skillNames,
  }) {
    this.manifestFile.save({
      version: this.loadPackageVersion(),
      skillNames,
    })
  }

  /**
   * Load the version of this package.
   *
   * @returns {string | null} Version of this package, or null when unreadable.
   */
  loadPackageVersion () {
    try {
      const packageHash = JSON.parse(
        this.fs.readFileSync(
          new URL('../../package.json', import.meta.url),
          'utf8'
        )
      )

      return packageHash.version
        ?? null
    } catch {
      return null
    }
  }

  /**
   * Remove every skill this package installed, along with the manifest.
   *
   * @returns {{
   *   removedSkillNames: Array<string>
   * }} Removed skill folder names.
   * @public
   */
  uninstall () {
    const removedSkillNames = this.removeInstalledSkills()

    this.manifestFile.remove()

    return {
      removedSkillNames,
    }
  }
}
