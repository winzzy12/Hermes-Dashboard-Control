# Hermes integration — verified interfaces (v0.22.4 on this box)

The adapter (`backend/app/hermes/`) implements ONLY verified operations. Every claim below
was exercised against the live agent during development.

## Chat — `hermes -z` (one-shot)

- `hermes -z <msg>` prints ONLY the final reply. `hermes chat -q` was rejected by the
  upstream provider on this box (HCC finding, reproduced warning) — do not switch.
- Continuity: after a fresh run, read the newest `source='oneshot'` row in
  `~/.hermes/state.db` (sqlite, read-only URI, started_at > pre-run marker) and store it;
  later messages run `hermes --resume <sid> -z <msg>`. Verified: resume reuses the same
  session row (message_count grows), and the agent recalls prior turns.
- Model override per message: `-m <model>`.
- No streaming: the CLI emits the final reply only → UI shows a running state and polls.
- Stop: the runner keeps the `Popen` handle and terminates the process group.
- Subprocess is spawned with an argv LIST, never a shell string.

## Sessions / recents — `~/.hermes/state.db` (read-only)

- `sessions`: id, source (cli/local/oneshot/subagent/tui), title, model, started_at,
  last_activity_at, message_count, input_tokens, output_tokens, hidden.
- `messages`: session_id, role, content, timestamp (used for transcripts in Recents).
- Opened with `file:...?mode=ro` URIs; the dashboard never writes agent state.

## Skills

- Filesystem scan of `$HERMES_HOME/skills/**/SKILL.md` (name/description from frontmatter,
  category = parent dir).
- Enabled/disabled parsed from `hermes skills list` (all sources; `--source local` only
  covers hub/local installs). Unresolvable state renders as "unknown", never guessed.
- Enable/disable is interactive (`hermes skills config`) → intentionally not exposed.

## Cronjobs

- Structured store: `~/.hermes/cron/jobs.json` (id, name, prompt, schedule_display,
  state, enabled, next_run_at, last_run_at, last_status, last_error, deliver).
  Fallback: parse `hermes cron list` block output (`<id> [paused]` + indented fields).
- Mutations via CLI argv: `cron create <sched> [prompt] [--name --paused --deliver]`,
  `cron pause|resume|run|remove <id>`, `cron edit <id> [--schedule --prompt --name]`.
- `cron create` prints `Created job: <hex-id>` — id extracted from that line.
- Execution history: `~/.hermes/cron/executions.db` (status, started_at, finished_at, error).
- Schedule preview is computed locally (croniter for 5-field, regex for intervals,
  datetime for ISO) without touching the scheduler.

## Models

- `config.yaml` `model:` section (default, provider, base_url) — read-only; never
  hand-edited. Default changes go through `hermes config set model.default <id>`,
  validated against the provider's reported model list, and require UI confirmation.
- Model list: `provider_models_cache.json` (per `provider:base_url#fp` → models[]).
- Connectivity test: GET `{base_url}/models` with `Authorization: Bearer <key>`; the key
  is resolved from `${VAR}` refs in `$HERMES_HOME/.env` server-side and never returned.

## Health probes (`/api/system/status`)

| Probe | Evidence |
|---|---|
| hermes_cli | `hermes --version` exit 0 + version string |
| agent | `hermes status` parsed (model/provider/gateway/jobs) |
| sessions_db | read-only SELECT against state.db |
| model_provider | HTTP GET to base_url with latency |
| scheduler | freshness of `cron/ticker_last_success` mtime |

Every status (operational/degraded/offline/unknown) is backed by one of these checks;
nothing is reported operational without evidence.
