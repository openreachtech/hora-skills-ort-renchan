import fs from 'node:fs'
import path from 'node:path'

import HoraSkillsCli from '../../../lib/equip/HoraSkillsCli.js'

import CommandLineArguments from '../../../lib/equip/CommandLineArguments.js'
import SkillsInstaller from '../../../lib/equip/SkillsInstaller.js'

describe('HoraSkillsCli', () => {
  describe('constructor', () => {
    describe('should keep property', () => {
      describe('#commandLineArguments', () => {
        const cases = [
          {
            input: {
              commandLineArguments: CommandLineArguments.create({
                args: [
                  'install',
                ],
              }),
            },
          },
          {
            input: {
              commandLineArguments: CommandLineArguments.create({
                args: [],
              }),
            },
          },
        ]

        test.each(cases)('args: $input.commandLineArguments.args', ({ input }) => {
          const args = {
            commandLineArguments: input.commandLineArguments,
            workingDirectoryPath: '',
            logger: null,
          }

          const cli = new HoraSkillsCli(args)

          expect(cli)
            .toHaveProperty('commandLineArguments', input.commandLineArguments)
        })
      })

      describe('#workingDirectoryPath', () => {
        const cases = [
          {
            input: {
              workingDirectoryPath: '/consumer',
            },
            expected: '/consumer',
          },
          {
            input: {
              workingDirectoryPath: '/tmp/consumer',
            },
            expected: '/tmp/consumer',
          },
        ]

        test.each(cases)('workingDirectoryPath: $input.workingDirectoryPath', ({ input, expected }) => {
          const args = {
            commandLineArguments: null,
            workingDirectoryPath: input.workingDirectoryPath,
            logger: null,
          }

          const cli = new HoraSkillsCli(args)

          expect(cli)
            .toHaveProperty('workingDirectoryPath', expected)
        })
      })

      describe('#logger', () => {
        const cases = [
          {
            input: {
              logger: console,
            },
          },
          {
            input: {
              logger: {
                log: () => {},
                error: () => {},
              },
            },
          },
        ]

        test.each(cases)('logger: $input.logger', ({ input }) => {
          const args = {
            commandLineArguments: null,
            workingDirectoryPath: '',
            logger: input.logger,
          }

          const cli = new HoraSkillsCli(args)

          expect(cli)
            .toHaveProperty('logger', input.logger)
        })
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('.create()', () => {
    describe('should be an instance of own class', () => {
      const cases = [
        {
          input: {
            args: [
              'install',
            ],
            workingDirectoryPath: '/consumer',
          },
        },
        {
          input: {
            args: [],
            workingDirectoryPath: '/tmp',
          },
        },
      ]

      test.each(cases)('args: $input.args', ({ input }) => {
        const received = HoraSkillsCli.create(input)

        expect(received)
          .toBeInstanceOf(HoraSkillsCli)
      })
    })

    describe('should fill default workingDirectoryPath', () => {
      test('when omitted', () => {
        const args = {
          args: [],
        }

        const cli = HoraSkillsCli.create(args)

        expect(cli)
          .toHaveProperty('workingDirectoryPath', process.cwd())
      })
    })

    describe('should fill default logger', () => {
      test('when omitted', () => {
        const args = {
          args: [],
        }

        const cli = HoraSkillsCli.create(args)

        expect(cli)
          .toHaveProperty('logger', console)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('.get:CommandLineArgumentsCtor', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const received = HoraSkillsCli.CommandLineArgumentsCtor

        expect(received)
          .toBe(CommandLineArguments) // same reference
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('.get:SkillsInstallerCtor', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const received = HoraSkillsCli.SkillsInstallerCtor

        expect(received)
          .toBe(SkillsInstaller) // same reference
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('.get:defaultTargetDirectorySegments', () => {
    describe('when called as is', () => {
      test('should be fixed value', () => {
        const expected = [
          '.claude',
          'skills',
        ]

        const received = HoraSkillsCli.defaultTargetDirectorySegments

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('.buildPathSteps()', () => {
    describe('should be every step from the base path down to the target path', () => {
      const cases = [
        {
          input: {
            basePath: '/consumer',
            targetPath: '/consumer/.claude/skills',
          },
          expected: [
            '/consumer/.claude',
            '/consumer/.claude/skills',
          ],
        },
        {
          input: {
            basePath: '/consumer/.claude',
            targetPath: '/consumer/.claude/skills',
          },
          expected: [
            '/consumer/.claude/skills',
          ],
        },
        {
          input: {
            basePath: '/consumer',
            targetPath: '/consumer',
          },
          expected: [],
        },
      ]

      test.each(cases)('targetPath: $input.targetPath', ({ input, expected }) => {
        const received = HoraSkillsCli.buildPathSteps(input)

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#dispatch()', () => {
    describe('should dispatch to the command', () => {
      const cases = [
        {
          input: {
            args: [
              'install',
            ],
          },
          expected: 'runInstall',
        },
        {
          input: {
            args: [
              'list',
            ],
          },
          expected: 'runCatalog',
        },
        {
          input: {
            args: [
              'uninstall',
            ],
          },
          expected: 'runUninstall',
        },
        {
          input: {
            args: [
              'help',
            ],
          },
          expected: 'runHelp',
        },
        {
          input: {
            args: [],
          },
          expected: 'runHelp',
        },
      ]

      test.each(cases)('args: $input.args', ({ input, expected }) => {
        const cli = HoraSkillsCli.create({
          args: input.args,
          workingDirectoryPath: '/consumer',
          logger: {
            log: () => {},
            error: () => {},
          },
        })

        const commandSpy = jest.spyOn(cli, expected)
          .mockReturnValue(0)

        cli.dispatch()

        expect(commandSpy)
          .toHaveBeenCalledWith()
      })
    })

    describe('should report a command it does not have', () => {
      const cases = [
        {
          input: {
            args: [
              'bogus',
            ],
          },
          expected: 'Unknown command: bogus',
        },
        {
          input: {
            args: [
              'installl',
            ],
          },
          expected: 'Unknown command: installl',
        },
      ]

      test.each(cases)('args: $input.args', ({ input, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: input.args,
          workingDirectoryPath: '/consumer',
          logger,
        })

        const received = cli.dispatch()

        expect(logger.error)
          .toHaveBeenCalledWith(expected)
        expect(received)
          .toBe(1)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#runInstall()', () => {
    describe('should install the distributed skills', () => {
      const cases = [
        {
          override: {
            installResult: {
              installedSkillNames: [
                'hor-query-resolver',
              ],
              removedSkillNames: [],
            },
          },
          expected: 'Installed 1 skills into /consumer/.claude/skills',
        },
        {
          override: {
            installResult: {
              installedSkillNames: [
                'hor-naming',
                'hor-jsdoc',
              ],
              removedSkillNames: [
                'hor-css',
              ],
            },
          },
          expected: 'Installed 2 skills into /consumer/.claude/skills',
        },
      ]

      test.each(cases)('installedSkillNames: $override.installResult.installedSkillNames', ({ override, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        jest.spyOn(SkillsInstaller.prototype, 'install')
          .mockReturnValue(override.installResult)

        const received = cli.runInstall()

        expect(logger.log)
          .toHaveBeenCalledWith(expected)
        expect(received)
          .toBe(0)
      })
    })

    describe('should install nothing when the installation directory is reached through a symbolic link', () => {
      test('args: install', () => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(cli, 'verifyPaths')
          .mockReturnValue(1)

        const installSpy = jest.spyOn(SkillsInstaller.prototype, 'install')
          .mockReturnValue({
            installedSkillNames: [],
            removedSkillNames: [],
          })

        const received = cli.runInstall()

        expect(received)
          .toBe(1)
        expect(installSpy)
          .not
          .toHaveBeenCalled()
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#run()', () => {
    describe('should report what a command raises, instead of letting it escape', () => {
      const cases = [
        {
          override: {
            error: new Error('ENOTDIR: not a directory, scandir \'/consumer/.claude/skills\''),
          },
          expected: 'ENOTDIR: not a directory, scandir \'/consumer/.claude/skills\'',
        },
        {
          override: {
            error: new Error('EACCES: permission denied, mkdir \'/consumer/.claude/skills\''),
          },
          expected: 'EACCES: permission denied, mkdir \'/consumer/.claude/skills\'',
        },
      ]

      test.each(cases)('error: $override.error.message', ({ override, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        jest.spyOn(cli, 'dispatch')
          .mockImplementation(() => {
            throw override.error
          })

        const received = cli.run()

        expect(received)
          .toBe(1)
        expect(logger.error)
          .toHaveBeenCalledWith(expected)
      })
    })

    describe('should be the exit code of the command it dispatched', () => {
      const cases = [
        {
          override: {
            exitCode: 0,
          },
        },
        {
          override: {
            exitCode: 1,
          },
        },
      ]

      test.each(cases)('exitCode: $override.exitCode', ({ override }) => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(cli, 'dispatch')
          .mockReturnValue(override.exitCode)

        const received = cli.run()

        expect(received)
          .toBe(override.exitCode)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#reportFailure()', () => {
    describe('should report the failure and fail', () => {
      const cases = [
        {
          input: {
            error: new Error('EROFS: read-only file system'),
          },
          expected: 'EROFS: read-only file system',
        },
      ]

      test.each(cases)('error: $input.error.message', ({ input, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        const received = cli.reportFailure(input)

        expect(received)
          .toBe(1)
        expect(logger.error)
          .toHaveBeenCalledWith(expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('.buildFailureMessage()', () => {
    describe('should be the message of the error', () => {
      const cases = [
        {
          input: {
            error: new Error('EACCES: permission denied'),
          },
          expected: 'EACCES: permission denied',
        },
        {
          input: {
            error: new Error('ENOENT: no such file, open \'/consumer/.claude/スキル\''),
          },
          expected: 'ENOENT: no such file, open \'/consumer/.claude/スキル\'',
        },
      ]

      test.each(cases)('error: $input.error.message', ({ input, expected }) => {
        const received = HoraSkillsCli.buildFailureMessage(input)

        expect(received)
          .toBe(expected)
      })
    })

    describe('should drop the characters a terminal acts on', () => {
      const cases = [
        {
          input: {
            error: new Error('EACCES: denied, rm \'/consumer/.claude/skills/\u001b[2Jhora\''),
          },
          expected: 'EACCES: denied, rm \'/consumer/.claude/skills/?[2Jhora\'',
        },
        {
          input: {
            error: new Error('ENOENT: no such file\u0000\u007f'),
          },
          expected: 'ENOENT: no such file??',
        },
      ]

      test.each(cases)('error: $input.error.message', ({ input, expected }) => {
        const received = HoraSkillsCli.buildFailureMessage(input)

        expect(received)
          .toBe(expected)
      })
    })

    describe('should be the value itself when it is not an error', () => {
      const cases = [
        {
          input: {
            error: 'raised a string',
          },
          expected: 'raised a string',
        },
        {
          input: {
            error: null,
          },
          expected: 'null',
        },
      ]

      test.each(cases)('error: $input.error', ({ input, expected }) => {
        const received = HoraSkillsCli.buildFailureMessage(input)

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('.buildPrintableCharacter()', () => {
    describe('should be the character itself when a terminal prints it', () => {
      const cases = [
        {
          input: {
            character: 'a',
          },
        },
        {
          input: {
            character: ' ',
          },
        },
        {
          input: {
            character: 'ス',
          },
        },
      ]

      test.each(cases)('character: $input.character', ({ input }) => {
        const received = HoraSkillsCli.buildPrintableCharacter(input)

        expect(received)
          .toBe(input.character)
      })
    })

    describe('should stand in for the character when a terminal acts on it', () => {
      const cases = [
        {
          input: {
            character: '\u001b',
          },
        },
        {
          input: {
            character: '\u0000',
          },
        },
        {
          input: {
            character: '\u007f',
          },
        },
        {
          input: {
            character: '\n',
          },
        },
      ]

      test.each(cases)('codePoint: $input.character.codePointAt', ({ input }) => {
        const received = HoraSkillsCli.buildPrintableCharacter(input)

        expect(received)
          .toBe('?')
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#buildSkillsInstaller()', () => {
    describe('should build the installer with the working and the target directory', () => {
      const cases = [
        {
          input: {
            args: [
              'install',
            ],
            workingDirectoryPath: '/consumer',
          },
          expected: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/.claude/skills',
          },
        },
        {
          input: {
            args: [
              'install',
              '--dir',
              'tools/skills',
            ],
            workingDirectoryPath: '/consumer',
          },
          expected: {
            workingDirectoryPath: '/consumer',
            targetDirectoryPath: '/consumer/tools/skills',
          },
        },
      ]

      test.each(cases)('args: $input.args', ({ input, expected }) => {
        const cli = HoraSkillsCli.create({
          args: input.args,
          workingDirectoryPath: input.workingDirectoryPath,
          logger: {
            log: () => {},
            error: () => {},
          },
        })

        const createSkillsInstallerSpy = jest.spyOn(HoraSkillsCli, 'createSkillsInstaller')
          .mockReturnValue(null)

        cli.buildSkillsInstaller()

        expect(createSkillsInstallerSpy)
          .toHaveBeenCalledWith({
            workingDirectoryPath: expected.workingDirectoryPath,
            targetDirectoryPath: expected.targetDirectoryPath,
          })
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#buildTargetDirectoryPath()', () => {
    describe('should be the .claude/skills of the working directory', () => {
      const cases = [
        {
          input: {
            workingDirectoryPath: '/consumer',
          },
          expected: '/consumer/.claude/skills',
        },
        {
          input: {
            workingDirectoryPath: '/tmp/consumer',
          },
          expected: '/tmp/consumer/.claude/skills',
        },
      ]

      test.each(cases)('workingDirectoryPath: $input.workingDirectoryPath', ({ input, expected }) => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: input.workingDirectoryPath,
          logger: {
            log: () => {},
            error: () => {},
          },
        })

        const received = cli.buildTargetDirectoryPath()

        expect(received)
          .toBe(expected)
      })
    })

    describe('should resolve the given directory against the working directory', () => {
      const cases = [
        {
          input: {
            args: [
              'install',
              '--dir',
              'skills',
            ],
          },
          expected: '/consumer/skills',
        },
        {
          input: {
            args: [
              'install',
              '--dir',
              '/tmp/skills',
            ],
          },
          expected: '/tmp/skills',
        },
      ]

      test.each(cases)('args: $input.args', ({ input, expected }) => {
        const cli = HoraSkillsCli.create({
          args: input.args,
          workingDirectoryPath: '/consumer',
          logger: {
            log: () => {},
            error: () => {},
          },
        })

        const received = cli.buildTargetDirectoryPath()

        expect(received)
          .toBe(path.normalize(expected))
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#buildVerifiedBaseDirectoryPath()', () => {
    describe('should be the working directory when no directory is given', () => {
      const cases = [
        {
          input: {
            args: [
              'install',
            ],
          },
          expected: '/consumer',
        },
        {
          input: {
            args: [
              'uninstall',
            ],
          },
          expected: '/consumer',
        },
      ]

      test.each(cases)('args: $input.args', ({ input, expected }) => {
        const cli = HoraSkillsCli.create({
          args: input.args,
          workingDirectoryPath: '/consumer',
        })

        const received = cli.buildVerifiedBaseDirectoryPath()

        expect(received)
          .toBe(expected)
      })
    })

    describe('should be the given directory when one is given', () => {
      const cases = [
        {
          input: {
            args: [
              'install',
              '--dir',
              'tools/skills',
            ],
          },
          expected: '/consumer/tools/skills',
        },
        {
          input: {
            args: [
              'install',
              '--dir=/opt/skills',
            ],
          },
          expected: '/opt/skills',
        },
      ]

      test.each(cases)('args: $input.args', ({ input, expected }) => {
        const cli = HoraSkillsCli.create({
          args: input.args,
          workingDirectoryPath: '/consumer',
        })

        const received = cli.buildVerifiedBaseDirectoryPath()

        expect(received)
          .toBe(path.normalize(expected))
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#isSymbolicLink()', () => {
    describe('should be what lstat tells of the path', () => {
      const cases = [
        {
          override: {
            isSymbolicLink: true,
          },
          expected: true,
        },
        {
          override: {
            isSymbolicLink: false,
          },
          expected: false,
        },
      ]

      test.each(cases)('isSymbolicLink: $override.isSymbolicLink', ({ override, expected }) => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(fs, 'lstatSync')
          .mockReturnValue(
            /** @type {*} */ ({
              isSymbolicLink: () => override.isSymbolicLink,
            })
          )

        const received = cli.isSymbolicLink({
          filePath: '/consumer/.claude',
        })

        expect(received)
          .toBe(expected)
      })
    })

    describe('should be false when the path does not exist', () => {
      test('filePath: /consumer/.claude', () => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(fs, 'lstatSync')
          .mockImplementation(() => {
            throw new Error('ENOENT')
          })

        const received = cli.isSymbolicLink({
          filePath: '/consumer/.claude',
        })

        expect(received)
          .toBe(false)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#isReachedThroughSymbolicLink()', () => {
    describe('should be true when any step of the path is a symbolic link', () => {
      const cases = [
        {
          override: {
            linkedPaths: [
              '/consumer/.claude',
            ],
          },
          expected: true,
        },
        {
          override: {
            linkedPaths: [
              '/consumer/.claude/skills',
            ],
          },
          expected: true,
        },
        {
          override: {
            linkedPaths: [],
          },
          expected: false,
        },
        {
          override: {
            linkedPaths: [
              '/consumer/tools',
            ],
          },
          expected: false,
        },
      ]

      test.each(cases)('linkedPaths: $override.linkedPaths', ({ override, expected }) => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(cli, 'isSymbolicLink')
          .mockImplementation(({ filePath }) => override.linkedPaths.includes(filePath))

        const received = cli.isReachedThroughSymbolicLink({
          basePath: '/consumer',
          targetPath: '/consumer/.claude/skills',
        })

        expect(received)
          .toBe(expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#collectLinkedTargetDirectoryPaths()', () => {
    describe('should be the installation directory when it is reached through a symbolic link', () => {
      const cases = [
        {
          override: {
            targetDirectoryPath: '/consumer/.claude/skills',
            linkedTargetDirectoryPaths: [
              '/consumer/.claude/skills',
            ],
          },
          expected: [
            '/consumer/.claude/skills',
          ],
        },
        {
          override: {
            targetDirectoryPath: '/consumer/.claude/skills',
            linkedTargetDirectoryPaths: [],
          },
          expected: [],
        },
      ]

      test.each(cases)('linkedTargetDirectoryPaths: $override.linkedTargetDirectoryPaths', ({ override, expected }) => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(cli, 'buildTargetDirectoryPath')
          .mockReturnValue(override.targetDirectoryPath)
        jest.spyOn(cli, 'isReachedThroughSymbolicLink')
          .mockImplementation(({ targetPath }) =>
            override.linkedTargetDirectoryPaths.includes(targetPath)
          )

        const received = cli.collectLinkedTargetDirectoryPaths()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#verifyPaths()', () => {
    describe('should refuse an installation directory reached through a symbolic link', () => {
      const cases = [
        {
          override: {
            linkedTargetDirectoryPaths: [
              '/consumer/.claude/skills',
            ],
          },
          expected: [
            '/consumer/.claude/skills is reached through a symbolic link.',
            'Nothing was changed. An installation carries nothing through a link — replace it, or give --dir the directory it resolves to.',
          ],
        },
      ]

      test.each(cases)('linkedTargetDirectoryPaths: $override.linkedTargetDirectoryPaths', ({ override, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        jest.spyOn(cli, 'collectLinkedTargetDirectoryPaths')
          .mockReturnValue(override.linkedTargetDirectoryPaths)
        jest.spyOn(cli, 'collectLinkedManifestFilePaths')
          .mockReturnValue([])

        const received = cli.verifyPaths()

        expect(received)
          .toBe(1)
        expect(logger.error)
          .toHaveBeenNthCalledWith(1, expected[0])
        expect(logger.error)
          .toHaveBeenNthCalledWith(2, expected[1])
      })
    })

    describe('should pass when the installation directory is reached through none', () => {
      test('linkedTargetDirectoryPaths: []', () => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        jest.spyOn(cli, 'collectLinkedTargetDirectoryPaths')
          .mockReturnValue([])
        jest.spyOn(cli, 'collectLinkedManifestFilePaths')
          .mockReturnValue([])

        const received = cli.verifyPaths()

        expect(received)
          .toBe(0)
        expect(logger.error)
          .not
          .toHaveBeenCalled()
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#buildManifestFilePath()', () => {
    describe('should be the record below the working directory', () => {
      const cases = [
        {
          input: {
            args: [
              'install',
            ],
          },
          expected: '/consumer/.hora/hora-skills-ort-renchan.json',
        },
        {
          input: {
            args: [
              'install',
              '--dir',
              'tools/skills',
            ],
          },
          expected: '/consumer/.hora/hora-skills-ort-renchan.json',
        },
      ]

      test.each(cases)('args: $input.args', ({ input, expected }) => {
        const cli = HoraSkillsCli.create({
          args: input.args,
          workingDirectoryPath: '/consumer',
        })

        const received = cli.buildManifestFilePath()

        expect(received)
          .toBe(path.normalize(expected))
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#collectLinkedManifestFilePaths()', () => {
    describe('should be the record when it is reached through a symbolic link', () => {
      const cases = [
        {
          override: {
            linkedPaths: [
              '/consumer/.hora',
            ],
          },
          expected: [
            '/consumer/.hora/hora-skills-ort-renchan.json',
          ],
        },
        {
          override: {
            linkedPaths: [
              '/consumer/.hora/hora-skills-ort-renchan.json',
            ],
          },
          expected: [
            '/consumer/.hora/hora-skills-ort-renchan.json',
          ],
        },
        {
          override: {
            linkedPaths: [],
          },
          expected: [],
        },
      ]

      test.each(cases)('linkedPaths: $override.linkedPaths', ({ override, expected }) => {
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(cli, 'isSymbolicLink')
          .mockImplementation(({ filePath }) => override.linkedPaths.includes(filePath))

        const received = cli.collectLinkedManifestFilePaths()

        expect(received)
          .toEqual(expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#verifyPaths()', () => {
    describe('should refuse a record reached through a symbolic link', () => {
      const cases = [
        {
          override: {
            linkedManifestFilePaths: [
              '/consumer/.hora/hora-skills-ort-renchan.json',
            ],
          },
          expected: '/consumer/.hora/hora-skills-ort-renchan.json is reached through a symbolic link.',
        },
      ]

      test.each(cases)('linkedManifestFilePaths: $override.linkedManifestFilePaths', ({ override, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'install',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        jest.spyOn(cli, 'collectLinkedTargetDirectoryPaths')
          .mockReturnValue([])
        jest.spyOn(cli, 'collectLinkedManifestFilePaths')
          .mockReturnValue(override.linkedManifestFilePaths)

        const received = cli.verifyPaths()

        expect(received)
          .toBe(1)
        expect(logger.error)
          .toHaveBeenNthCalledWith(1, expected)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#runCatalog()', () => {
    describe('should print each distributed skill', () => {
      const cases = [
        {
          override: {
            distributedSkillNames: [
              'hor-query-resolver',
            ],
          },
          expected: '1 skills distributed',
        },
        {
          override: {
            distributedSkillNames: [
              'hor-query-resolver',
              'hor-stub-api',
            ],
          },
          expected: '2 skills distributed',
        },
      ]

      test.each(cases)('distributedSkillNames: $override.distributedSkillNames', ({ override, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'list',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        jest.spyOn(SkillsInstaller.prototype, 'collectDistributedSkillNames')
          .mockReturnValue(override.distributedSkillNames)

        const received = cli.runCatalog()

        expect(logger.log)
          .toHaveBeenCalledWith(expected)
        expect(received)
          .toBe(0)
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#runUninstall()', () => {
    describe('should report the removed skills', () => {
      const cases = [
        {
          override: {
            uninstallResult: {
              removedSkillNames: [
                'hor-query-resolver',
              ],
            },
          },
          expected: 'Removed 1 skills from /consumer/.claude/skills',
        },
        {
          override: {
            uninstallResult: {
              removedSkillNames: [],
            },
          },
          expected: 'Removed 0 skills from /consumer/.claude/skills',
        },
      ]

      test.each(cases)('removedSkillNames: $override.uninstallResult.removedSkillNames', ({ override, expected }) => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'uninstall',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        jest.spyOn(SkillsInstaller.prototype, 'uninstall')
          .mockReturnValue(override.uninstallResult)

        const received = cli.runUninstall()

        expect(logger.log)
          .toHaveBeenCalledWith(expected)
        expect(received)
          .toBe(0)
      })
    })

    describe('should remove nothing when the installation directory is reached through a symbolic link', () => {
      test('args: uninstall', () => {
        const cli = HoraSkillsCli.create({
          args: [
            'uninstall',
          ],
          workingDirectoryPath: '/consumer',
        })

        jest.spyOn(cli, 'verifyPaths')
          .mockReturnValue(1)

        const uninstallSpy = jest.spyOn(SkillsInstaller.prototype, 'uninstall')
          .mockReturnValue({
            removedSkillNames: [],
          })

        const received = cli.runUninstall()

        expect(received)
          .toBe(1)
        expect(uninstallSpy)
          .not
          .toHaveBeenCalled()
      })
    })
  })
})

describe('HoraSkillsCli', () => {
  describe('#runHelp()', () => {
    describe('when called as is', () => {
      test('should print the usage text', () => {
        const logger = {
          log: jest.fn(),
          error: jest.fn(),
        }
        const cli = HoraSkillsCli.create({
          args: [
            'help',
          ],
          workingDirectoryPath: '/consumer',
          logger,
        })

        const received = cli.runHelp()

        expect(logger.log)
          .toHaveBeenCalledWith(HoraSkillsCli.usageText)
        expect(received)
          .toBe(0)
      })
    })
  })
})
