# Subjective Codex Datasource

Resumable Subjective v2 chat datasource backed by local OpenAI Codex CLI.

## Authentication

Default `existing_session` mode reuses credentials already managed by Codex CLI:

```bash
codex login status
codex login --device-auth
```

Login is never started invisibly by datasource. Device code must remain visible to user. API-key mode is also supported; key is passed only to child Codex process through `OPENAI_API_KEY` and is not written into global process environment.

## Conversation behavior

First message runs:

```bash
codex exec --json --sandbox read-only --cd /workspace "prompt"
```

Datasource captures `thread_id` from JSONL output. Following messages run:

```bash
codex exec resume --json THREAD_ID "next prompt"
```

Returned object contains:

```json
{
  "success": true,
  "status": "completed",
  "response": "assistant response",
  "session_id": "codex-thread-uuid",
  "model": "",
  "error": "",
  "events": [],
  "usage": {}
}
```

Send `{ "content": "...", "new_session": true }` to start fresh conversation. Send `session_id` to resume explicit Codex thread.

Text attachments are embedded into prompt. Image attachments are written to temporary files and passed through Codex `--image`. Temporary files are removed after turn.

## Status

`run({"action": "status"})` or `get_status()` returns one of:

- `ready`
- `not_installed`
- `authentication_required`
- `quota_limited`
- `execution_error`

## Tests

Set local dependency paths when running directly from source checkout:

```bash
export PYTHONPATH=/subjective/libs/dependencies/subjective-abstract-data-source-package:/subjective/libs/dependencies/brainboost_data_source_logger_package:/subjective/libs/dependencies/brainboost_configuration_package:$PWD
python -m pytest -q tests/test_codex_datasource.py
```

Live test consumes account capacity and is disabled by default:

```bash
RUN_CODEX_LIVE_TEST=1 python -m pytest -q tests/test_codex_datasource.py
```
