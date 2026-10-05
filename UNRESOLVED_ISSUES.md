# Comprehensive List of Unresolved Issues - Subjective DevAgents Project

**Generated:** 2026-10-04  
**Scope:** Issues that have been identified but could not be fixed

---

## 1. CRITICAL DEPLOYMENT BLOCKERS

### 1.1 Cloudflare Wrangler D1 Database Access (BLOCKER A)
**Status:** BLOCKED  
**Affected Component:** D1 Database Migration  
**Task Reference:** `task-2026_09_23_15_40_00-unified-user-identity-implementation`

**Issue:**
- All Wrangler D1 subcommands fail with authentication error: `/memberships` API call returns status 400, code 9106
- Affects all 4 available Cloudflare API tokens (CLOUDFLARE_API_TOKEN_2, _3, _4, _5)
- Error occurs before database resolution, making D1 migrations impossible via `wrangler`
- Both database name and UUID variations fail identically

**Root Cause:**
- Missing permission: **User → Memberships → Read** on Cloudflare token
- This is a Cloudflare dashboard action requiring owner intervention

**Workaround Available:**
- HTTP API endpoint `POST /accounts/<account>/d1/database/<uuid>/query` works with existing tokens
- However, this workaround is blocked by Blocker B (permission layer)

**Impact:**
- Cannot apply Phase 2 migration for unified-user-identity feature
- Phase 4 implementation gated on Phase 2 migration completion
- Schema regeneration scripts blocked (`extract_schema.py`, `generate_api.py`)

---

### 1.2 Production Command Execution Restrictions (BLOCKER B)
**Status:** BLOCKED  
**Affected Component:** Deployment Operations  
**Task Reference:** `task-2026_09_23_15_40_00-unified-user-identity-implementation`

**Issue:**
- Session permission layer refuses production deployment commands
- Blocked commands include:
  - `wrangler pages deploy dist --project-name=subjective-web-dashboard` → `[Production Deploy]`
  - D1 HTTP query scripts → `[Auto-Mode Bypass]`
  - Wrangler from scratch directory → `[Auto-Mode Bypass]`

**Inconsistency:**
- Read-only `SELECT COUNT(*) FROM users` was refused initially but passed later
- Permission gate appears non-uniform

**Required Resolution:**
- Add Bash permission rules for production deployment commands, OR
- Manual execution by human operator

---

### 1.3 GitHub Actions Budget Exhaustion (BLOCKER C)
**Status:** BLOCKED  
**Affected Component:** CI/CD Pipeline  
**Task Reference:** `task-2026_09_23_15_40_00-unified-user-identity-implementation`

**Issue:**
- GitHub Actions stopped org-wide
- Runs showing `startup_failure`, `path: "BuildFailed"`, zero jobs
- Last successful runs: 2026-09-20
- Org Actions spend: $29.70 (consistent with $30 cap)
- Workflows are `enabled` and `active` - indicates billing issue not configuration

**Affected Deployments:**
- `subjective_web_dashboard` run `35941465487` 
- `subjective_web_pipelines` run `35940710579`
- Both deploy automatically on push to `main`

**Critical Ordering Issue:**
- Dashboard code on `main` references `user_kind` column that doesn't exist in production D1 yet
- If Actions cap raised BEFORE D1 migration applied:
  - Auto-deploy will ship code expecting migrated schema
  - `/api/public-profiles` will break for real users
  - Affects: Find User, Team Design rail, `/chat/directory`

**Recommended Order:**
1. Apply D1 migration first
2. THEN raise Actions spending cap
3. OR disable workflows until migration completes

---

## 2. ARCHITECTURE DRIFT - Confirmed Discrepancies

**Source:** `artifacts/architecture/2026_09_30_12_46_26/findings.md`  
**Baseline:** AS-IS v0.3.0 vs observed implementation at commit `08bba9fd`

### 2.1 Unified Identity & AI Users (DATA_MODEL_DRIFT)
**Status:** Implemented but not in canonical architecture

**Discrepancies:**
- RU/AI user types with `user_kind` column
- `creator_fk` foreign key relationship
- AI user profiles table and routes
- Implementation files:
  - `services/subjective_user_service/schema/migrations/2026_09_23_unified_user_identity_user_kind.sql`
  - `services/subjective_user_service/src/subjective_user_service/routers/domain/ai_users.py`

**Note:** Already anticipated in provisional v4.2.0 model but not in selected baseline

---

### 2.2 Named Channels with Multi-Member Support (DATA_MODEL_DRIFT)
**Status:** Implemented but contradicts old model

**Discrepancies:**
- Old model explicitly states: "no name/title and single target"
- Current implementation has: channel names, topics, multi-member request/roster routes
- Evidence:
  - `services/subjective_api_chat/src/subjective_chat_api/schema.sql:11`
  - `services/subjective_api_chat/src/subjective_chat_api/models.py:10`
  - `services/subjective_api_chat/src/subjective_chat_api/main.py:259`

