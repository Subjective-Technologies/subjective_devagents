# Current implementation versus last XMI

Observed 2026_09_30_12_46_26 UTC; root HEAD `08bba9fd2c8748ee3b152f30a375bdea27cbf851`. Latest AS-IS v0.3.0 records baseline `bcb6361c`. 20 root submodule pointers differ. Source inspected for recent identity, collaboration, team-design, UML2Code and relevant deployment changes. Other changed pointers are inventoried, not exhaustively reviewed. No production probes, migration execution or application test run.

## Baseline ambiguity

`CURRENT_ARCHITECTURE` still selects `xmi/SubjectiveAppsV4.xmi`, a 43-class application/pipeline skeleton. Newest timestamped model is provisional v4.2.0 dated September 23; it models unified identity and channels. File chronology alone does not authorize changing the pointer. Both parsed and compared; canonical files untouched.

## Confirmed differences

| Finding | Versus AS-IS v0.3.0 | Versus provisional v4.2.0 | Live evidence |
|---|---|---|---|
| RU/AI users, creator FK, AI profiles and profile routes | DATA_MODEL_DRIFT / INTERFACE_DRIFT: now implemented in schema/migration/router source | Already anticipated; do not label as unexpected target drift | `services/subjective_user_service/schema/migrations/2026_09_23_unified_user_identity_user_kind.sql`; `services/subjective_user_service/src/subjective_user_service/routers/domain/ai_users.py` |
| Named channels, name/topic, multi-member request/roster routes | Old model explicitly says no name/title and single target | Already anticipated | `services/subjective_api_chat/src/subjective_chat_api/schema.sql:11`; `models.py:10`; `main.py:259` |
| Saved-team membership to design-specific channel key | New relationship absent from old model | Specific membership endpoint/composite key/team_key mapping not represented | `clients/web/subjective_web_dashboard/functions/api/worktwins/[[path]].js:1664`; `:1707`; `clients/web/subjective_web_dashboard/src/components/chat/teamChannels.ts:35`; `services/subjective_api_chat/src/subjective_chat_api/repository.py:76` |
| Browser orchestrates AI channel turns, @ mentions, and posts replies as AI | New orchestration and interface | General AI participation use case exists, but concrete trust/call boundary absent | `clients/web/subjective_web_dashboard/src/components/chat/ChatWidget.tsx:313`; `clients/web/subjective_web_dashboard/src/lib/chat/channelAgents.ts`; `services/subjective_api_chat/src/subjective_chat_api/main.py:387` |
| Nested teams and Design Chat through UML2Code proxy | New structure/dependency | parentTeamId and generate endpoint/dependency absent | `clients/web/subjective_web_pipelines/src/components/TeamMapEditor.tsx:383`; `:893`; `clients/web/subjective_web_pipelines/src/lib/team-design-chat.ts:46`; `clients/web/subjective_web_pipelines/next.config.ts:81` |
| UML2Code checkout differs from root pin; local code reconciliation work | Working-tree DEPENDENCY_DRIFT / INTERFACE_DRIFT candidate | Not represented | Root pins `42b15e5` (has Team Design endpoint); checkout HEAD `b7e83c6` lacks it. Dirty `app.py`, `r2_export.py`; untracked `code_sync.py`, `xmi_diff.py`. No inference that local edits are committed, deployed or approved |

All six are outside the narrower pointer-selected SubjectiveAppsV4 model. Exact-token absence was checked across complete XML; structural package/class documentation was also inspected. Missing detail is an observation, not an independent conformance judgment. Existing stable semantic IDs reused for corresponding classes; new IDs provisional.

## Infrastructure and source-state caveats

Chat configuration remains Worker -> singleton Durable Object/container -> FastAPI/SQLite; Litestream replicates to R2. `max_instances: 1`, container port 8080, health `/health`; source also exposes `/health/deep`. Startup explicitly permits ephemeral-only operation if R2 credentials are absent. Production credential presence and replication status unknown.

Pipelines `.github/workflows/deploy.yml` configures Workers/OpenNext; dashboard workflow configures Pages, both on main with GitHub Actions credentials. Design Chat introduces `/team-design-api` proxy to `uml2code.subjectivetechnologies.com`; backend route exists in the root-pinned revision but not current checkout. Deployment parity needs separate verification.

`/subjective/clients/subjective.conf` and root `DEPLOYING.md` are absent. Path resolver is present; deploy guidance now lives at `workflow/agents/roles/devops_agent.md`. Root and three discovered nested `.gitmodules` inspected. No environment-file values retrieved.

## Artifacts and limits

`2026_09_30_12_46_26__architecture__v0.4.0__as-is.xmi` is a standalone recent-change AS-IS slice, not a regenerated whole-system model or automatic promotion of v4.2.0 TO-BE. `evidence.json` pins source hashes and changed-submodule states. `observed-flow.mmd` depicts the checked call flow. XML parsing, unique IDs, dependency references and evidence paths validated by generator. Full UML schema/tool import not tested.

The requested destination `/subjective/docs/architecture/as-is/` and durable inbox `/subjective/workflow/messages/` are outside this session's writable roots. Files are staged in this directory; handoff notes are prepared, not delivered. No permission bypass attempted. Architect must resolve authoritative baseline; compliance agent owns conformance judgment.
