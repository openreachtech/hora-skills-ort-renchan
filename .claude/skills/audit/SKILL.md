---
name: audit
description: "Repository-specific check that every skill under kit/skills/ sits one level below the backend/ domain directory, carries its `hor-` prefix, and declares a `name:` equal to its own folder name — the same rules the flatten build aborts on, reported all at once with a non-zero exit for CI. Use before committing a new, renamed or moved skill. It reports only; it renames and moves nothing, and it checks no frontmatter field other than `name:`."
---

# Audit

A skill's folder name is its `name:` and the folder name it is installed under — one string, three places. Consuming repositories install every skill of this library, and of its sibling libraries — `hora-skills-ort-core` (`core/`, `hoc-`) and `hora-skills-ort-furo` (`frontend/`, `hof-`) — side by side under `.claude/skills/`, so all of those names live in **one flat namespace**, and the source layout is what protects it: the `backend/` domain directory, one level of skill folders inside it, the `hor-` prefix that no sibling library uses, and a filesystem that will not hold two folders of one name in one directory.

That protection is only as real as the layout. A skill placed one directory deeper, a `name:` edited without renaming its folder, a folder renamed without editing `name:` — none of these look wrong in the file they occur in, and each breaks the one guarantee the whole scheme rests on. This audit makes the state of the layout visible from outside any single file.

## What is checked

For every entry directly under `kit/skills/backend/`:

- **A missing `backend/` directory, or an entry directly under `kit/skills/` that is not it, is a failure.** This library holds the one domain, and an entry outside it carries no prefix of this library and has no place in the output.
- **An entry under the domain that is not a directory, or a directory with no `SKILL.md` directly inside it, is a failure.** Only skill folders belong there, and a folder with no `SKILL.md` installs nothing.
- **A `SKILL.md` anywhere below a skill folder's own top level is a failure.** The one-level layout is what makes the folder name the skill name; a skill nested inside another has no name of its own. A skill folder's `references/` and `scripts/` subdirectories are its own files, never more skills.
- **A folder name that is not `hoc-`/`hor-`/`hof-` followed by 1–60 characters of `[a-z0-9-]` is a failure.** The name is joined onto `dist/skills/` as a path segment, so a value carrying `/` or `..` would land the folder somewhere else entirely; 64 characters is the limit an installed skill name has to stay within, of which the prefix takes 4. A single case keeps two names from folding onto one folder on a case-insensitive filesystem (macOS, Windows default).
- **A prefix that does not match the folder's domain is a failure** — `hof-` under `backend/` makes the name lie about where the skill lives, and it claims a name that belongs to the Furo frontend library; it is the prefix, not the directory, that a consuming repository ever sees. All three prefixes pass the name rule, so this is the check that keeps a sibling library's skill from being published by this one.
- **A `SKILL.md` with no parsable `name:` is a failure**, and **a `name:` that differs from its folder name is a failure.** This last one is the check everything else rests on: the two are one string by convention, and only an enforced comparison keeps them one string in fact.

Duplicate names are not checked, because they cannot occur. Two skills of this library would need two folders of one name in one directory, and a sibling library's skills carry a prefix of their own — so once each `name:` is confirmed equal to its folder name, uniqueness follows from the filesystem rather than from a comparison.

Nothing else is checked here. Description length, quoting, and the rest of how a `SKILL.md` is written belong to the skill-writing convention, which owns them.

The walk starts at `kit/skills/` and goes nowhere else. This repository's own skills under `.claude/skills/` — this audit and the flatten build — are tooling for maintaining the library, not library content: they are never installed into a consuming repository, so they never enter the flat namespace being protected here, and none of the rules above apply to them. That is why they are free to carry an unprefixed one-word name of their own.

These are exactly the failures the flatten build aborts on, and they are stated identically in both places on purpose. The build enforces them because a violation would destroy or misplace its output; this audit enforces them so a CI job can reject the commit before anyone runs a build. Neither is a substitute for the other, so the rule is written out in both rather than shared through an import that would tie one skill's script to the other's — and a test pins the two copies of the name pattern, and the two copies of the prefix table, to each other, so changing either in one place alone fails.

Every problem found is reported, grouped by kind, in one run: fixing a layout mistake often surfaces the next one, and a report that stops at the first failure would take as many runs as there are mistakes.

## Running

```
npm run skill-names
```

Or directly:

```
node .claude/skills/audit/scripts/audit.js
```

It exits `0` when every skill sits one level under the domain directory and declares a `name:` equal to its folder name, and `1` on any of the failures above, so it can gate a commit or a CI job.

## Resolving a mismatch

For a `name:` that disagrees with its folder name, decide which of the two is the name the skill should ship under, then make the other match it. The folder name is what a consuming repository installs and invokes, so the choice is about the installed command name, not about tidiness in the tree.

For a skill in the wrong place — nested too deep, or carrying a prefix this library does not own — move the folder to the library its prefix names, or change both the prefix and `name:` to `hor-`. Renaming is the deliberate part: an installed skill's name is what consuming repositories invoke, so a rename is a breaking change for them.

Renaming a skill breaks no references inside this library: the skill-writing convention prohibits referring to another skill by name or by relative path, requiring a descriptive reference to the concept instead. That prohibition exists so a rename stays local to the one folder.
