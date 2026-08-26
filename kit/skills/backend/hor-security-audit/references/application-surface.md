# Application surface (checks 19–22)

File-upload validation, exposed unused / scaffold operations, GraphQL query depth / complexity, and
error-response leakage. Referenced from [SKILL.md](../SKILL.md).

## 19. File-upload validation (type + content + size)

Any endpoint that accepts an uploaded file must validate it in **three** ways. Checking only one
(commonly just size, or just the client-declared MIME type) is insufficient.

1. **Declared type allow-list** — accept only the MIME type(s) / extension(s) the feature needs.
2. **Content / magic-byte check** — verify the bytes actually match the claimed type. The client-sent
   MIME type and filename extension are attacker-controlled and trivially spoofed; a real check reads
   the file's magic number (e.g. `%PDF-` for PDF, `\x89PNG` for PNG, `PK\x03\x04` for zip/office).
3. **Size limit** — cap the accepted size to bound memory / disk / downstream cost.

```bash
# Find upload handling (adapt to the stack: multer, busboy, formidable, GraphQL Upload, framework multipart):
git grep -nE "multer|busboy|formidable|multipart|createReadStream|GraphQLUpload|Upload\b|fileFields|\.file\b|\.files\b" -- '*.js' '*.ts' '*.cjs' | head
# Evidence of type/content/size validation near uploads:
git grep -nE "mimetype|mime-type|content-type|fileFilter|magic|%PDF|signature|limits?\s*:|maxFileSize|fileSize|allowed.*[Tt]ype" -- '*.js' '*.ts' '*.cjs' | head
```

- **FINDING (MEDIUM):** an upload endpoint that validates size only, or trusts the client-declared
  MIME type without a magic-byte / content check (spoofable). Recommend a type allow-list **plus** a
  content check **plus** a size cap.
- **FINDING (MEDIUM/HIGH):** no validation at all on an upload that is stored, parsed, or forwarded
  (parsing an unexpected type can be an exploitation or DoS vector).
- A robust content check reads the leading bytes and compares against the expected magic number for
  the allow-listed type(s), and rejects anything that does not match even if the declared MIME type
  looks correct.
- **PASS:** uploads enforce type allow-list + content/magic check + size limit. **N/A:** no uploads.

## 20. No unused / scaffold / boilerplate operations exposed

Generated scaffolding, boilerplate CRUD, and leftover example endpoints are **attack surface** even
when the product does not use them — they are often less reviewed, may be unauthenticated, and can
mutate data. Every reachable route / resolver / subscription should correspond to a real product
feature.

```bash
# Enumerate all operations, then reconcile against features actually in use:
git grep -nE "\.(get|post|put|patch|delete)\(\s*['\"]/|type (Query|Mutation|Subscription)|@(Query|Mutation|Subscription|Get|Post|Put|Patch|Delete)\(|static get schema|routePath" -- '*.js' '*.ts' '*.cjs' '*.graphql'
# Names that smell like scaffolding / examples / unused features:
git grep -niE "example|sample|scaffold|boilerplate|todo|foobar|test-?only|demo|playground" -- '*.js' '*.ts' '*.cjs' '*.graphql' | head
```

- Cross-reference each operation with whether the frontend / product actually calls it. Operations
  with no caller, or clearly generated example CRUD, are candidates for removal.
- **FINDING (MEDIUM):** an exposed operation that is unused / scaffold and **state-changing or
  sensitive** — especially if unauthenticated (ties into checks 6–7). Recommend removing it to shrink
  the attack surface.
- **FINDING (LOW):** an unused read-only operation left exposed.
- **PASS:** every exposed operation maps to a real, intended feature.
- Report the operation inventory so a human can confirm the mapping — do not delete anything (this
  skill is read-only).

## 21. GraphQL query depth / complexity limits

Without a depth / complexity / cost limit, a client can send a deeply nested or highly branching
query (e.g. cyclic relations) that forces enormous resolution work — a denial-of-service vector.

```bash
git grep -nE "depthLimit|graphql-depth-limit|complexity|costAnalysis|createComplexityRule|maxDepth|queryComplexity|validationRules" -- '*.js' '*.ts' '*.cjs' | head
```

- **FINDING (MEDIUM):** a GraphQL server with **no** depth or complexity limit and a schema that
  contains nested / cyclic relations. Recommend a depth limit and/or a query-cost / complexity rule
  as a validation rule.
- **PASS:** a depth and/or complexity limit is configured. **N/A:** no GraphQL server, or a trivial
  flat schema with no nesting (note the reasoning).

## 22. Error responses don't leak internals in production

Error responses returned to clients must not include stack traces, raw DB / driver errors, internal
file paths, or SQL — these leak implementation detail useful to an attacker. Detail belongs in server
logs (via the redacting logger, check 5), not the HTTP / GraphQL response.

```bash
git grep -nE "stack|err\.stack|error\.stack|formatError|maskError|debug\s*:\s*true|NODE_ENV|sendError|res\.(json|send)\(\s*err" -- '*.js' '*.ts' '*.cjs' | head
```

- **Make it actionable:** determine what the client actually receives in **production**. A GraphQL
  server exposing `error.extensions.exception.stacktrace`, or an HTTP handler returning `err.stack` /
  the raw error message, is a leak. A production error formatter that maps to a safe message / code
  while logging detail server-side is correct.
- **FINDING (MEDIUM):** stack traces / raw internal errors returned to clients in production.
  Recommend a production error formatter that returns a generic message + a correlation id, and logs
  the detail server-side.
- **PASS:** production responses carry only safe, sanitized errors; detail is logged, not returned.
