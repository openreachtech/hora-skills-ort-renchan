# The edge and the proxy layer

The reverse proxy the browser actually connects to. How to copy its configuration from production,
which side of the container boundary it belongs on, and what it can and cannot prove. Referenced
from §5 of [SKILL.md](../SKILL.md).

> **nginx is the example. The edge is the role.** Every rule here is about *the thing in front of
> the application*. The nginx directives are one way to write it, and the Apache versions are in a
> table below. Service names, ports and paths are **examples**, not values to copy.
>
> **This file applies only where production has an edge.** If it does not, skip all of it and do not
> add a proxy here — a layer production does not run hides bugs just as effectively as a missing
> one.

## What only the edge can catch

Each setting below works fine when the browser talks straight to the application. Each one breaks in
production. An environment with no edge reports all of them as working.

| Setting | Left at its default | What happens in production |
| --- | --- | --- |
| `Upgrade` / `Connection` headers | not forwarded | WebSocket and GraphQL subscriptions never connect. They time out with no error |
| `client_max_body_size` | 1MB | uploads over 1MB fail with 413 |
| `proxy_buffering` | on | a streamed response arrives all at once at the end, or gets cut off |
| `proxy_read_timeout` | 60s | a slow request fails with 504 while the application is still working |
| `X-Forwarded-For` / `-Proto` | unset | every client looks like the proxy, so per-client limits count everyone as one. Links fall back to `http` |
| trailing `/` on `proxy_pass` | — | the path prefix is dropped or doubled, and a route that works locally returns 404 |
| `try_files` for a single-page app | unset | a deep link or a reload returns 404. Only clicking through from the first page works |
| cookie `Secure` / `SameSite` | depends where TLS ends | sign-in looks like it worked, then the session is gone on the next request |

The first two reach production most often. Both stay hidden until someone uses that one feature.

## Copy the configuration from production

**Start with the production file. Do not write a new one.** This layer is worth having because it
carries production's bugs. A file you write fresh has different bugs, so the edge is there and
proves nothing.

Change three things and nothing else:

| Change | Why |
| --- | --- |
| Remove TLS termination — `listen 443 ssl`, the certificate paths, the redirect from `:80` | there is no certificate here, and the operator connects over loopback |
| Point `proxy_pass` at the E2E application | this is the only address that differs |
| Set `server_name` to `_` | you pick the stack by loopback port, not by host name. Host names would mean editing `/etc/hosts` on every machine |

Copy everything else **as it is** — header forwarding, body size, timeouts, buffering, and the
location blocks in their original order. Any other difference is a bug you will not catch.

### When production's edge is a managed one

A cloud load balancer, an API gateway or a CDN has no configuration file you can copy. Running a
local nginx in its place is a rehearsal, not the same thing. Do it anyway — it still catches the
header, body-size and buffering bugs — but be honest about the gap.

| Do this | Not this |
| --- | --- |
| List the behaviours the product depends on, and reproduce those | Try to imitate the whole product |
| Write down which ones you could not reproduce, and why | Leave the difference unrecorded |
| Hand the rest to the deployment runbook, to check after release | Report the local run as end-to-end proof |

The ones worth reproducing are almost always the same four: header forwarding, request body size,
timeouts and buffering. The ones you usually cannot are the provider's own — WAF rules, request
signing, edge caching, and how it behaves when it is overloaded.

### Write down where the copy came from

```nginx
# derived-from: the deployment runbook's edge configuration chapter
# derived-at:   2026-08-22
# deltas:       TLS termination removed / upstream repointed to the E2E app / server_name relaxed
```

- **Update `derived-at` and rewrite `deltas` every time the production file changes.** A note
  nobody updated does not tell you this is a copy. It tells you the two files are now different.
- **Watch how long `deltas` gets.** Two or three lines is a copy. A list that keeps growing means
  the copy is turning into a rewrite. Fix the production side instead — usually by moving whatever
  differs into a variable or an included file that both can use.
- **Name the production chapter, not a file path.** The runbook lives in the other repository, and
  you cannot know its path from here.

