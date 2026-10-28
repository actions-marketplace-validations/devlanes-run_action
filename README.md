# devlanes action

Runs a project's [devlanes](https://devlanes.run) lane in GitHub Actions: its containers, setup, tasks and services, with the same `devlanes.yaml` you use on your machine. The action installs devlanes, starts the lane and waits until every service is ready, gives later steps the lane's URLs, and at the end of the job stops everything and uploads the logs.

```yaml
- uses: actions/checkout@v6
- uses: devlanes-run/action@v1
  with:
    profile: e2e
- run: pnpm test:e2e
```

Tests read their base URLs from `DEVLANES_PUBLIC_URL_<SERVICE>`, such as `DEVLANES_PUBLIC_URL_WEB=https://web.acme.localhost`, and trust the HTTPS proxy's certificates through `NODE_EXTRA_CA_CERTS` and the other CA variables the action sets. The [devlanes docs](https://devlanes.run/docs) cover `devlanes.yaml`, profiles, infra and the CLI.

## Commands

`command` picks what the action does after installing devlanes.

`start` (the default) starts the lane and leaves it running for the steps after it. The action's post step, which GitHub runs at the end of the job even after a failure or a cancellation, stops the lane and the daemon, writes each unit's log and uploads the logs when any step of the job failed, the tests included.

`with` starts the lane, runs the `run` script against it, then stops what it started, all in one step. The step fails with the script's exit code. It is [`devlanes with`](https://devlanes.run/docs/reference/cli#devlanes-with) with the action's setup around it.

`stop` stops the lane now, writes its logs and uploads them by `upload-logs`, instead of waiting for the end of the job. Use it when later steps need the machine without the lane.

`install` installs and prepares devlanes and starts the daemon, for workflows that call `devlanes` themselves. Later steps find `devlanes` on `PATH`.

While the lane starts, the log shows devlanes' own output: a collapsible group per start phase (infra, setup, tasks, services) and an error annotation with the last log lines of each unit that failed. `with` and `stop` add a table of each unit's peak CPU and memory to the job summary.

## Inputs

| Input               | Default                   | Description                                                                                                                                                                                                          |
| ------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`           | `0.6.1`                   | devlanes version: `latest`, `next` (the newest build of devlanes' main branch) or a release such as `0.6.1`. The default is the version this release of the action was tested with.                                  |
| `command`           | `start`                   | `start`, `with`, `stop` or `install`.                                                                                                                                                                                |
| `run`               |                           | Script for `command: with`. It runs in `working-directory` with the lane's environment.                                                                                                                              |
| `shell`             | `bash`, `pwsh` on Windows | Shell for `run`: `bash`, `sh`, `pwsh`, `powershell` or `cmd`, with the flags GitHub uses for `run:` steps. `bash` on Windows is Git Bash.                                                                            |
| `profile`           |                           | Profiles from `devlanes.yaml`, separated by commas or newlines.                                                                                                                                                      |
| `units`             |                           | Units to start, separated by spaces or newlines, such as `api web` or `+api`. Without units or profiles the lane starts its `default` profile.                                                                       |
| `timeout`           | `180s`                    | How long to wait for every unit to be ready, such as `5m`.                                                                                                                                                           |
| `working-directory` | `.`                       | Directory with `devlanes.yaml`, relative to the workspace.                                                                                                                                                           |
| `home`              | `~/.devlanes`             | `DEVLANES_HOME`. The action exports it, so later `devlanes` commands reach the same daemon.                                                                                                                          |
| `config`            |                           | YAML merged into the user `config.yaml` before the daemon starts, such as `proxy: { https_port: 9443 }`. Each setting goes through `devlanes config set`, which refuses unknown keys and invalid values.             |
| `trust`             | `true`                    | On Linux, trust the devlanes CA in the system store and in the NSS store that Chromium and Playwright read. See [HTTPS](#https).                                                                                     |
| `hosts-file`        | `auto`                    | Hosts file entries for the lane's hostnames: `auto`, `true` or `false`. On Windows, `auto` adds them when `*.localhost` does not resolve. On Linux, `true` installs the `/etc/hosts` helper for programs that cannot resolve `*.localhost`, such as Wrangler's workerd. See [Hostnames](#hostnames). |
| `low-ports`         | `true`                    | On Linux, let the proxy listen on 443 and 80, so public URLs carry no port.                                                                                                                                          |
| `export-env`        | `true`                    | With `command: start`, give later steps the lane's variables: `DEVLANES_PUBLIC_URL_<SERVICE>`, `DEVLANES_PROJECT`, `DEVLANES_LANE` and the rest.                                                                     |
| `export-ca`         | `true`                    | Set `NODE_EXTRA_CA_CERTS`, `DENO_CERT`, `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE` for later steps and the `with` script.                                                                                              |
| `upload-logs`       | `on-failure`              | When the end of the job uploads the logs: `on-failure`, `always` (or `true`) or `never` (or `false`). `on-failure` uploads when any step of the job failed or a unit had failed. See [Logs](#logs). |
| `artifact-name`     | `devlanes-logs-<job id>`  | Name of the logs artifact. Jobs of a matrix share a job id, so later ones get `-2`, `-3` and so on.                                                                                                                  |
| `retention-days`    | repository setting        | Days to keep the logs artifact.                                                                                                                                                                                      |
| `cleanup`           | `stop`                    | What the end of the job does: `stop` stops the lane and the daemon this step started, `clean` also runs `devlanes lane clean` and `devlanes infra down` (for self-hosted runners), `keep` leaves everything running. |

## Outputs

| Output       | Description                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `version`    | The installed devlanes version.                                                                                                   |
| `lane`       | The lane reference, such as `acme@0`.                                                                                             |
| `lane-index` | The lane number.                                                                                                                  |
| `domain`     | The lane's domain, such as `acme.localhost`.                                                                                      |
| `urls`       | JSON object with each service's URL: the public `https://` one when the service has `hosts`, otherwise `http://127.0.0.1:<port>`. |
| `services`   | JSON object with each service's `state`, `port`, `ports`, `url`, `public_url` and `urls`.                                         |
| `infra`      | JSON object with each container's `state`, `ports`, `shared` and `urls`.                                                          |
| `env`        | JSON object with the lane's variables.                                                                                            |
| `https-port` | The port the HTTPS proxy listens on.                                                                                              |
| `home`       | The devlanes home.                                                                                                                |
| `ca-cert`    | Path of the devlanes CA certificate.                                                                                              |
| `ca-bundle`  | Path of a bundle with the system roots and the devlanes CA.                                                                       |
| `logs-dir`   | Directory where each unit's log is written when the lane stops.                                                                   |
| `exit-code`  | Exit code of the `with` script.                                                                                                   |

