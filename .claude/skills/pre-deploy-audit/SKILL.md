---
name: pre-deploy-audit
description: Audit all pending changes before deployment to catch common bugs
user_invocable: true
---

# Pre-Deploy Audit

Run this BEFORE deploying. This checklist is based on real bugs from past sessions — every item here has bitten us before.

## Audit Steps

1. **List all changed files**
   - Run `git diff --name-only` and `git diff --cached --name-only`
   - Summarize each changed file in one line

2. **Type safety**
   - Run `npx tsc --noEmit` — zero errors required

3. **Tests**
   - Run `npm run test` — all must pass
   - If any test is related to changed code and was NOT updated, flag it

4. **Lint**
   - Run `npm run lint` — zero errors

5. **FEN/UCI conversion check** (if engine-related code changed)
   - Verify all FEN sent to engines goes through `fenToUci()` (H→N, E→B)
   - Missing conversion = Pikafish segfault

6. **Database migration check** (if schema changed)
   - Confirm `hasColumn()` guard exists for new columns
   - Confirm migration is idempotent

7. **Hardcoded values & secrets**
   - Grep changed files for hardcoded IPs, ports, passwords, API keys
   - Check no `.env` values leaked into code

8. **Caching issues** (if API routes changed)
   - Check Next.js fetch calls for unintended caching (`cache: 'no-store'` where needed)
   - Verify dynamic routes are marked `dynamic = 'force-dynamic'` if they read DB

9. **Time unit consistency** (if time-related code changed)
   - DB = seconds, UCI = milliseconds, frontend form = seconds
   - Verify conversions at boundaries

10. **TODO/FIXME scan**
    - Grep changed files for TODO, FIXME, HACK, XXX
    - Flag anything that looks unfinished

## Output Format

```
## Pre-Deploy Audit Results

| Check | Status | Notes |
|-------|--------|-------|
| Changed files | ✅/❌ | ... |
| Type safety | ✅/❌ | ... |
| Tests | ✅/❌ | ... |
| ... | ... | ... |

**Verdict: SAFE TO DEPLOY / BLOCKED — fix issues above first**
```

## Rules
- Be honest about findings — don't minimize issues to look good
- If ANY check fails, verdict is BLOCKED
- After fixes, re-run the full audit — don't just re-check the failed item