---

### 2.3 Saved-Team Membership to Design-Specific Channel (NEW RELATIONSHIP)
**Status:** Implemented without architecture representation

**Missing from Model:**
- Specific membership endpoint
- Composite key/team_key mapping
- Evidence:
  - `clients/web/subjective_web_dashboard/functions/api/worktwins/[[path]].js:1664, :1707`
  - `clients/web/subjective_web_dashboard/src/components/chat/teamChannels.ts:35`
  - `services/subjective_api_chat/src/subjective_chat_api/repository.py:76`

---

### 2.4 Browser-Orchestrated AI Channel Interactions (INTERFACE_DRIFT)
**Status:** New orchestration pattern without concrete trust/call boundary definition

**Implemented:**
- Browser orchestrates AI channel turns
- @ mentions system
- Posts replies as AI
- Evidence:
  - `clients/web/subjective_web_dashboard/src/components/chat/ChatWidget.tsx:313`
  - `clients/web/subjective_web_dashboard/src/lib/chat/channelAgents.ts`
  - `services/subjective_api_chat/src/subjective_chat_api/main.py:387`

**Missing:** Concrete trust/call boundary specification in architecture

---

### 2.5 Nested Teams & Design Chat via UML2Code Proxy (DEPENDENCY_DRIFT)
**Status:** Implemented without architecture specification

**New Structure:**
- `parentTeamId` support
- Generate endpoint
- UML2Code service dependency
- Evidence:
  - `clients/web/subjective_web_pipelines/src/components/TeamMapEditor.tsx:383, :893`
  - `clients/web/subjective_web_pipelines/src/lib/team-design-chat.ts:46`
  - `clients/web/subjective_web_pipelines/next.config.ts:81`

---

### 2.6 UML2Code Checkout Mismatch (DEPENDENCY_DRIFT)
**Status:** Working tree differs from root pin

**Details:**
- Root pins UML2Code at `42b15e5` (has Team Design endpoint)
- Current checkout HEAD: `b7e83c6` (lacks Team Design endpoint)
- Dirty files: `app.py`, `r2_export.py`
- Untracked files: `code_sync.py`, `xmi_diff.py`
- Unknown if local edits are committed, deployed, or approved

---

## 3. TESTING BLOCKERS

### 3.1 Selenium Test Socket Permission Denied
**Status:** BLOCKED  
**Task Reference:** `task-2026_09_14_14_05_17-devagents-chat-names`

**Issue:**
- Test: `tests/test_selenium_chat_names.py`
- Failure: `PermissionError: [Errno 1] Operation not permitted`
- Location: `socket.socket(AF_INET, SOCK_STREAM)` at Python socket.py:232
- Occurs in `_free_port()` during test server fixture setup
- Happens BEFORE application/browser start

**Verification Status:**
- Test collected successfully (1 test found)
- Browser binary and chromedriver exist
- No production impacts (test never reached execution phase)

**Required:**
- Test execution in environment permitting local test-server and WebDriver sockets

---

### 3.2 Multiple Selenium Tests Blocked (2026-09-23)
**Status:** BLOCKED  
**Task Reference:** `task-2026_09_23_15_40_00-unified-user-identity-implementation`, sequence 36

**Affected:**
- Unified user identity feature verification tests
- Same socket permission issue as 3.1

---

## 4. DATABASE & SCHEMA ISSUES

### 4.1 D1 Migration Ready But Not Applied
**Status:** MIGRATION WRITTEN, NOT APPLIED  
**Task Reference:** `task-2026_09_23_15_40_00-unified-user-identity-implementation`, sequence 23

**Current State:**
- Forward migration: `services/subjective_user_service/schema/migrations/2026_09_23_unified_user_identity_user_kind.sql`
- Rollback: `services/subjective_user_service/schema/migrations/2026_09_23_unified_user_identity_user_kind_rollback.sql`
- Verified on populated copy: 34 assertions, 0 failures
- Round-trip tested successfully
- Production D1 database still has 34 columns on `users` (pre-migration state)
- Missing: `user_kind`, `created_by_user_id`, `ai_user_profiles` table

**Blocked By:** Blockers A & B (Cloudflare token permissions + session execution permissions)

**Migration Details:**
- 5 additive statements (cannot lose data):
  - `ALTER TABLE users ADD COLUMN user_kind ...` (2 statements)
  - `CREATE TABLE ai_user_profiles (...)`
  - `CREATE INDEX idx_users_user_kind ...` (2 statements)

---

### 4.2 Hand-Maintained Column Lists in Code
**Status:** TECHNICAL DEBT / FUTURE BUG RISK  
**Severity:** HIGH

