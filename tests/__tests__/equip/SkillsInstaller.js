import fs from 'node:fs'
import path from 'node:path'

import SkillsInstaller from '../../../lib/equip/SkillsInstaller.js'

import SkillsManifestFile from '../../../lib/equip/SkillsManifestFile.js'

describe('SkillsInstaller', () => {
  describe('constructor', () => {
    describe('should keep property', () => {
      describe('#sourceDirectoryPath', () => {
        const cases = [
          {
            input: {
              sourceDirectoryPath: '/package/dist/skills',
            },
            expected: '/package/dist/skills',
          },
          {
            input: {
              sourceDirectoryPath: 'dist/skills',
            },
            expected: 'dist/skills',
          },
        ]

        test.each(cases)('sourceDirectoryPath: $input.sourceDirectoryPath', ({ input, expected }) => {
          const args = {
            sourceDirectoryPath: input.sourceDirectoryPath,
            targetDirectoryPath: '',
            manifestFile: null,
          }

          const installer = new SkillsInstaller(args)

          expect(installer)
            .toHaveProperty('sourceDirectoryPath', expected)
        })
      })

      describe('#targetDirectoryPath', () => {
        const cases = [
          {
            input: {
              workingDirectoryPath: '/consumer',
              targetDirectoryPath: '/consumer/.claude/skills',
            },
            expected: '/consumer/.claude/skills',
          },
          {
            input: {
              workingDirectoryPath: '.',
              targetDirectoryPath: '.claude/skills',
            },
            expected: '.claude/skills',
          },
        ]

        test.each(cases)('targetDirectoryPath: $input.targetDirectoryPath', ({ input, expected }) => {
          const args = {
            sourceDirectoryPath: '',
            targetDirectoryPath: input.targetDirectoryPath,
            manifestFile: null,
          }

          const installer = new SkillsInstaller(args)

          expect(installer)
            .toHaveProperty('targetDirectoryPath', expected)
        })
      })

      describe('#manifestFile', () => {
        const cases = [
          {
            input: {
              manifestFile: SkillsManifestFile.create({
                filePath: '/consumer/.hora/hora-skills-ort-renchan.json',
                installationPath: '.claude/skills',
              }),
            },
          },
          {
            input: {
              manifestFile: SkillsManifestFile.create({
                filePath: '.hora/hora-skills-ort-renchan.json',
                installationPath: 'tools/skills',
              }),
            },
          },
        ]

        test.each(cases)('filePath: $input.manifestFile.filePath', ({ input }) => {
          const args = {
            sourceDirectoryPath: '',
            targetDirectoryPath: '',
            manifestFile: input.manifestFile,
          }

          const installer = new SkillsInstaller(args)

          expect(installer)
            .toHaveProperty('manifestFile', input.manifestFile)
        })
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('.create()', () => {
    describe('should be an instance of own class', () => {
      const cases = [
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/.claude/skills',
            sourceDirectoryPath: '/package/dist/skills',
          },
        },
        {
          input: {
            workingDirectoryPath: '.',
            targetDirectoryPath: '.claude/skills',
            sourceDirectoryPath: 'dist/skills',
          },
        },
      ]

      test.each(cases)('targetDirectoryPath: $input.targetDirectoryPath', ({ input }) => {
        const received = SkillsInstaller.create(input)

        expect(received)
          .toBeInstanceOf(SkillsInstaller)
      })
    })

    describe('should call constructor', () => {
      const cases = [
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/.claude/skills',
            sourceDirectoryPath: '/package/dist/skills',
          },
          expected: {
            filePath: '/consumer/.hora/hora-skills-ort-renchan.json',
            installationPath: '.claude/skills',
          },
        },
        {
          input: {
            workingDirectoryPath: '/tmp',
            targetDirectoryPath: '/tmp/skills',
            sourceDirectoryPath: '/package/dist/skills',
          },
          expected: {
            filePath: '/tmp/.hora/hora-skills-ort-renchan.json',
            installationPath: 'skills',
          },
        },
      ]

      test.each(cases)('targetDirectoryPath: $input.targetDirectoryPath', ({ input, expected }) => {
        const args = {
          workingDirectoryPath: input.workingDirectoryPath,
          targetDirectoryPath: input.targetDirectoryPath,
          sourceDirectoryPath: input.sourceDirectoryPath,
        }

        const installer = SkillsInstaller.create(args)
        const received = installer.manifestFile

        expect(received)
          .toHaveProperty('filePath', expected.filePath)
        expect(received)
          .toHaveProperty('installationPath', expected.installationPath)
      })
    })

    describe('should fill default sourceDirectoryPath', () => {
      const cases = [
        {
          override: {
            sourceDirectoryPath: '/package/dist/skills',
          },
        },
        {
          override: {
            sourceDirectoryPath: '/elsewhere/dist/skills',
          },
        },
      ]

      test.each(cases)('sourceDirectoryPath: $override.sourceDirectoryPath', ({ override }) => {
        jest.spyOn(SkillsInstaller, 'buildDefaultSourceDirectoryPath')
          .mockReturnValue(override.sourceDirectoryPath)

        const args = {
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
        }

        const installer = SkillsInstaller.create(args)

        expect(installer)
          .toHaveProperty('sourceDirectoryPath', override.sourceDirectoryPath)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('.get:SkillsManifestFileCtor', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const received = SkillsInstaller.SkillsManifestFileCtor

        expect(received)
          .toBe(SkillsManifestFile) // same reference
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('.get:manifestPathSegments', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const received = SkillsInstaller.manifestPathSegments

        expect(received)
          .toEqual([
            '.hora',
            'hora-skills-ort-renchan.json',
          ])
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('.buildDefaultSourceDirectoryPath()', () => {
    describe('when called as is', () => {
      test('should be the distributed skills of this package', () => {
        const expected = path.resolve(
          import.meta.dirname,
          '../../../dist/skills'
        )

        const received = SkillsInstaller.buildDefaultSourceDirectoryPath()

        expect(received)
          .toBe(`${expected}${path.sep}`)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('.createSkillsManifestFile()', () => {
    describe('should place the manifest under the working directory', () => {
      const cases = [
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/.claude/skills',
          },
          expected: '/consumer/.hora/hora-skills-ort-renchan.json',
        },
        {
          input: {
            workingDirectoryPath: '/tmp',
            targetDirectoryPath: '/tmp/skills/',
          },
          expected: '/tmp/.hora/hora-skills-ort-renchan.json',
        },
      ]

      test.each(cases)('targetDirectoryPath: $input.targetDirectoryPath', ({ input, expected }) => {
        const manifestFile = SkillsInstaller.createSkillsManifestFile(input)
        const received = manifestFile.filePath

        expect(received)
          .toBe(expected)
      })
    })

    describe('should key the entry by the installation path', () => {
      const cases = [
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/.claude/skills',
          },
          expected: '.claude/skills',
        },
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/tools/skills',
          },
          expected: 'tools/skills',
        },
      ]

      test.each(cases)('targetDirectoryPath: $input.targetDirectoryPath', ({ input, expected }) => {
        const manifestFile = SkillsInstaller.createSkillsManifestFile(input)
        const received = manifestFile.installationPath

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('.buildInstallationPath()', () => {
    describe('should be the target directory relative to the working directory', () => {
      const cases = [
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/.claude/skills',
          },
          expected: '.claude/skills',
        },
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/tools/skills',
          },
          expected: 'tools/skills',
        },
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer',
          },
          expected: '',
        },
        {
          input: {
            workingDirectoryPath: '/consumer/app',
            targetDirectoryPath: '/consumer/.claude/skills',
          },
          expected: '../.claude/skills',
        },
      ]

      test.each(cases)('targetDirectoryPath: $input.targetDirectoryPath', ({ input, expected }) => {
        const received = SkillsInstaller.buildInstallationPath(input)

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('.isPlainSkillName()', () => {
    describe('should be true for a folder of the installation directory', () => {
      const cases = [
        {
          input: {
            skillName: 'hor-naming',
          },
        },
        {
          input: {
            skillName: 'hor-cp-table',
          },
        },
        {
          input: {
            skillName: '.hidden-skill',
          },
        },
        {
          input: {
            skillName: 'skill with space',
          },
        },
      ]

      test.each(cases)('skillName: $input.skillName', ({ input }) => {
        const received = SkillsInstaller.isPlainSkillName(input)

        expect(received)
          .toBe(true)
      })
    })

    describe('should be false for a skill name reaching outside the installation directory', () => {
      const cases = [
        {
          input: {
            skillName: '..',
          },
        },
        {
          input: {
            skillName: '.',
          },
        },
        {
          input: {
            skillName: '',
          },
        },
        {
          input: {
            skillName: '../../../canary',
          },
        },
        {
          input: {
            skillName: 'hor-naming/SKILL.md',
          },
        },
        {
          input: {
            skillName: '/etc/hosts',
          },
        },
        {
          input: {
            skillName: '..\\..\\canary',
          },
        },
      ]

      test.each(cases)('skillName: $input.skillName', ({ input }) => {
        const received = SkillsInstaller.isPlainSkillName(input)

        expect(received)
          .toBe(false)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#get:fs', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        const received = installer.fs

        expect(received)
          .toBe(fs) // same reference
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#get:path', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        const received = installer.path

        expect(received)
          .toBe(path) // same reference
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#install()', () => {
    describe('should record what it installed', () => {
      const cases = [
        {
          override: {
            removedSkillNames: [
              'hor-cp-table',
            ],
            installedSkillNames: [
              'hor-query-resolver',
            ],
          },
          expected: {
            skillNames: [
              'hor-query-resolver',
            ],
          },
        },
        {
          override: {
            removedSkillNames: [],
            installedSkillNames: [],
          },
          expected: {
            skillNames: [],
          },
        },
      ]

      test.each(cases)('installedSkillNames: $override.installedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer, 'removeInstalledSkills')
          .mockReturnValue(override.removedSkillNames)
        jest.spyOn(installer, 'copyDistributedSkills')
          .mockReturnValue(override.installedSkillNames)

        const saveManifestSpy = jest.spyOn(installer, 'saveManifest')
          .mockReturnValue()

        installer.install()

        expect(saveManifestSpy)
          .toHaveBeenCalledWith(expected)
      })
    })

    describe('should report the removed and the installed skills', () => {
      const cases = [
        {
          override: {
            removedSkillNames: [
              'hor-cp-table',
            ],
            installedSkillNames: [
              'hor-query-resolver',
            ],
          },
          expected: {
            removedSkillNames: [
              'hor-cp-table',
            ],
            installedSkillNames: [
              'hor-query-resolver',
            ],
          },
        },
        {
          override: {
            removedSkillNames: [],
            installedSkillNames: [
              'hor-naming',
              'hor-jsdoc',
            ],
          },
          expected: {
            removedSkillNames: [],
            installedSkillNames: [
              'hor-naming',
              'hor-jsdoc',
            ],
          },
        },
      ]

      test.each(cases)('installedSkillNames: $override.installedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer, 'removeInstalledSkills')
          .mockReturnValue(override.removedSkillNames)
        jest.spyOn(installer, 'copyDistributedSkills')
          .mockReturnValue(override.installedSkillNames)
        jest.spyOn(installer, 'saveManifest')
          .mockReturnValue()

        const received = installer.install()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#removeInstalledSkills()', () => {
    describe('should remove every owned skill directory', () => {
      const cases = [
        {
          override: {
            recordedSkillNames: [
              'hor-query-resolver',
              'hor-stub-api',
            ],
          },
          expected: [
            [
              '/consumer/.claude/skills/hor-query-resolver',
              {
                recursive: true,
                force: true,
              },
            ],
            [
              '/consumer/.claude/skills/hor-stub-api',
              {
                recursive: true,
                force: true,
              },
            ],
          ],
        },
      ]

      test.each(cases)('recordedSkillNames: $override.recordedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer.manifestFile, 'loadSkillNames')
          .mockReturnValue(override.recordedSkillNames)

        const rmSyncSpy = jest.spyOn(fs, 'rmSync')
          .mockReturnValue()

        installer.removeInstalledSkills()

        expect(rmSyncSpy)
          .toHaveBeenNthCalledWith(1, ...expected[0])
        expect(rmSyncSpy)
          .toHaveBeenNthCalledWith(2, ...expected[1])
      })
    })

    describe('should report the removed skills', () => {
      const cases = [
        {
          override: {
            recordedSkillNames: [
              'hor-query-resolver',
            ],
          },
          expected: [
            'hor-query-resolver',
          ],
        },
        {
          override: {
            recordedSkillNames: [],
          },
          expected: [],
        },
      ]

      test.each(cases)('recordedSkillNames: $override.recordedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer.manifestFile, 'loadSkillNames')
          .mockReturnValue(override.recordedSkillNames)
        jest.spyOn(fs, 'rmSync')
          .mockReturnValue()

        const received = installer.removeInstalledSkills()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should keep a skill named after nothing this package distributes', () => {
      const cases = [
        {
          override: {
            recordedSkillNames: [],
            distributedSkillNames: [
              'hor-query-resolver',
              'hor-naming',
            ],
            directoryNames: [
              'hor-naming',
              'hor-own-skill',
              'my-own-skill',
            ],
          },
          expected: [
            'hor-naming',
          ],
        },
        {
          override: {
            recordedSkillNames: [],
            distributedSkillNames: [
              'hor-query-resolver',
              'hor-naming',
            ],
            directoryNames: [
              'hor-own-skill',
              'my-own-skill',
            ],
          },
          expected: [],
        },
      ]

      test.each(cases)('directoryNames: $override.directoryNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer.manifestFile, 'loadSkillNames')
          .mockReturnValue(override.recordedSkillNames)
        jest.spyOn(installer, 'collectDistributedSkillNames')
          .mockReturnValue(override.distributedSkillNames)
        jest.spyOn(installer, 'collectDirectoryNames')
          .mockReturnValue(override.directoryNames)

        jest.spyOn(fs, 'rmSync')
          .mockReturnValue()

        const received = installer.removeInstalledSkills()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should never remove outside the installation directory', () => {
      const cases = [
        {
          override: {
            recordedSkillNames: [
              '../../../canary',
              'hor-naming',
            ],
          },
          expected: [
            [
              '/consumer/.claude/skills/hor-naming',
              {
                recursive: true,
                force: true,
              },
            ],
          ],
        },
      ]

      test.each(cases)('recordedSkillNames: $override.recordedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer.manifestFile, 'loadSkillNames')
          .mockReturnValue(override.recordedSkillNames)
        jest.spyOn(installer, 'collectDistributedSkillNames')
          .mockReturnValue([])
        jest.spyOn(installer, 'collectDirectoryNames')
          .mockReturnValue([])

        const rmSyncSpy = jest.spyOn(fs, 'rmSync')
          .mockReturnValue()

        installer.removeInstalledSkills()

        expect(rmSyncSpy)
          .toHaveBeenCalledTimes(1)
        expect(rmSyncSpy)
          .toHaveBeenNthCalledWith(1, ...expected[0])
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#collectRemovableSkillNames()', () => {
    describe('should join what the manifest recorded and what is named after a distributed skill', () => {
      const cases = [
        {
          override: {
            recordedSkillNames: [
              'hor-cp-table',
            ],
            distributedSkillNames: [
              'hor-query-resolver',
              'hor-naming',
            ],
            directoryNames: [
              'hor-naming',
              'hor-own-skill',
            ],
          },
          expected: [
            'hor-cp-table',
            'hor-naming',
          ],
        },
        {
          override: {
            recordedSkillNames: [
              'hor-naming',
            ],
            distributedSkillNames: [
              'hor-naming',
            ],
            directoryNames: [
              'hor-naming',
            ],
          },
          expected: [
            'hor-naming',
          ],
        },
        {
          override: {
            recordedSkillNames: [],
            distributedSkillNames: [],
            directoryNames: [
              'hor-own-skill',
            ],
          },
          expected: [],
        },
      ]

      test.each(cases)('recordedSkillNames: $override.recordedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer.manifestFile, 'loadSkillNames')
          .mockReturnValue(override.recordedSkillNames)
        jest.spyOn(installer, 'collectDistributedSkillNames')
          .mockReturnValue(override.distributedSkillNames)
        jest.spyOn(installer, 'collectDirectoryNames')
          .mockReturnValue(override.directoryNames)

        const received = installer.collectRemovableSkillNames()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should drop a recorded skill name that is not a plain skill name', () => {
      const cases = [
        {
          override: {
            recordedSkillNames: [
              'hor-naming',
              '../../../canary',
            ],
            distributedSkillNames: [],
            directoryNames: [],
          },
          expected: [
            'hor-naming',
          ],
        },
        {
          override: {
            recordedSkillNames: [
              '..',
              '.',
              '',
              'hor-naming/SKILL.md',
            ],
            distributedSkillNames: [],
            directoryNames: [],
          },
          expected: [],
        },
      ]

      test.each(cases)('recordedSkillNames: $override.recordedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer.manifestFile, 'loadSkillNames')
          .mockReturnValue(override.recordedSkillNames)
        jest.spyOn(installer, 'collectDistributedSkillNames')
          .mockReturnValue(override.distributedSkillNames)
        jest.spyOn(installer, 'collectDirectoryNames')
          .mockReturnValue(override.directoryNames)

        const received = installer.collectRemovableSkillNames()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#collectDistributedSkillNamesInTarget()', () => {
    describe('should keep only the distributed names sitting in the target directory', () => {
      const cases = [
        {
          override: {
            distributedSkillNames: [
              'hor-query-resolver',
              'hor-jsdoc',
              'hor-naming',
            ],
            directoryNames: [
              'hor-naming',
              'hor-own-skill',
              'my-own-skill',
            ],
          },
          expected: [
            'hor-naming',
          ],
        },
        {
          override: {
            distributedSkillNames: [
              'hor-query-resolver',
              'hor-naming',
            ],
            directoryNames: [
              'hor-query-resolver',
              'hor-naming',
            ],
          },
          expected: [
            'hor-query-resolver',
            'hor-naming',
          ],
        },
        {
          override: {
            distributedSkillNames: [
              'hor-naming',
            ],
            directoryNames: [],
          },
          expected: [],
        },
      ]

      test.each(cases)('directoryNames: $override.directoryNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer, 'collectDistributedSkillNames')
          .mockReturnValue(override.distributedSkillNames)
        jest.spyOn(installer, 'collectDirectoryNames')
          .mockReturnValue(override.directoryNames)

        const received = installer.collectDistributedSkillNamesInTarget()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#collectDirectoryNames()', () => {
    describe('should be the sorted names of the directories', () => {
      const cases = [
        {
          override: {
            dirents: [
              {
                name: 'hor-cp-table',
                isDirectory: () => true,
              },
              {
                name: 'hor-query-resolver',
                isDirectory: () => true,
              },
              {
                name: 'README.md',
                isDirectory: () => false,
              },
            ],
          },
          expected: [
            'hor-cp-table',
            'hor-query-resolver',
          ],
        },
        {
          override: {
            dirents: [],
          },
          expected: [],
        },
      ]

      test.each(cases)('dirents: $override.dirents.length', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })
        const args = {
          directoryPath: '/consumer/.claude/skills',
        }

        jest.spyOn(fs, 'existsSync')
          .mockReturnValue(true)
        jest.spyOn(fs, 'readdirSync')
          .mockReturnValue(override.dirents)

        const received = installer.collectDirectoryNames(args)

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should be empty when the directory is absent', () => {
      test('when the directory does not exist', () => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })
        const args = {
          directoryPath: '/consumer/.claude/skills',
        }

        jest.spyOn(fs, 'existsSync')
          .mockReturnValue(false)

        const received = installer.collectDirectoryNames(args)

        expect(received)
          .toEqual([])
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#buildTargetSkillPath()', () => {
    describe('should be the skill under the target directory', () => {
      const cases = [
        {
          input: {
            skillName: 'hor-query-resolver',
          },
          expected: '/consumer/.claude/skills/hor-query-resolver',
        },
        {
          input: {
            skillName: 'hor-naming',
          },
          expected: '/consumer/.claude/skills/hor-naming',
        },
      ]

      test.each(cases)('skillName: $input.skillName', ({ input, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        const received = installer.buildTargetSkillPath(input)

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#buildSourceSkillPath()', () => {
    describe('should be the skill under the source directory', () => {
      const cases = [
        {
          input: {
            skillName: 'hor-query-resolver',
          },
          expected: '/package/dist/skills/hor-query-resolver',
        },
        {
          input: {
            skillName: 'hor-naming',
          },
          expected: '/package/dist/skills/hor-naming',
        },
      ]

      test.each(cases)('skillName: $input.skillName', ({ input, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        const received = installer.buildSourceSkillPath(input)

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#copyDistributedSkills()', () => {
    describe('should copy each distributed skill into the target directory', () => {
      const cases = [
        {
          override: {
            distributedSkillNames: [
              'hor-query-resolver',
            ],
          },
          expected: [
            '/package/dist/skills/hor-query-resolver',
            '/consumer/.claude/skills/hor-query-resolver',
            {
              recursive: true,
            },
          ],
        },
        {
          override: {
            distributedSkillNames: [
              'hor-naming',
            ],
          },
          expected: [
            '/package/dist/skills/hor-naming',
            '/consumer/.claude/skills/hor-naming',
            {
              recursive: true,
            },
          ],
        },
      ]

      test.each(cases)('distributedSkillNames: $override.distributedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer, 'collectDistributedSkillNames')
          .mockReturnValue(override.distributedSkillNames)
        jest.spyOn(fs, 'mkdirSync')
          .mockReturnValue('')

        const cpSyncSpy = jest.spyOn(fs, 'cpSync')
          .mockReturnValue()

        installer.copyDistributedSkills()

        expect(cpSyncSpy)
          .toHaveBeenCalledWith(...expected)
      })
    })

    describe('should create the target directory', () => {
      const cases = [
        {
          input: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/.claude/skills',
          },
          expected: [
            '/consumer/.claude/skills',
            {
              recursive: true,
            },
          ],
        },
        {
          input: {
            workingDirectoryPath: '/tmp',
            targetDirectoryPath: '/tmp/skills',
          },
          expected: [
            '/tmp/skills',
            {
              recursive: true,
            },
          ],
        },
      ]

      test.each(cases)('targetDirectoryPath: $input.targetDirectoryPath', ({ input, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: input.workingDirectoryPath,
          targetDirectoryPath: input.targetDirectoryPath,
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer, 'collectDistributedSkillNames')
          .mockReturnValue([])

        const mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync')
          .mockReturnValue('')

        installer.copyDistributedSkills()

        expect(mkdirSyncSpy)
          .toHaveBeenCalledWith(...expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#collectDistributedSkillNames()', () => {
    describe('should read the source directory', () => {
      const cases = [
        {
          input: {
            sourceDirectoryPath: '/package/dist/skills',
          },
          expected: {
            directoryPath: '/package/dist/skills',
          },
        },
        {
          input: {
            sourceDirectoryPath: '/elsewhere/dist/skills',
          },
          expected: {
            directoryPath: '/elsewhere/dist/skills',
          },
        },
      ]

      test.each(cases)('sourceDirectoryPath: $input.sourceDirectoryPath', ({ input, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: input.sourceDirectoryPath,
        })

        const collectDirectoryNamesSpy = jest.spyOn(installer, 'collectDirectoryNames')
          .mockReturnValue([])

        installer.collectDistributedSkillNames()

        expect(collectDirectoryNamesSpy)
          .toHaveBeenCalledWith(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#saveManifest()', () => {
    describe('should record the version and the skills', () => {
      const cases = [
        {
          override: {
            version: '0.0.1',
          },
          input: {
            skillNames: [
              'hor-query-resolver',
            ],
          },
          expected: {
            version: '0.0.1',
            skillNames: [
              'hor-query-resolver',
            ],
          },
        },
        {
          override: {
            version: null,
          },
          input: {
            skillNames: [],
          },
          expected: {
            version: null,
            skillNames: [],
          },
        },
      ]

      test.each(cases)('version: $override.version', ({ override, input, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer, 'loadPackageVersion')
          .mockReturnValue(override.version)

        const saveSpy = jest.spyOn(installer.manifestFile, 'save')
          .mockReturnValue()

        installer.saveManifest(input)

        expect(saveSpy)
          .toHaveBeenCalledWith(expected)
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#loadPackageVersion()', () => {
    describe('should be the version of this package', () => {
      const cases = [
        {
          override: {
            content: '{"version":"1.2.3"}',
          },
          expected: '1.2.3',
        },
        {
          override: {
            content: '{"version":"0.0.1"}',
          },
          expected: '0.0.1',
        },
      ]

      test.each(cases)('content: $override.content', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(fs, 'readFileSync')
          .mockReturnValue(override.content)

        const received = installer.loadPackageVersion()

        expect(received)
          .toBe(expected)
      })
    })

    describe('should be null when the version is unreadable', () => {
      const cases = [
        {
          override: {
            content: 'not json',
          },
        },
        {
          override: {
            content: '{"name":"@openreachtech/hora-skills"}',
          },
        },
      ]

      test.each(cases)('content: $override.content', ({ override }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(fs, 'readFileSync')
          .mockReturnValue(override.content)

        const received = installer.loadPackageVersion()

        expect(received)
          .toBeNull()
      })
    })
  })
})

describe('SkillsInstaller', () => {
  describe('#uninstall()', () => {
    describe('should remove the installed skills and the manifest', () => {
      const cases = [
        {
          override: {
            removedSkillNames: [
              'hor-query-resolver',
            ],
          },
          expected: {
            removedSkillNames: [
              'hor-query-resolver',
            ],
          },
        },
        {
          override: {
            removedSkillNames: [],
          },
          expected: {
            removedSkillNames: [],
          },
        },
      ]

      test.each(cases)('removedSkillNames: $override.removedSkillNames', ({ override, expected }) => {
        const installer = SkillsInstaller.create({
          workingDirectoryPath: '/consumer',
          targetDirectoryPath: '/consumer/.claude/skills',
          sourceDirectoryPath: '/package/dist/skills',
        })

        jest.spyOn(installer, 'removeInstalledSkills')
          .mockReturnValue(override.removedSkillNames)

        const removeSpy = jest.spyOn(installer.manifestFile, 'remove')
          .mockReturnValue()

        const received = installer.uninstall()

        expect(removeSpy)
          .toHaveBeenCalledWith()
        expect(received)
          .toEqual(expected)
      })
    })
  })
})
