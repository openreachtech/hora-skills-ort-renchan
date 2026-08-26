#!/usr/bin/env node

import HoraSkillsCli from './HoraSkillsCli.js'

process.exitCode = HoraSkillsCli.create({
  args: process.argv.slice(2),
})
  .run()