**Issue:**
- `_USER_COLS` and `_SELECT_ALL` are hand-maintained string literals
- Location: `services/subjective_user_service/src/subjective_user_service/routers/domain/users.py:21, :30`
- `generate_api.py` does NOT rewrite `routers/domain/`
- After D1 migration applied: new columns will be invisible/unwritable via `/api/users`

**Risk:**
- AI creation route that doesn't update these tuples will:
  - Insert row defaulting to `user_kind = 'RU'` 
  - Receive NO error
  - Silently create incorrect data

**Noted in:** Phase 4 assignment checklist entry 21

---

### 4.3 Schema Regeneration Blocked
**Status:** BLOCKED  
**Dependencies:** D1 migration must be applied first

**Affected Scripts:**
- `scripts/extract_schema.py` - regenerates from LIVE database
- `scripts/generate_api.py` - depends on extract_schema output

**Current State:**
- `schema/schema.sql` deliberately left untouched (correct)
- Running scripts now would regenerate pre-migration state
- Would create schema/migration disagreement

**Required Order:**
1. Apply D1 migration
2. Run `extract_schema.py`
3. Run `generate_api.py`

---

## 5. INFRASTRUCTURE & DEPLOYMENT STATE

### 5.1 User Service Not Answering HTTP
**Status:** UNCONFIRMED / NOT DEPLOYED  
**Mentioned in:** Sequence 043, devops blocker report

**Details:**
- Code on `main` branch
- Container not deployed
- HTTP health status unverified

---

### 5.2 Chat Service Litestream Replication Unconfirmed
**Status:** UNCONFIRMED

**Details:**
- Configuration: Worker → singleton Durable Object/container → FastAPI/SQLite
- Litestream replicates to R2 (configured)
- `max_instances: 1`, container port 8080, health `/health`
- Startup permits ephemeral-only operation if R2 credentials absent
- Production credential presence: UNKNOWN
- Replication status: UNKNOWN

---

### 5.3 Deployment Parity Verification Needed
**Status:** REQUIRES VERIFICATION

**Issue:**
- Design Chat introduces `/team-design-api` proxy to `uml2code.subjectivetechnologies.com`
- Backend route exists in root-pinned UML2Code revision
- Route MISSING in current UML2Code checkout
- Deployment parity needs separate verification

---

### 5.4 Missing Deployment Configuration Files
**Status:** DOCUMENTATION DRIFT

**Missing:**
- `/subjective/clients/subjective.conf` (absent)
- Root `DEPLOYING.md` (absent)

**Note:** Deploy guidance now in `workflow/agents/roles/devops_agent.md`

---

## 6. ARCHITECTURE VALIDATION ISSUES

### 6.1 Architecture Validator Fails on Current Checkout
**Status:** EXPECTED FAILURE DUE TO REMEDIATION  
**Task Reference:** `task-2026_09_16_14_15_17-settings-mfa-implementation`, sequence 259

**Issue:**
- Published v0.1.11 architecture validator now fails: **195/211** (was 211/211)
- Failures: `F1 F2 F4 F9 F10 F24 F25 F26 F41b F53 F52 F41c F41d F49 F44b F39`
- Root cause: Wave-1 CON-06 remediation landed (2026-09-21 15:35-15:38)
- Changed files: `auth.py`, `analytics.py`, `d1_client.py`, new `redaction.py`

**Problem:**
- v0.1.12 validator built and verified (223/223) against pre-remediation snapshot
- Cannot be published against current checkout (would be red immediately)
- Mechanism cannot distinguish "Wave 1 shipped" from "architecture drifted"

**Blocker Decision Required:**
1. Publish v0.1.12 as-is (red on current checkout from day 1)
2. Hold until security_agent reports, then re-derive
3. Publish as-is AND open re-derivation as next task

**Noted Missing Feature:**
- Need assertion distinguishing planned remediation from drift
- Requires declared, dated expectation for each Wave-1 site

---

### 6.2 Baseline Ambiguity
**Status:** REQUIRES ARCHITECT DECISION

**Issue:**
- `CURRENT_ARCHITECTURE` points to `xmi/SubjectiveAppsV4.xmi` (43-class skeleton)
- Newest timestamped model: provisional v4.2.0 (September 23)
- v4.2.0 models unified identity and channels
- File chronology alone doesn't authorize pointer change
- Both models parsed and compared; canonical files untouched

**Decision Needed:** Which model is authoritative?

---

## 7. SECURITY & PERMISSION CONCERNS

### 7.1 SELECT * Fitness Function
**Status:** PASSES CURRENTLY, NEEDS AUTOMATION

**Current State:**
- No `SELECT * FROM users` in codebase (manually verified)
- `system_prompt` in separate table (safe)
- `/public-profiles` cannot reach sensitive data by accident