`command: start` sets `lane`, `lane-index`, `domain`, `urls`, `services`, `infra`, `env` and `https-port`; `with` and `stop` set `lane`. Read the JSON outputs with `fromJSON`:

```yaml
- uses: devlanes-run/action@v1
  id: devlanes
- run: curl -fsS "${{ fromJSON(steps.devlanes.outputs.urls).api }}/healthz"
- run: psql "postgres://postgres:postgres@127.0.0.1:${{ fromJSON(steps.devlanes.outputs.infra).postgres.ports['5432'] }}/app" -c 'select 1'
```

## Examples

### Playwright against the e2e profile

```yaml
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/setup@v3
        with:
          runtime: node@24
          cache: true
          install: true
      - run: pnpm exec playwright install --with-deps chromium
      - uses: devlanes-run/action@v1
        with:
          profile: e2e
          timeout: 5m
      - run: pnpm test:e2e
```

In `playwright.config.ts`, set `baseURL: process.env.DEVLANES_PUBLIC_URL_WEB`. Installing the browser before the lane starts keeps the download out of the lane's wait.

### One step with `with`

```yaml
- uses: devlanes-run/action@v1
  with:
    command: with
    profile: e2e
    run: pnpm test:e2e
```

The lane stops when the script ends, so later steps cannot use it. The logs are uploaded at the end of the job by `upload-logs`, like after `start`.

### Secrets for services

Services get the environment of the step that started them, which is the action's step, plus what `devlanes.yaml` sets. Put the variables they need on that step:

```yaml
- uses: devlanes-run/action@v1
  env:
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_TEST_KEY }}
```

devlanes keeps this environment in the daemon's memory and never writes it to disk.

### Logs

```yaml
- uses: devlanes-run/action@v1
- run: pnpm test:e2e
```

When `pnpm test:e2e` fails, the end of the job stops the lane and uploads its logs as `devlanes-logs-<job id>`. The artifact holds `unit-<name>.log` for each unit, the daemon's log, the output of `devlanes doctor`, the lane's status and each container's log.

An action cannot read the job's status, so the post step asks the GitHub API which steps of the job failed. It uses the job's `GITHUB_TOKEN` through the `token` input, which you never need to set. In a private repository that token needs `actions: read`:

```yaml
permissions:
  contents: read
  actions: read
```

Without it, the action cannot tell and uploads the logs anyway. `upload-logs: always` uploads after every job, and `never` turns uploads off.

### Uploading the logs yourself

For your own artifact name, retention or compression, or to put the logs in an artifact with other files, turn the action's upload off, stop the lane in a step of its own and upload `logs-dir`:

```yaml
- uses: devlanes-run/action@v1
  id: devlanes
  with:
    upload-logs: never
- run: pnpm test:e2e
- if: failure()
  uses: devlanes-run/action@v1
  with:
    command: stop
    upload-logs: never
- if: failure()
  uses: actions/upload-artifact@v4
  with:
    name: devlanes-logs
    path: ${{ steps.devlanes.outputs.logs-dir }}
    retention-days: 3
```

