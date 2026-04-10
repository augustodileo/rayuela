# Rayuela vs Ground Truth — sLEGACY Scorecard

## ENDPOINTS

Ground truth: 15 endpoints. Rayuela found: 11. **Score: 73%**

| Endpoint | Ground Truth | Rayuela | Status |
|----------|-------------|---------|--------|
| `POST /api/v1/auth/signup` | guards: none | guards: none | MATCH |
| `POST /api/v1/auth/login` | guards: none | guards: none | MATCH |
| `GET /api/v1/users/me` | guards: JWT auth | guards: [authenticated] | MATCH |
| `PATCH /api/v1/users/me` | guards: JWT auth | guards: [authenticated] | MATCH |
| `GET /api/v1/users/{id}/profile` | guards: none | guards: none | MATCH |
| `POST /api/v1/rolls/upload-url` | guards: JWT auth | guards: [authenticated] | MATCH |
| `POST /api/v1/rolls` | guards: JWT auth | **NOT FOUND** | BUG: empty string `""` route |
| `GET /api/v1/rolls` | guards: JWT auth | **NOT FOUND** | BUG: empty string `""` route |
| `GET /api/v1/rolls/{roll_id}` | guards: JWT auth | guards: [authenticated] | MATCH |
| `PATCH /api/v1/rolls/{id}/events/{id}` | guards: JWT auth | guards: [authenticated] | MATCH |
| `POST /api/v1/sessions` | guards: JWT auth | **NOT FOUND** | BUG: empty string `""` route |
| `GET /api/v1/sessions` | guards: JWT auth | **NOT FOUND** | BUG: empty string `""` route |
| `GET /api/v1/sessions/{session_id}` | guards: JWT auth | guards: [authenticated] | MATCH |
| `PATCH /api/v1/sessions/{session_id}` | guards: JWT auth | guards: [authenticated] | MATCH |
| `GET /health` | guards: none | guards: none | MATCH |

**Root cause of 4 missing:** Tree-sitter query requires `(string (string_content) @path)` but `@router.post("")` has no `string_content` node for empty strings.

## SCREENS

Ground truth: 7 unique screens. Rayuela found: 8 (with duplicates). **Score: ~85%**

| Screen | Ground Truth | Rayuela | Status |
|--------|-------------|---------|--------|
| AuthScreen `/auth` | no auth guard | guards: [authenticated] | WRONG — Rayuela detects useAuthStore but it's for LOGIN, not a guard |
| RollsScreen `/(tabs)` (index) | auth via layout redirect | IndexScreen, TabsScreen | PARTIAL — found but wrong names |
| UploadScreen `/(tabs)/upload` | auth via layout | UploadScreen, guards: none | PARTIAL — auth comes from layout, not screen |
| HistoryScreen `/(tabs)/history` | auth via layout | HistoryScreen, guards: none | PARTIAL — same |
| ProfileScreen `/(tabs)/profile` | auth via layout + useAuthStore | guards: [authenticated] | MATCH |
| RollDetailScreen `/roll/[id]` | auth via layout | IdScreen, guards: none | WRONG NAME — should be RollDetailScreen |
| SessionDetailScreen `/session/[id]` | auth via layout | IdScreen, guards: none | WRONG NAME — duplicate IdScreen |

**Issues:**
1. Screen naming: `[id].tsx` generates "IdScreen" for both roll and session detail
2. Auth detection: `useAuthStore` in AuthScreen is for login, not a guard
3. Layout-level auth (tab layout redirects unauthenticated users) is not detected

## API CLIENT FUNCTIONS

Ground truth: 13 functions. Rayuela found: 2 edges. **Score: 15%**

| API Function | Ground Truth | Rayuela | Status |
|-------------|-------------|---------|--------|
| `auth.signup` | POST /api/v1/auth/signup | **NOT FOUND** | Client structure differs from fixture |
| `auth.login` | POST /api/v1/auth/login | **NOT FOUND** | |
| `users.me` | GET /api/v1/users/me | **NOT FOUND** | |
| `users.update` | PATCH /api/v1/users/me | **NOT FOUND** | |
| `rolls.getUploadUrl` | POST /api/v1/rolls/upload-url | **NOT FOUND** | |
| `rolls.create` | POST /api/v1/rolls | **NOT FOUND** | |
| `rolls.list` | GET /api/v1/rolls | **NOT FOUND** | |
| `rolls.get` | GET /api/v1/rolls/{id} | **NOT FOUND** | |
| `rolls.correctEvent` | PATCH /api/v1/rolls/{id}/events/{id} | **NOT FOUND** | |
| `uploadVideoToS3` | PUT {presigned} | **NOT FOUND** | |
| `sessions.create` | POST /api/v1/sessions | **NOT FOUND** | |
| `sessions.list` | GET /api/v1/sessions | **NOT FOUND** | |
| `sessions.get` | GET /api/v1/sessions/{id} | **NOT FOUND** | |

**Root cause:** sLEGACY uses `export const auth = { ... }` pattern (individual exports) instead of `export const api = { ... }` (single object). API call detection query only matches `api.X.Y()`.

## CALL HIERARCHY

Ground truth has full call chains. Rayuela found: 0 call chains. **Score: 0%**

LSP call hierarchy is wired but requires project dependencies installed (pyright needs the virtualenv). The fixture has no virtualenv so calls to jwt, fastapi, etc. don't resolve.

## CROSS-LAYER PATHS

Ground truth: 10+ complete user flows. Rayuela can validate: 0 complete flows. **Score: 0%**

Can't trace "UploadScreen → POST /api/v1/rolls/upload-url → RollService → S3" because:
1. Frontend API calls aren't linked to backend endpoints (different client pattern)
2. Backend call hierarchy isn't built (no virtualenv for LSP)

## OVERALL SCORECARD

| Category | Ground Truth Count | Rayuela Found | Score |
|----------|-------------------|---------------|-------|
| Endpoints | 15 | 11 | 73% |
| Guards accuracy | 15 correct | 11 correct | 73% |
| Screens | 7 unique | 8 (with issues) | ~60% |
| API client edges | 13 functions | 2 linked | 15% |
| Call chains | 15 handlers traced | 0 | 0% |
| Cross-layer flows | 10+ | 0 | 0% |

## BUGS TO FIX (immediate)

1. **Empty string routes** — `@router.post("")` not matched by tree-sitter query
2. **Screen naming** — `[id].tsx` in different dirs generates duplicate "IdScreen"
3. **API client pattern** — only matches `api.X.Y()`, not `auth.X()`, `rolls.X()` individual exports
4. **Auth false positive** — `useAuthStore` in AuthScreen detected as guard when it's login logic

## ARCHITECTURE GAPS (need design work)

1. **Layout-level auth** — Tab layout redirects unauthenticated users. Rayuela doesn't detect this.
2. **Call hierarchy needs virtualenv** — LSP can't trace through uninstalled packages.
3. **Individual API exports** — Need to detect `export const auth = { signup: ... }` pattern, not just `export const api = { ... }`.