## The compose service

The edge becomes healthy last. It has nothing to serve until the application answers.

```yaml
  edge:
    image: nginx:1.27-alpine
    depends_on:
      app:
        condition: service_healthy
    volumes:
      - ./nginx/e2e.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - '127.0.0.1:18080:80'
    mem_limit: 64m
    healthcheck:
      test: ['CMD', 'wget', '-q', '-O', '-', 'http://localhost/healthz']
      interval: 5s
      timeout: 3s
      retries: 12
```

- **Mount the config read-only (`:ro`).** The container never writes it, so say so.
- **Give it a `mem_limit` like every other service.** A proxy is small, but an uncapped container is
  still uncapped ([§ Memory](./compose-definition.md#memory-cap-every-container-then-budget-against-the-runtimes-memory)).
- **The container's own healthcheck is not enough.** It only sees the inside of the container. The
  runner also polls `http://127.0.0.1:18080/` from the host, which is the side the operator uses.

## The nginx configuration

```nginx
# derived-from: the deployment runbook's edge configuration chapter
# derived-at:   2026-08-22
# deltas:       TLS termination removed / upstream repointed to the E2E app / server_name relaxed

upstream app {
  server app:3000;
}

server {
  listen 80;
  server_name _;

  # copied from production as it is — these values are the whole point
  client_max_body_size 30m;
  proxy_read_timeout   300s;

  location /healthz {
    access_log off;
    return 200 "ok\n";
  }

  location / {
    proxy_pass http://app;

    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket / subscriptions
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
  }
}
```

Three things go wrong here more than anything else.

- **One `proxy_set_header` inside a `location` throws away all the inherited ones.** Set any header
  in a `location` block and every header from the `server` block is gone. This is how a header
  quietly stops being forwarded on one route while every other route is fine. No unit test can see
  it.
- **`$connection_upgrade` is a map you define, not a built-in.** Put it in the `http` block:
  `map $http_upgrade $connection_upgrade { default upgrade; '' close; }`. Sending a plain
  `Connection: upgrade` on every request breaks keep-alive for normal ones.
- **A trailing `/` on `proxy_pass` changes the path.** `proxy_pass http://app;` passes the URI
  through. `proxy_pass http://app/;` strips the matched `location` prefix. Copy whichever one
  production uses.

### The same settings in Apache

| Purpose | nginx (the default here) | Apache httpd |
| --- | --- | --- |
| forward | `proxy_pass` | `ProxyPass` / `ProxyPassReverse` |
| WebSocket | `proxy_set_header Upgrade` / `Connection` | `RewriteCond` + `ProxyPass ws://` (`mod_proxy_wstunnel`) |
| request body size | `client_max_body_size` | `LimitRequestBody` |
| upstream timeout | `proxy_read_timeout` | `ProxyTimeout` |
| turn off buffering | `proxy_buffering off` | `flushpackets=on` / `proxy-sendchunked` |
| original client address | `X-Forwarded-For` | `mod_remoteip` (`RemoteIPHeader`) |
| single-page fallback | `try_files $uri /index.html` | `FallbackResource` |
| compression | `gzip on` | `mod_deflate` |

## Which side of the container boundary

**Put the edge and the application on the same side. Both in containers, or neither.**

```
A — the edge is part of what you are checking
  [client container ×N] → [edge container] → [app container]
  one compose network, nothing crosses the boundary,
  and the source addresses are really different

B — no edge
  [browser on the host] → [app process on the host]
  nothing tests the proxy layer — write that down and pass the check on
```

Shape A also makes the stack portable. With all three in containers the host needs only a container
runtime, and the stack behaves the same on Linux, macOS and WSL2.

### What we measured when the boundary was crossed

Someone built a stack with the application on the host and the edge in a container. They measured it
on **WSL2 with Docker Desktop 29.5.2**. All four routes failed. The application was listening on
`*:3900`, on every interface, the whole time — so "the application was not listening" explains none
of it.

| Route tried | Result |
| --- | --- |
| edge with `network_mode: host` | does not work. On Docker Desktop, "host" means the Docker VM, not WSL2. `proxy_pass 127.0.0.1` never reaches the application |
| bridge network with a published port | **connects, and is useless as a check.** Requests from three different sources all arrived with `$remote_addr` set to `172.17.0.1`. A per-client rule passes even when the code counts every client as one |
| host connecting to the container's IP | `EHOSTUNREACH`. WSL2's `eth0` was on `172.17.2.189/20`, which overlaps Docker's `172.17.0.0/16` |
| container connecting to the application on the host | HTTP 000 on all four of `host.docker.internal`, the default gateway, `192.168.65.2`, and WSL2's own address |

**The lesson is not that the machine was strange.** The shape was weak from the start, and this
machine showed it. The `127.x` aliases they used to separate the sources also collapse on plain
Linux, because loopback traffic to a published port goes through `docker-proxy`. It only works with
`userland-proxy=false` *and* non-loopback addresses. Call it a quirk of one machine and someone
builds the same thing again next time.

There is a second reason this shape cannot work here. This skill binds the application to
`127.0.0.1` only ([§4](../SKILL.md)), which closes the route anyway.

### A published port hides who the client is

**Moving the application into a container is not enough** if your check depends on who the client
is. Traffic through a published port gets rewritten to the bridge gateway's address before the edge
sees it. If you need clients to look different, put the clients inside the compose network too.
That is why shape A has the client in a container.

## Testing the edge on its own

You can test the edge's configuration without the application. Put an echo server behind it and read
the headers it received:

```
[client container ×N] → [edge container] → [echo container]
```

It is smaller than the full stack. It needs no seed data. It never crosses the container boundary.

**Here is what it proves and what it does not:**

| Question | Who answers it |
| --- | --- |
| does the edge add a real client address on the right, without a `location` block throwing away the inherited `proxy_set_header`? | **this test** — and nothing else can |
| does the application read the right entry, counting from the right? | unit tests, which you already have |
| do the two actually work together, so the behaviour really is per-client? | **neither one** |

The echo server has no rate limiter, no session and no application logic. Nothing here reaches the
behaviour those headers feed into. **You are joining up two separate tests, not running one test end
to end.** Write it down that way. To close the gap you need the application on the same side, which
is shape A.

The gap this test *does* close is the dangerous one. A `proxy_set_header` that is in one `location`
and missing from another cannot be caught by a unit test at all. In production it shows up as one
route behaving differently from the rest.

## How to check it works

Treat these as intentions — the exact flags differ per tool. Run them **from the host**, because
that is the side the operator uses.

| What to check | How |
| --- | --- |
| the edge is serving | `curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18080/` |
| the path prefix survives | request a nested route, and compare the status with the same route on the application's own port |
| `Upgrade` is forwarded | open the product's subscription or WebSocket feature in the browser **through the edge** and watch data arrive. A 101 in the access log confirms the handshake |
| the body limit matches production | upload a file just under the limit and one just over, and look for 413 |
| streaming is not buffered | request the streaming endpoint and check the first bytes arrive before the response finishes |
| the forwarded address arrives | look in the application's log for the client's address, not the proxy's |

**Do all of these for real.** Reading the configuration tells you what the file says. Only a request
tells you what the edge does.

## When you leave the edge out

First, be clear which situation you are in. **If production has no edge, there is nothing to leave
out** — the role does not exist for this product, and there is nothing to record. This section is
about the other case: production has one, and you decided not to build it here.

That is a fair choice — a demo, a deadline, a machine it will not run on. Making it in silence is
not. Write this down next to the environment:

- **what you measured** — the routes you tried and what each returned, as a table
- **what you fixed in the product** instead of in the environment
- **what a person still has to decide**, with the options
- **the decision, and the date**
- **who checks it instead** — usually the deployment runbook's post-release chapter

The note is there so the next person does not spend a day working it out again on the same machine.

**Do not leave a broken edge config and a spec that always fails.** A run that is red every time is
a run nobody reads, and the failures that matter disappear into it.
