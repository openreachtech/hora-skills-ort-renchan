# Network exposure & logging (checks 4–5)

Externally reachable ports / processes, and production logging (redaction / PII). Referenced from
[SKILL.md](../SKILL.md).

## 4. Exposed ports / bind address / datastore exposure

Find every port reachable from outside and confirm each is intended. Cover container definitions, the
process/service manager, and the server's bind address. The key risk is a **datastore or internal
service bound to a public interface** (`0.0.0.0`) instead of loopback / a private network.

```bash
# Container / orchestration definitions:
find . -maxdepth 3 \( -iname "Dockerfile*" -o -iname "docker-compose*" -o -iname "compose*.y*ml" -o -iname "*.k8s.y*ml" \) -not -path "*/node_modules/*" 2>/dev/null
grep -rniE "^EXPOSE |ports:|- \"?[0-9]+:[0-9]+|0\.0\.0\.0" Dockerfile* docker-compose* compose*.y*ml 2>/dev/null
# What the app / services listen on (bind host + port). Also check the process/service manager
# config the project uses (e.g. a PM2/systemd/procfile-style file), if present:
git grep -nE "listen\(|\.PORT|host:|hostname|0\.0\.0\.0|127\.0\.0\.1" -- '*.js' '*.ts' '*.cjs' | head
# Datastore host/port settings in env files (should point at localhost / a private host):
grep -rniE "REDIS_HOST|REDIS_PORT|DB_HOST|DB_PORT|DATABASE_HOST|DATABASE_PORT|MONGO|AMQP|QUEUE_HOST" .env* 2>/dev/null
```

- **FINDING (HIGH):** a datastore (DB / Redis / Mongo / message queue) or an internal-only service
  published on `0.0.0.0` / a public interface, or a container `ports:` mapping binding a host port
  with no restriction. Datastores should bind to loopback / a private network only.
- **FINDING (MEDIUM):** an app port exposed more broadly than needed, or an `EXPOSE` of a debug /
  admin port.
- **N/A:** no container / manager files (note it) — but still check the server bind address.
- List every listening port + its bind scope so a human can confirm each is intentional.

## 5. Production logging via a redacting logger; no PII

Production logs should flow through the project's **structured / redacting logger** (whatever it
uses), not raw `console.*`. Wherever logging does **not** go through that logger, confirm **no PII is
written** — email, password, tokens, phone, full name are forbidden; opaque ids and non-personal
identifiers are OK.

```bash
# First identify the logger the project uses (pino, winston, bunyan, a wrapper, etc.):
git grep -nE "require\(['\"].*log.*['\"]\)|from ['\"].*log.*['\"]|pino|winston|bunyan|createLogger" -- '*.js' '*.ts' '*.cjs' | head
# Raw console logging on production code paths (exclude tests):
git grep -nE "console\.(log|info|warn|error|debug)" -- '*.js' '*.ts' '*.cjs' \
  | grep -viE "test|\.spec\.|__tests__|/scripts/|/bin/"
# PII appearing near a log call:
git grep -nE "(console|logger|log|error|warn|info)\b[^\"'\`]{0,80}\b(email|password|passwd|accessToken|token|secret|phone|fullName|firstName|lastName|ssn|creditCard)\b" -- '*.js' '*.ts' '*.cjs' \
  | grep -viE "test|__tests__" | head
```

- **FINDING (MEDIUM):** raw `console.*` on a production code path (bypasses the logger's redaction /
  sinks). Recommend routing through the project logger.
- **FINDING (HIGH):** any log call (logger or not) that writes **PII** (email, password, token,
  phone, name, and similar). Recommend logging a non-personal id instead.
- **PASS:** production logging goes through the redacting logger and no PII is logged; logging ids
  only is fine.
- If the project's framework logs via an injected logger, treat that as compliant — but still scan
  those calls for PII in their payloads.
