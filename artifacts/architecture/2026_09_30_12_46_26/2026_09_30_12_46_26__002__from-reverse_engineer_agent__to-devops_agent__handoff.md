---
protocol_version: 1
task_id: task-2026_09_30_12_46_26-architecture-current-code-delta
timestamp: 2026_09_30_12_46_26
sequence: 2
from: reverse_engineer_agent
to: devops_agent
type: handoff
feature: architecture-current-code-delta
feature_version: 0.4.0
architecture_version: unresolved-pointer-vs-provisional-4.2.0
status: staged_not_delivered
---

Topology: dashboard Pages and pipelines Workers/OpenNext workflows in clients/web/*/.github/workflows/deploy.yml; Design Chat next.config.ts proxy to uml2code.subjectivetechnologies.com. Root UML2Code gitlink 42b15e5 differs from checked-out b7e83c6 plus dirty source: Team Design endpoint absent locally, present in pinned Git object. Verify deployed revision separately. Chat infra paths: services/subjective_api_chat/deploy/cloudflare/{wrangler.jsonc,worker/index.ts,Dockerfile,entrypoint.sh,litestream.yml}. Worker -> singleton Durable Object -> container port 8080 -> SQLite /data/subjective_chat.db -> conditional Litestream/R2; max_instances 1, sleepAfter 1h, /health and /health/deep. Env names: LITESTREAM_R2_ENDPOINT, LITESTREAM_R2_BUCKET, LITESTREAM_R2_REGION, LITESTREAM_R2_ACCESS_KEY_ID, LITESTREAM_R2_SECRET_ACCESS_KEY, FIREBASE_PROJECT_ID, SUBJECTIVE_CHAT_ALLOWED_ORIGINS, SUBJECTIVE_CHAT_ENVIRONMENT, SUBJECTIVE_CHAT_DB_PATH, NEXT_PUBLIC_UML2CODE_API_BASE, SUBJECTIVE_FASTAPI_INTERNAL_URL, SUBJECTIVE_OPENVSCODE_INTERNAL_URL. Wrangler secret env bindings forwarded to container; GitHub Actions uses CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID and VITE_* build bindings. WORKSPACE names credential source /subjective/.env; values not read. Root DEPLOYING.md and clients/subjective.conf absent; resolver libs/subjective_control_lib/src/subjective_control/config.py present. Infra/subjective_docker gitlink changed; whole infra diff not assessed. No production runtime verification. Entrypoint permits no durable replication when R2 credentials missing; confirm production state without exposing values.

Artifacts: /subjective/clients/desktop/subjective_chat/artifacts/architecture/2026_09_30_12_46_26
