# Administrative invite credential confirmation — backend evidence

Executed against synthetic local adapters; no production users, sessions, e-mails or credentials were used.

Command:

```sh
npx vitest run tests/integration/adminInviteRecentAuthRoutes.test.ts tests/unit/adminReauthenticationService.test.ts tests/unit/recentAuth.test.ts --reporter=verbose
```

Result: **3 files passed, 37 tests passed**.

- New Express route suite: 22 cases. Real `adminGovernanceRouter`, `adminSessionMiddleware`, live-session RPC decision and HMAC recent-auth proof; Auth identity, data lookups and invite delivery/service calls use local adapters. Both administrative actor roles can confirm with password only. Expired proof blocks both invitation target roles; new proof enables one invitation. Fresh JWT iat does not renew confirmation. Wrong password, removed session, blocked account, revoked governance, actor/portal mismatch, client account selection and cross-site confirmation cannot issue a proof or invitation. Delete and history cleanup retain their recent-auth guard.
- New service suite: 9 cases. Exercises the actual `AdminGovernanceService.reauthenticate` method with synthetic principal lookup and login adapters. Resolves the current canonical administrative e-mail, reuses login policy including rate-limit and blocked-account results, fails closed on missing/unavailable principal, rejects and revokes a mismatched newly authenticated account or portal.
- Existing proof suite: 6 cases. Signature integrity, expiry, wrong session, wrong user, future issuance and tampering.

`npm run typecheck:app` also passed. Full server/test typecheck and integrated UI/build verification remain owned by the root agent.

No direct hosted Supabase password login or real invite delivery was tested in this suite.
