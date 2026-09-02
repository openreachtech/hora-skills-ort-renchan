# @openreachtech/hora-skills-ort-renchan

A distribution package of the renchan backend skills for developing with Hora Kit.

## Concept

This package ships **skills only** — there is no library to `import`, and the one executable it carries exists to install those skills. A skill is a directory holding a `SKILL.md`, plus optional `references/` and `scripts/`, that Claude Code loads and invokes as `/<name>`. Installing this package into a repository puts the conventions and procedures Open Reach Tech develops with in front of the agent working on that repository.

31 skills are distributed, all of the `backend` domain: renchan-based Node backends. The three-character prefix on every name is the domain, so a reader looking at one flat list of skills can tell at a glance which came from this package. Each domain is a package of its own, and a repository installs the ones it works in:

| Package | Prefix | Domain | Skills |
| :-- | :-- | :-- | --: |
| `@openreachtech/hora-skills-ort-core` | `hoc-` | `core` | 39 |
| `@openreachtech/hora-skills-ort-renchan` (this one) | `hor-` | `backend` | 31 |
| `@openreachtech/hora-skills-ort-furo` | `hof-` | `frontend` | 46 |

[**Skill catalog**](https://github.com/openreachtech/hora-skills-ort-renchan/blob/main/docs/skills.md) ([日本語](https://github.com/openreachtech/hora-skills-ort-renchan/blob/main/docs/skills.ja.md)) — every skill in this package with a one- or two-line summary, listed by the command name it is invoked by.

The source is organized at `kit/skills/backend/<name>/`, and `dist/` is the published build output: the same skill folders with the domain level dropped, which is the flat shape Claude Code expects. A skill folder's name is its `name:` and the folder name it installs as — one string throughout, so the name you see in the catalog is the command you type.

## Installation

Requires Node.js 20.0.0 or newer, the floor `engines` declares. The CI builds against the current LTS.

```sh
npm install -D @openreachtech/hora-skills-ort-renchan
```

This package ships no install script of its own, so adding it as a dependency installs the package and places nothing. Declare the command as your own project's `postinstall`, and `npm install` alone equips the repository:

```json
{
  "scripts": {
    "postinstall": "hora-skills-ort-renchan install"
  }
}
```

A project's own scripts are outside what npm holds back from v12 on, so this asks nothing of whoever clones the repository. `npx` is not needed here either: a lifecycle script runs with `node_modules/.bin` on its PATH.

The hook you just declared takes effect from the next `npm install` on, so run the command by hand for the first placement — and for a one-off, or a repository that is not yours to add a hook to:

```sh
npx --no hora-skills-ort-renchan install
```

**`--no` stops npx before it downloads**: the name is still resolved against the registry, but nothing is fetched, so neither the install script nor the bin of a stranger's package ever runs. Without it, a bin that is not installed becomes a fetch of whatever has been published under `hora-skills-ort-renchan`, an unscoped name this package does not hold.

Where the package is not a dependency at all — a one-off, or a repository that is not yours to add a hook to — name it in full instead: `npx --package=@openreachtech/hora-skills-ort-renchan hora-skills-ort-renchan install`. What is fetched is then a scoped name nobody else can publish under, which is the guarantee the unscoped bin name never carried.

## Usage

The skills land in your repository's `.claude/skills/`. Claude Code discovers them from there, and each becomes invocable by its own name — `/hor-query-resolver`, `/hor-sequelize-model`, `/hor-post-worker`. Installed skills sit side by side with your repository's own, in one flat list, which is what the `hor-` prefix is for.

### Installing more than one domain

Each of the three packages installs into the same `.claude/skills/`, and each records its own installation in `.hora/<package name>.json`. A run therefore removes only what that package installed, and leaves the other two alone:

```json
{
  "scripts": {
    "postinstall": "hora-skills-ort-renchan install && <another hora-skills package> install"
  }
}
```

Because a prefix belongs to exactly one package, and every skill's folder name is unique within its own package, no two installed skills can end up with the same name.

### Directories, not links

`.claude/`, and the `skills/` directory inside it, have to be directories of your repository rather than symbolic links. An installation verifies every step it is reached through, and finding a link at any of them it writes nothing and removes nothing. `.hora/hora-skills-ort-renchan.json`, the record of what was installed, is verified the same way: a link there would send the write to whatever it stands for and overwrite it.

An installation that carries nothing says why and ends with a failing exit code. Where the command runs as your project's own `postinstall`, that is what `npm install` reports; run on its own, `npx --no hora-skills-ort-renchan install` tells you the same.

A link is content of the repository rather than an instruction of whoever runs the command, so following one would let the repository decide where skills are written and, worse, where the skills of the previous run are removed from.

Where either points at a directory shared between repositories, name that directory instead — `npx --no hora-skills-ort-renchan install --dir <the directory it resolves to>` reaches the same state, and the link still makes the skills visible at `.claude/skills/`. A `--dir` is named by whoever runs the command, so it is taken as given.

### Keeping the installation current

The installed skills are this package's build output rather than source of your repository, so ignore them:

```gitignore
.claude/skills/hor-*/
.hora/
```

An `npm install` with no arguments re-runs your project's `postinstall`, so the skills follow along. Naming the package on the command line — `npm install @openreachtech/hora-skills-ort-renchan@latest` — does not, and neither does a repository without a hook. Run the command again yourself:

```sh
npx --no hora-skills-ort-renchan install
```

`install` is repeatable: it removes what the previous run installed — recorded in `.hora/hora-skills-ort-renchan.json` — along with any folder named after a skill this package distributes, before copying the current output. A renamed or dropped skill therefore leaves nothing behind, and a repository that had copied `dist/skills/` by hand is tidied up on its first run.

A skill your own repository authored is left alone, as long as its name is not one this package distributes. Carrying the `hor-` prefix is not enough to put it at risk — `hor-own-skill` is untouched — but naming it exactly after a distributed skill hands that name over to this package.

### Commands

| Command | What it does |
| :-- | :-- |
| `hora-skills-ort-renchan install` | Install every skill this package distributes, replacing the previously installed ones |
| `hora-skills-ort-renchan list` | Print the skills this package distributes, installing nothing |
| `hora-skills-ort-renchan uninstall` | Remove every skill this package installed, along with its record |
| `hora-skills-ort-renchan help` | Print the usage text |

`--dir <path>` installs into a directory other than `.claude/skills`.

## Contribution

Bug reports, feature requests, and code contributions are welcome.

Feel free to contact us through GitHub Issues.

```sh
git clone https://github.com/openreachtech/hora-skills-ort-renchan.git
cd hora-skills-ort-renchan
npm install
npm run lint
npm test
```

## License

This project is released under the Apache License 2.0.

For more details, please see [in the LICENSE file](./LICENSE).

## Developer

[Open Reach Tech Inc.](https://openreach.tech)

## Copyright

© 2026 Open Reach Tech Inc.
