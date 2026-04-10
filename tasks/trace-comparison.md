# Trace Ground Truth Comparison — sLEGACY Backend

## What Rayuela found (20 unique traces, 15 roots)

### Working correctly:
- Users endpoints (GET/PATCH /me, GET /profile): trace into UserRepository.get_by_id, .update
- Sessions endpoints (POST/GET/GET/{id}/PATCH/{id}): trace into SessionRepository.create, .list_by_user, .get_by_id, .update
- All guarded endpoints have `authenticated` guard child

### Missing:
- **Rolls endpoints** (5 endpoints): Only have `authenticated` guard, NO service/repo calls
  - POST /rolls/upload-url: missing → RollService.get_upload_url → generate_upload_url
  - POST /rolls: missing → RollService.create_roll → RollRepository.create → dispatch
  - GET /rolls: missing → RollService.list_rolls → RollRepository.list_by_user
  - GET /rolls/{id}: missing → RollService.get_roll → RollRepository.get_detail
  - PATCH /rolls/{id}/events/{id}: missing → RollService.correct_event → RollRepository.get_event
- **Auth endpoints** (2 endpoints): No children at all
  - POST /auth/signup: missing → AuthService.signup → UserRepository.create → create_access_token
  - POST /auth/login: missing → AuthService.login → UserRepository.get_by_email → create_access_token
- **Deeper nodes**: Missing decode_token, create_access_token, generate_upload_url, get_public_url, CeleryDispatcher.dispatch

## Scorecard

| Endpoint | Expected children | Found children | Score |
|----------|------------------|----------------|-------|
| GET /health | 0 | 0 | 100% |
| GET /users/me | guard + UserRepo.get_by_id | guard + get_by_id | 100% |
| PATCH /users/me | guard + UserRepo.get_by_id + .update | guard + get_by_id + update | 100% |
| GET /users/{id}/profile | UserRepo.get_by_id | get_by_id | 100% |
| POST /sessions | guard + SessionRepo.create | guard + create | 100% |
| GET /sessions | guard + SessionRepo.list_by_user | guard + list_by_user | 100% |
| GET /sessions/{id} | guard + SessionRepo.get_by_id | guard + get_by_id | 100% |
| PATCH /sessions/{id} | guard + SessionRepo.get_by_id + .update | guard + get_by_id + update | 100% |
| POST /rolls/upload-url | guard + RollService.get_upload_url | guard only | 33% |
| POST /rolls | guard + RollService.create_roll | guard only | 33% |
| GET /rolls | guard + RollService.list_rolls | guard only | 33% |
| GET /rolls/{roll_id} | guard + RollService.get_roll | guard only | 33% |
| PATCH /rolls/{id}/events/{id} | guard + RollService.correct_event | guard only | 33% |
| POST /auth/signup | AuthService.signup | empty | 0% |
| POST /auth/login | AuthService.login | empty | 0% |

**Overall: 8/15 endpoints fully traced, 5 partially (guard only), 2 empty**

## Root cause analysis

### Why rolls endpoints miss service calls:
The `buildCallTreeViaDefinitions` tracer finds `await` method calls in the handler body.
Rolls handlers use: `return await RollService(db).get_upload_url(data)`
But the Jedi definition resolution at the `.get_upload_url` column position may not
resolve correctly because it's called on a constructor expression `RollService(db)`.
Jedi needs to resolve the type of `RollService(db)` first to know `.get_upload_url` is a method.

### Why auth endpoints are empty:
Auth handlers call: `service = AuthService(db)` then `await service.signup(data)`
This is a two-step pattern (assign to variable, then call method). Our tree-sitter query
only matches `await X.method()` — a single-expression method call. It doesn't match
the two-line pattern where the object is assigned first.

### Why users/sessions work but rolls don't:
Users handlers use DIRECT repository calls: `user = await UserRepository(db).get_by_id(id)`
Sessions similarly: `session = await SessionRepository(db).create(...)`
These are simple one-line `await` patterns that the tracer catches.

Rolls handlers delegate to a SERVICE layer: `return await RollService(db).create_roll(...)`
The difference: users/sessions skip the service layer and call repos directly.
When rolls DO go through service, Jedi can resolve `.create_roll` because `RollService`
is imported and the constructor type is known. BUT the tracer's definition resolution
seems to fail for some rolls methods.
