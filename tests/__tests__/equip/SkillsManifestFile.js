import fs from 'node:fs'
import path from 'node:path'

import SkillsManifestFile from '../../../lib/equip/SkillsManifestFile.js'

describe('SkillsManifestFile', () => {
  describe('constructor', () => {
    describe('should keep property', () => {
      describe('#filePath', () => {
        const cases = [
          {
            input: {
              filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
              installationPath: '.claude/skills',
            },
            expected: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          },
          {
            input: {
              filePath: '.hora/hora-skills-ort-renchan.json',
              installationPath: 'tools/skills',
            },
            expected: '.hora/hora-skills-ort-renchan.json',
          },
        ]

        test.each(cases)('filePath: $input.filePath', ({ input, expected }) => {
          const manifestFile = new SkillsManifestFile(input)

          expect(manifestFile)
            .toHaveProperty('filePath', expected)
        })
      })

      describe('#installationPath', () => {
        const cases = [
          {
            input: {
              filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
              installationPath: '.claude/skills',
            },
            expected: '.claude/skills',
          },
          {
            input: {
              filePath: '.hora/hora-skills-ort-renchan.json',
              installationPath: 'tools/skills',
            },
            expected: 'tools/skills',
          },
        ]

        test.each(cases)('installationPath: $input.installationPath', ({ input, expected }) => {
          const manifestFile = new SkillsManifestFile(input)

          expect(manifestFile)
            .toHaveProperty('installationPath', expected)
        })
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('.create()', () => {
    describe('should be an instance of own class', () => {
      const cases = [
        {
          input: {
            filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
            installationPath: '.claude/skills',
          },
        },
        {
          input: {
            filePath: '.hora/hora-skills-ort-renchan.json',
            installationPath: 'tools/skills',
          },
        },
      ]

      test.each(cases)('filePath: $input.filePath', ({ input }) => {
        const received = SkillsManifestFile.create(input)

        expect(received)
          .toBeInstanceOf(SkillsManifestFile)
      })
    })

    describe('should call constructor', () => {
      const cases = [
        {
          tally: {
            filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
            installationPath: '.claude/skills',
          },
        },
        {
          tally: {
            filePath: '.hora/hora-skills-ort-renchan.json',
            installationPath: 'tools/skills',
          },
        },
      ]

      test.each(cases)('filePath: $tally.filePath', ({ tally }) => {
        const SpyClass = constructorSpy.spyOn(SkillsManifestFile)

        SpyClass.create(tally)

        expect(SpyClass.__spy__)
          .toHaveBeenCalledWith(tally)
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#get:fs', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        const received = manifestFile.fs

        expect(received)
          .toBe(fs) // same reference
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#get:path', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        const received = manifestFile.path

        expect(received)
          .toBe(path) // same reference
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#loadSkillNames()', () => {
    describe('should be the skill names recorded for own installation path', () => {
      const cases = [
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [
                    'hor-query-resolver',
                  ],
                },
              },
            },
          },
          expected: [
            'hor-query-resolver',
          ],
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [],
                },
              },
            },
          },
          expected: [],
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [
                    'hor-naming',
                  ],
                },
                'tools/skills': {
                  skillNames: [
                    'hor-query-resolver',
                  ],
                },
              },
            },
          },
          expected: [
            'hor-naming',
          ],
        },
      ]

      test.each(cases)('installations: $override.manifestHash.installations', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const received = manifestFile.loadSkillNames()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should be empty when own installation path is not recorded', () => {
      const cases = [
        {
          override: {
            manifestHash: null,
          },
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
            },
          },
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {},
            },
          },
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                'tools/skills': {
                  skillNames: [
                    'hor-query-resolver',
                  ],
                },
              },
            },
          },
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                },
              },
            },
          },
        },
      ]

      test.each(cases)('manifestHash: $override.manifestHash', ({ override }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const received = manifestFile.loadSkillNames()

        expect(received)
          .toEqual([])
      })
    })

    describe('should be empty when the recorded skillNames is not an array', () => {
      const cases = [
        {
          override: {
            skillNames: 'hor-naming',
          },
        },
        {
          override: {
            skillNames: 1,
          },
        },
        {
          override: {
            skillNames: null,
          },
        },
        {
          override: {
            skillNames: {
              0: 'hor-naming',
            },
          },
        },
      ]

      test.each(cases)('skillNames: $override.skillNames', ({ override }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue({
            version: '0.0.1',
            installations: {
              '.claude/skills': {
                skillNames: override.skillNames,
              },
            },
          })

        const received = manifestFile.loadSkillNames()

        expect(received)
          .toEqual([])
      })
    })

    describe('should keep only the recorded skill names that are strings', () => {
      const cases = [
        {
          override: {
            skillNames: [
              'hor-naming',
              1,
              'hor-query-resolver',
            ],
          },
          expected: [
            'hor-naming',
            'hor-query-resolver',
          ],
        },
        {
          override: {
            skillNames: [
              null,
              {
                skillName: 'hor-naming',
              },
              [
                'hor-naming',
              ],
            ],
          },
          expected: [],
        },
      ]

      test.each(cases)('skillNames: $override.skillNames', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue({
            version: '0.0.1',
            installations: {
              '.claude/skills': {
                skillNames: override.skillNames,
              },
            },
          })

        const received = manifestFile.loadSkillNames()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#loadInstallation()', () => {
    describe('should be the entry of own installation path', () => {
      const cases = [
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [
                    'hor-naming',
                  ],
                },
              },
            },
          },
          expected: {
            skillNames: [
              'hor-naming',
            ],
          },
        },
      ]

      test.each(cases)('installations: $override.manifestHash.installations', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const received = manifestFile.loadInstallation()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should be null when own installation path is absent', () => {
      const cases = [
        {
          override: {
            manifestHash: null,
          },
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                'tools/skills': {
                  skillNames: [],
                },
              },
            },
          },
        },
      ]

      test.each(cases)('manifestHash: $override.manifestHash', ({ override }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const received = manifestFile.loadInstallation()

        expect(received)
          .toBeNull()
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#loadInstallationHash()', () => {
    describe('should be the entries of every installation path', () => {
      const cases = [
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [
                    'hor-naming',
                  ],
                },
                'tools/skills': {
                  skillNames: [
                    'hor-query-resolver',
                  ],
                },
              },
            },
          },
          expected: {
            '.claude/skills': {
              skillNames: [
                'hor-naming',
              ],
            },
            'tools/skills': {
              skillNames: [
                'hor-query-resolver',
              ],
            },
          },
        },
      ]

      test.each(cases)('installations: $override.manifestHash.installations', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const received = manifestFile.loadInstallationHash()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should be empty when no manifest is readable', () => {
      const cases = [
        {
          override: {
            manifestHash: null,
          },
        },
        {
          override: {
            manifestHash: {
              version: '0.0.1',
            },
          },
        },
      ]

      test.each(cases)('manifestHash: $override.manifestHash', ({ override }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const received = manifestFile.loadInstallationHash()

        expect(received)
          .toEqual({})
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#load()', () => {
    describe('should parse the manifest', () => {
      const cases = [
        {
          override: {
            content: '{"version":"0.0.1","installations":{".claude/skills":{"skillNames":["hor-query-resolver"]}}}',
          },
          expected: {
            version: '0.0.1',
            installations: {
              '.claude/skills': {
                skillNames: [
                  'hor-query-resolver',
                ],
              },
            },
          },
        },
        {
          override: {
            content: '{"version":null,"installations":{}}',
          },
          expected: {
            version: null,
            installations: {},
          },
        },
      ]

      test.each(cases)('content: $override.content', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(fs, 'existsSync')
          .mockReturnValue(true)
        jest.spyOn(fs, 'readFileSync')
          .mockReturnValue(override.content)

        const received = manifestFile.load()

        expect(received)
          .toEqual(expected)
      })
    })

    describe('should be null when the manifest is absent', () => {
      test('when the file does not exist', () => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(fs, 'existsSync')
          .mockReturnValue(false)

        const received = manifestFile.load()

        expect(received)
          .toBeNull()
      })
    })

    describe('should be null when the manifest is broken', () => {
      const cases = [
        {
          override: {
            content: 'not json',
          },
        },
        {
          override: {
            content: '{"installations": {',
          },
        },
      ]

      test.each(cases)('content: $override.content', ({ override }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(fs, 'existsSync')
          .mockReturnValue(true)
        jest.spyOn(fs, 'readFileSync')
          .mockReturnValue(override.content)

        const received = manifestFile.load()

        expect(received)
          .toBeNull()
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#save()', () => {
    describe('should record own installation path', () => {
      const cases = [
        {
          input: {
            version: '0.0.1',
            skillNames: [
              'hor-query-resolver',
            ],
          },
          override: {
            installationHash: {},
          },
          expected: {
            version: '0.0.1',
            installations: {
              '.claude/skills': {
                skillNames: [
                  'hor-query-resolver',
                ],
              },
            },
          },
        },
        {
          input: {
            version: null,
            skillNames: [],
          },
          override: {
            installationHash: {},
          },
          expected: {
            version: null,
            installations: {
              '.claude/skills': {
                skillNames: [],
              },
            },
          },
        },
      ]

      test.each(cases)('version: $input.version', ({ input, override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'loadInstallationHash')
          .mockReturnValue(override.installationHash)

        const writeSpy = jest.spyOn(manifestFile, 'write')
          .mockReturnValue()

        manifestFile.save(input)

        expect(writeSpy)
          .toHaveBeenCalledWith({
            manifestHash: expected,
          })
      })
    })

    describe('should keep the entries of the other installation paths', () => {
      const cases = [
        {
          input: {
            version: '0.0.1',
            skillNames: [
              'hor-naming',
            ],
          },
          override: {
            installationHash: {
              'tools/skills': {
                skillNames: [
                  'hor-query-resolver',
                ],
              },
            },
          },
          expected: {
            version: '0.0.1',
            installations: {
              'tools/skills': {
                skillNames: [
                  'hor-query-resolver',
                ],
              },
              '.claude/skills': {
                skillNames: [
                  'hor-naming',
                ],
              },
            },
          },
        },
      ]

      test.each(cases)('version: $input.version', ({ input, override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'loadInstallationHash')
          .mockReturnValue(override.installationHash)

        const writeSpy = jest.spyOn(manifestFile, 'write')
          .mockReturnValue()

        manifestFile.save(input)

        expect(writeSpy)
          .toHaveBeenCalledWith({
            manifestHash: expected,
          })
      })
    })

    describe('should replace the entry of own installation path', () => {
      const cases = [
        {
          input: {
            version: '0.0.2',
            skillNames: [
              'hor-naming',
            ],
          },
          override: {
            installationHash: {
              '.claude/skills': {
                skillNames: [
                  'hor-cp-table',
                ],
              },
            },
          },
          expected: {
            version: '0.0.2',
            installations: {
              '.claude/skills': {
                skillNames: [
                  'hor-naming',
                ],
              },
            },
          },
        },
      ]

      test.each(cases)('version: $input.version', ({ input, override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'loadInstallationHash')
          .mockReturnValue(override.installationHash)

        const writeSpy = jest.spyOn(manifestFile, 'write')
          .mockReturnValue()

        manifestFile.save(input)

        expect(writeSpy)
          .toHaveBeenCalledWith({
            manifestHash: expected,
          })
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#write()', () => {
    describe('should write the manifest as indented JSON', () => {
      const cases = [
        {
          input: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [
                    'hor-query-resolver',
                  ],
                },
              },
            },
          },
          expected: [
            '/tmp/app/.hora/hora-skills-ort-renchan.json',
            '{\n  "version": "0.0.1",\n  "installations": {\n    ".claude/skills": {\n      "skillNames": [\n        "hor-query-resolver"\n      ]\n    }\n  }\n}\n',
          ],
        },
        {
          input: {
            manifestHash: {
              version: null,
              installations: {},
            },
          },
          expected: [
            '/tmp/app/.hora/hora-skills-ort-renchan.json',
            '{\n  "version": null,\n  "installations": {}\n}\n',
          ],
        },
      ]

      test.each(cases)('version: $input.manifestHash.version', ({ input, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(fs, 'mkdirSync')
          .mockReturnValue()

        const writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync')
          .mockReturnValue()

        manifestFile.write(input)

        expect(writeFileSyncSpy)
          .toHaveBeenCalledWith(...expected)
      })
    })

    describe('should create the directory holding the manifest', () => {
      const cases = [
        {
          input: {
            manifestHash: {
              version: null,
              installations: {},
            },
          },
          expected: [
            '/tmp/app/.hora',
            {
              recursive: true,
            },
          ],
        },
      ]

      test.each(cases)('version: $input.manifestHash.version', ({ input, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        const mkdirSyncSpy = jest.spyOn(fs, 'mkdirSync')
          .mockReturnValue()

        jest.spyOn(fs, 'writeFileSync')
          .mockReturnValue()

        manifestFile.write(input)

        expect(mkdirSyncSpy)
          .toHaveBeenCalledWith(...expected)
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#remove()', () => {
    describe('should remove the file when no entry is left', () => {
      const cases = [
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [],
                },
              },
            },
          },
          expected: [
            '/tmp/app/.hora/hora-skills-ort-renchan.json',
            {
              force: true,
            },
          ],
        },
      ]

      test.each(cases)('installations: $override.manifestHash.installations', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const rmSyncSpy = jest.spyOn(fs, 'rmSync')
          .mockReturnValue()

        manifestFile.remove()

        expect(rmSyncSpy)
          .toHaveBeenCalledWith(...expected)
      })
    })

    describe('should keep the file when another entry is left', () => {
      const cases = [
        {
          override: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                '.claude/skills': {
                  skillNames: [],
                },
                'tools/skills': {
                  skillNames: [
                    'hor-query-resolver',
                  ],
                },
              },
            },
          },
          expected: {
            manifestHash: {
              version: '0.0.1',
              installations: {
                'tools/skills': {
                  skillNames: [
                    'hor-query-resolver',
                  ],
                },
              },
            },
          },
        },
      ]

      test.each(cases)('installations: $override.manifestHash.installations', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(override.manifestHash)

        const rmSyncSpy = jest.spyOn(fs, 'rmSync')
          .mockReturnValue()
        const writeSpy = jest.spyOn(manifestFile, 'write')
          .mockReturnValue()

        manifestFile.remove()

        expect(writeSpy)
          .toHaveBeenCalledWith(expected)
        expect(rmSyncSpy)
          .not
          .toHaveBeenCalled()
      })
    })

    describe('should do nothing when no manifest is readable', () => {
      test('when the manifest is absent', () => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'load')
          .mockReturnValue(null)

        const rmSyncSpy = jest.spyOn(fs, 'rmSync')
          .mockReturnValue()
        const writeSpy = jest.spyOn(manifestFile, 'write')
          .mockReturnValue()

        manifestFile.remove()

        expect(rmSyncSpy)
          .not
          .toHaveBeenCalled()
        expect(writeSpy)
          .not
          .toHaveBeenCalled()
      })
    })
  })
})

describe('SkillsManifestFile', () => {
  describe('#buildRemainingInstallationHash()', () => {
    describe('should drop the entry of own installation path', () => {
      const cases = [
        {
          override: {
            installationHash: {
              '.claude/skills': {
                skillNames: [],
              },
              'tools/skills': {
                skillNames: [
                  'hor-query-resolver',
                ],
              },
            },
          },
          expected: {
            'tools/skills': {
              skillNames: [
                'hor-query-resolver',
              ],
            },
          },
        },
        {
          override: {
            installationHash: {
              '.claude/skills': {
                skillNames: [],
              },
            },
          },
          expected: {},
        },
        {
          override: {
            installationHash: {},
          },
          expected: {},
        },
      ]

      test.each(cases)('installationHash: $override.installationHash', ({ override, expected }) => {
        const manifestFile = SkillsManifestFile.create({
          filePath: '/tmp/app/.hora/hora-skills-ort-renchan.json',
          installationPath: '.claude/skills',
        })

        jest.spyOn(manifestFile, 'loadInstallationHash')
          .mockReturnValue(override.installationHash)

        const received = manifestFile.buildRemainingInstallationHash()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})