The logs are written when the lane stops, so the `stop` step must come before the upload; without it, the lane only stops in the post step, after every other step has run. `logs-dir` then holds the same files as the action's artifact.

### Sharded tests

```yaml
strategy:
  fail-fast: false
  matrix:
    shard: [1, 2, 3, 4]
steps:
  - uses: actions/checkout@v6
  - uses: devlanes-run/action@v1
    with:
      profile: e2e
      artifact-name: devlanes-logs-shard-${{ matrix.shard }}
  - run: pnpm exec playwright test --shard=${{ matrix.shard }}/4
```

Each shard runs its own lane on its own runner.

### Several projects in one repository

```yaml
- uses: devlanes-run/action@v1
  with:
    working-directory: apps/storefront
```

### Self-hosted runners

```yaml
- uses: devlanes-run/action@v1
  with:
    home: ${{ runner.temp }}/devlanes
    cleanup: clean
```

A home under `runner.temp` keeps each job's lanes, ports and CA apart from the previous job's. `cleanup: clean` removes the lane's data and stops its containers, which otherwise survive `devlanes stop`.

### A newer devlanes

```yaml
- uses: devlanes-run/action@v1
  with:
    version: latest # or next, or 0.6.1
```

## Platforms

The action runs on Linux (x64 and arm64), macOS and Windows runners. Linux needs glibc, so jobs in Alpine containers are not supported.

Containers under `infra` need a Docker engine that runs Linux images. GitHub's Linux runners have one; its macOS and Windows runners do not, so projects with `infra` run there only with a profile that sets `infra: false`.

### HTTPS

The proxy serves every hostname over HTTPS with certificates from a devlanes CA created for the job. Programs trust it in one of two ways.

`export-ca` sets `NODE_EXTRA_CA_CERTS` and `DENO_CERT` to the CA, and `SSL_CERT_FILE` and `REQUESTS_CA_BUNDLE` to a bundle of the system roots plus the CA, for later steps and the `with` script. Node, Bun, Deno, Python, Rust and OpenSSL-based tools then trust the proxy on every OS. When the workflow already points one of these variables at its own file, the action writes a file with both certificates and points the variable there.

`trust` adds the CA to the OS store, which browsers and `curl` read. On Linux the action runs `devlanes certs trust` with `tls.trust: [system, chrome]`, installing `libnss3-tools` first when `certutil` is missing, so Chromium and Playwright's browsers trust it too. macOS and Windows ask for confirmation in a dialog that nobody can answer on a runner, so there the action skips it with a warning. On those runners, pass the `ca-cert` output to your tool, or use `ignoreHTTPSErrors` in browser tests. `trust: false` hides the warning.

On Linux the proxy needs `low-ports` to listen on 443 and 80; without it, public URLs end in `:8443`. macOS and Windows bind those ports without help.

### Hostnames

Linux and macOS runners resolve `*.localhost` to loopback. Windows Server, which GitHub's Windows runners run, does not, so with `hosts-file: auto` the action adds the lane's hostnames to `C:\Windows\System32\drivers\etc\hosts` before anything starts and removes them at the end of the job. A hosts file takes only exact names, so wildcard hostnames (`*.acme.localhost`) do not resolve on Windows runners.

Some programs skip the system resolver on any OS, such as Wrangler's workerd and Go programs built without cgo. On Linux, `hosts-file: true` installs devlanes' `/etc/hosts` helper for them; see [hostnames and HTTPS](https://devlanes.run/docs/guides/https) in the devlanes docs.

### Lanes in CI

A CI checkout is one lane. devlanes numbers lanes per project, and the domain carries the number for every lane but 0 (`acme.localhost`, `acme-1.localhost`). Read URLs from `DEVLANES_PUBLIC_URL_<SERVICE>` or the outputs instead of writing the domain in tests.

The action sets `lanes.freeze_after: 0s` and `lanes.throttle_after: 0s`, so the lane is not frozen or slowed down while a long build runs between `start` and the tests, and `daemon.exit_when_idle: false`, so the daemon waits for the steps that use it. Pass `config` to change any of them.

Services start through devlanes' adaptive start gate, as on a laptop: all at once while the runner has CPU and memory to spare, fewer at a time when it runs short. On a small runner that keeps a large project from swapping during the start. `config: { startup: { mode: all } }` turns the gate off.

## Troubleshooting

`devlanes doctor` runs before the lane starts, in its own log group. It reports the daemon, Docker, the proxy's ports, the CA and the hosts file.

A unit that fails gets an error annotation with its last log lines. Its whole log is in the artifact as `unit-<name>.log`, and `devlanes-daemon.log` has what the daemon did.

Later steps can run any command: `devlanes status`, `devlanes logs api --tail 200`, `devlanes debug why api`. With `cleanup: keep` the lane stays up until the runner ends the job, for a debugging session over SSH.

## License

[MIT](LICENSE)