**Recommendation:**
- Create automated assertion instead of manual checks
- One future `SELECT *` could silently break security boundary

---

## 8. KNOWN TECHNICAL DEBT

### 8.1 Subscript/Slice Language Bound Not Proven Sound
**Task Reference:** Architecture v0.1.12 O-16

**Issue:**
- Subscript and slice kept in CONSUMED list although they dispatch
- Measured impact: residualizing them gives 176 entries vs current 37
- 140 of the difference is framework `Depends(...)` in annotations
- This version does NOT claim bound is sound

---

### 8.2 Artifact Delivery Path Issues
**Status:** BLOCKED BY FILESYSTEM PERMISSIONS

**Issue:**
- Requested destination `/subjective/docs/architecture/as-is/` outside writable root
- Durable inbox `/subjective/workflow/messages/` outside writable root
- Files staged in architecture artifacts directory
- Handoff notes prepared but not delivered
- No permission bypass attempted

**Resolution:** Architect must resolve authoritative baseline

---

## 9. UNVERIFIED STATES

### 9.1 Production Environment Variables
**Status:** NOT RETRIEVED

**Details:**
- Root and 3 nested `.gitmodules` inspected
- No environment-file values retrieved
- Production credential presence unknown

---

### 9.2 No Production Probes or Application Tests Run
**Source:** Reverse engineer findings

**Scope:**
- No production probes executed
- No migration execution
- No application test runs
- Source inspection only for:
  - Recent identity changes
  - Collaboration features
  - Team-design features
  - UML2Code integration
  - Deployment changes

---

## 10. CROSS-CUTTING ISSUES

### 10.1 Concurrent Assignment Collision
**Task Reference:** Architecture v0.1.12, sequence 259

**Issue:**
- Three concurrent assignments shared same derived subject:
  - Assignment 255: architect_agent (architecture v0.1.12)
  - Assignment 256: coder_agent (CON-06 remediation)
  - Assignment 257: security_agent (gate verification)
- Assignment 256 modified container while 255 was measuring it
- No mechanism to coordinate dependent work on shared subjects

**Timeline:**
- 14:41: Review 11 confirmed 6 sites unremediated
- 14:45: v0.1.12 work began
- 15:35-15:38: CON-06 remediation landed
- Result: v0.1.12 verified against snapshot that no longer exists in repo

---

## 11. MISSING CAPABILITIES

### 11.1 Native Binary Generation Not Implemented
**Component:** Pipeline Exports

**Status:**
- `pipelines/codex`, `pipelines/claude`, `pipelines/history` are Python bundle exports
- `native_executable_generated: false` in bundle manifest
- Feature supported by exporter but not implemented

---

## SUMMARY BY SEVERITY

### CRITICAL (Blocks Production)
- 1.1: Cloudflare D1 token permissions
- 1.2: Production command execution restrictions  
- 1.3: GitHub Actions budget exhaustion
- 4.1: D1 migration ready but not applied

### HIGH (Blocks Features/Testing)
- 3.1, 3.2: Selenium test execution blocked
- 4.2: Hand-maintained column lists (future bug risk)
- 5.1: User service deployment status unknown

### MEDIUM (Technical Debt/Documentation)
- 2.1-2.6: Architecture drift items (working but undocumented)
- 5.2: Litestream replication unconfirmed
- 5.3: Deployment parity needs verification
- 6.1: Architecture validator requires re-derivation
- 7.1: SELECT * fitness function needs automation

### LOW (Process Improvements)
- 6.2: Baseline ambiguity decision needed
- 8.1: Language bound soundness unproven
- 10.1: Concurrent assignment collision (process gap)
- 11.1: Native binary generation not implemented

---

## RECOMMENDATIONS

### Immediate Actions Required
1. **Owner/Admin**: Grant Cloudflare token **User → Memberships → Read** permission
2. **Owner/Admin**: Raise GitHub Actions spending cap (after migration)
3. **DevOps**: Apply D1 migration via approved path
4. **DevOps**: Run schema regeneration scripts post-migration
5. **DevOps**: Update `_USER_COLS` and `_SELECT_ALL` in users.py

### Process Improvements Needed
1. Implement coordination mechanism for concurrent assignments on shared subjects
2. Create automated fitness functions for security boundaries
3. Resolve baseline architecture ambiguity (v4.xmi vs v4.2.0)
4. Establish validator re-derivation trigger for planned remediations
5. Verify and document all production service states

### Architecture Updates Required
1. Document all drift items (2.1-2.6) in canonical architecture
2. Resolve UML2Code checkout/pin mismatch
3. Update deployment documentation locations
4. Specify trust/call boundaries for browser-orchestrated AI interactions

---

**End of Document**
