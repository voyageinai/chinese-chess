---
name: deploy
description: Build, verify, and deploy the Chinese chess platform to production
user_invocable: true
---

# Deploy Workflow

Execute the full deploy sequence for the Chinese chess platform. Do NOT skip steps or leave manual work for the user.

## Steps

1. **Pre-flight checks**
   - Run `npm run lint` — fix any errors before proceeding
   - Run `npm run test` — all tests must pass, fix failures before proceeding
   - Run `npx tsc --noEmit` — no type errors allowed

2. **Check for DB migrations**
   - Review `src/db/index.ts` for any new `hasColumn()` migrations
   - If schema changed, confirm migrations are idempotent and safe

3. **Build**
   - Run `npm run build` — must succeed cleanly

4. **Deploy**
   - Run `pm2 restart cnchess` (or the correct process name — check `pm2 list` first)
   - Wait 5 seconds, then check `pm2 status` to confirm it's running
   - Check `pm2 logs cnchess --lines 20` for startup errors

5. **Smoke test**
   - Verify the server responds: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
   - Expected: 200

6. **Report**
   - Summarize: what was deployed, any issues encountered, current status
   - If anything failed, fix it and re-run from the failed step

## Rules
- NEVER skip tests or lint to save time
- If build fails, diagnose and fix — don't just retry
- If pm2 process doesn't exist yet, ask the user before creating one
