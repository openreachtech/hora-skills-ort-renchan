# Running the environment from Windows

**Opt-in. Read this only if someone has actually asked for Windows-native scripts.** The default is
Ubuntu or WSL2, the `.sh` scripts are the real ones, and you need none of this to build the
environment. Referenced from the machine assumptions in [SKILL.md](../SKILL.md).

## Why there is a default at all

Two sets of scripts means making every change twice. Sooner or later one of them gets missed. It
fails like this: *"the environment comes up ninety percent of the way, but only on Windows"* — which
is exactly what this skill exists to prevent. So write the second set only when someone has decided
they need it, and let them carry the cost.

**First, look for a way to avoid it.** Anything you move into a container stops depending on the OS.
`docker compose` behaves the same everywhere. Only the host-side scripts differ. A stack in shape A
— client, edge and application all in containers
([edge-and-proxy.md](./edge-and-proxy.md)) — barely needs host-side scripts at all. That is the real
fix.

## What differs per machine

| | Linux / WSL2 | macOS | Plain Windows |
| --- | --- | --- | --- |
| bash | 4 or later | **3.2** — no `declare -A`, `mapfile`, `${x,,}` | none |
| core tools | GNU | **BSD** — `sed -i` needs an argument, and there is no `timeout`, `date -d` or `grep -P` | none |
| memory ceiling | the machine's | the Docker VM's share | the WSL2 VM's share, **half the machine by default** |
| bind-mount speed | native | slower, through VirtioFS | very slow under `/mnt/c`. Keep the repository on the Linux side |
| line endings | LF | LF | CRLF sneaks in through `core.autocrlf` |
| `/etc/hosts` | stays as you left it | stays as you left it | WSL2 rewrites it by default |

The macOS column is why the scripts target bash 3.2 with no GNU-only options, even though nobody
chooses 3.2 on purpose.

## Why plain Windows cannot run the `.sh` scripts

**The problem is the host-side scripts, not the stack.** Everything compose starts behaves the same
on every OS. The five scripts are what will not run: `up`, `start`, `seed`, `clean` and `down`.

| What they use | For | On plain Windows |
| --- | --- | --- |
| shell syntax | `set -euo pipefail`, `trap ... EXIT`, `[[ ]]` | no bash. PowerShell has close equivalents, so this is a rewrite, not a port |
| background start, and the PID | starting the application and daemons, saving PIDs, stopping them in `down.sh` | `Start-Process` and `Stop-Process` work, but **Windows has no SIGTERM**. You can only force a kill |
| `trap ... EXIT` | making sure a failed build leaves nothing half-built | `try/finally` is close, but does not cover as much as `EXIT` |
| host commands | `curl` to wait for health, `grep` / `sed` / `awk` for logs | `curl.exe` exists. `wget` is an alias for `Invoke-WebRequest` with different arguments. The rest are missing |
| file modes | config permissions, the executable bit | NTFS has neither, and `chmod` does nothing |
| line endings | scripts, and configs mounted into containers | CRLF shows up inside the container as `bash\r: bad interpreter` |

**The second row is the one you cannot write your way around.** `down.sh` stops the processes before
the containers, and that only helps if the stop is graceful. Where you can only force a kill, a
worker dies holding its connections and the ordering buys you nothing. Say so, rather than letting
it look the same.

**Git Bash mostly works, and fails quietly.** MSYS rewrites paths on their way to `docker` (turn it
off with `MSYS_NO_PATHCONV=1`), and processes and signals are still Windows'. Worth knowing about.
Not a setup to support.

## What to require, if you do write them

- **PowerShell 7 or later.** Windows PowerShell 5.1 handles `Invoke-WebRequest` and errors
  differently, so it is out of scope. Say this at the top of every script.
- **The operator's commands do not change.** `up.ps1`, `start.ps1`, `seed.ps1`, `clean.ps1` and
  `down.ps1` — same names, same jobs, same closing message as the `.sh` scripts. One intention, one
  command, on either OS.
- **The `.sh` scripts stay the real ones.** Add a step there, then mirror it in the `.ps1` scripts
  **in the same change**. Never one without the other.
- **Write down the differences you cannot remove**, at the top of the script and in the closing
  message. Never let it behave differently in silence.
- **Ship nothing you have not run.** Record which Windows build and which PowerShell version you
  tested on. A script nobody has run is not finished — the same rule as checking from the side that
  uses it.

## The same job, in each shell

| Job | POSIX (the real one) | PowerShell 7 |
| --- | --- | --- |
| stop on the first failure | `set -e` | `$ErrorActionPreference = 'Stop'`, plus checking `$LASTEXITCODE` after **every** native command |
| fail when a pipe fails | `set -o pipefail` | **nothing equivalent.** Split the pipeline into steps and check `$LASTEXITCODE` at each one |
| clean up on abort | `trap ... EXIT` | `try { } finally { }` |
| start in the background, keep the PID | `cmd >log 2>&1 & echo $!` | `Start-Process -PassThru -RedirectStandardOutput -RedirectStandardError`, then `$p.Id`. **The two streams cannot go to one file**, so keep two logs per process |
| stop a process | `kill` (SIGTERM) | `Stop-Process` (forced). For a graceful stop, give the application its own signal — a file, an endpoint, a queue message |
| wait for health | `curl` in a loop | `Invoke-WebRequest -UseBasicParsing` in a loop, catching connection failures with `try/catch` |
| measure a deadline | count elapsed seconds | `[Diagnostics.Stopwatch]` |
| find the script's folder | a path relative to the script | `$PSScriptRoot` |

## What one script looks like

```powershell
#Requires -Version 7.0
# The real version is start.sh. Change both in the same commit.
# Difference we cannot remove: stop is a forced kill, because Windows has no SIGTERM.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null

try {
  docker compose -f (Join-Path $PSScriptRoot 'docker/compose.yaml') up -d
  if ($LASTEXITCODE -ne 0) { throw 'compose up failed' }

  # wait for health from the host — the side that will use it
  $deadline = [Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    try {
      Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:18080/healthz' | Out-Null
      break
    } catch {
      if ($deadline.Elapsed.TotalSeconds -gt 120) {
        throw 'the edge never answered. docker compose logs edge'
      }
      Start-Sleep -Seconds 2
    }
  }

  $app = Start-Process -PassThru -FilePath 'node' -ArgumentList 'server/index.js' `
    -RedirectStandardOutput (Join-Path $logs 'app.out.log') `
    -RedirectStandardError  (Join-Path $logs 'app.err.log')
  $app.Id | Set-Content (Join-Path $logs 'app.pid')
}
catch {
  & (Join-Path $PSScriptRoot 'down.ps1')   # never clean.ps1
  throw
}

Write-Host "open http://127.0.0.1:18080/  |  logs: e2e/logs  |  stop: e2e/down.ps1"
```

Notice the two log files for one process, the deadline measured with a stopwatch, the health check
made from the host, and the abort path calling `down`, never `clean`. Those are the same rules the
`.sh` scripts follow.

## Recording what you tested

Keep this next to the scripts, and update it whenever they change:

```
Verified on: Windows 11 23H2 / PowerShell 7.4.6 / Docker Desktop 29.5.2
Date:        2026-08-22
Scope:       up / start / seed / clean / down, full rebuild from nothing
Not covered: graceful shutdown — Stop-Process is a forced kill
```

A note with no version and no date is not a record. If nobody can say which build it ran on, it has
not been tested.
