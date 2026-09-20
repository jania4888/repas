# L1 checkpoint: visual-consent domain only

This is the first bounded domain slice of V4 L1, not the completed public-consent feature.
`StorefrontVisualConsent` is a standalone in-memory type, **not referenced by `StorefrontProfile`
or another persisted entity**. It adds no handler, public/owner DTO, controller, migration, EF
mapping, SQL constraint, permission policy, tenant database access or classification resolver.
Existing profile creation signatures and fixtures are unchanged; new standalone consent starts
with all five fields absent. Nothing is attached to, hydrated from or saved to Master yet.

EF discovers private-set scalar properties by convention even without explicit mapping edits.
For that reason this checkpoint does **not** add properties or a navigation to `StorefrontProfile`:
its EF model and required SQL columns stay unchanged. Attaching the domain state to that aggregate
must arrive with the dependent additive Master mapping/migration, not before its columns exist.

## Domain contract

- `PublicVisualProfileKey`, `PublicVisualProfileRevision`, `VisualConsentVersion`,
  `VisualConsentAcceptedAt`, `VisualConsentAcceptedByUserId` are all absent or all complete
  through domain operations. Private setters are not a database constraint or an API allowlist.
- `AcceptVisualConsent` requires an explicit `accepted=true`, an exact kebab-case key (1–64
  ASCII characters), an editorial revision `r[1-9][0-9]*` (up to 64 characters), nonempty terms
  version (up to 64 characters, no controls; outer whitespace trimmed), nonempty actor and
  non-default UTC time. Identity/revision are not trimmed, lowercased or inferred. These are
  shape checks only, not catalogue availability, permissions or legal approval.
- The terms version is separate from both publication `ConsentVersion`/CGU and the technical
  catalogue release. No private tenant classification, category or CGU value initializes consent.
- All inputs are validated before any replacement. Changing identity, editorial revision or
  visual terms requires another explicit acceptance. A same-identity/revision/terms repeat
  returns `Result.Success(false)` and preserves the first actor/time, even if a subsequent
  authorized caller supplies another actor/time. A change returns `Result.Success(true)`.
- Acceptance takes a supplied `StorefrontStatus` snapshot. Only Draft, PendingReview and Published
  are accepted; Suspended and unknown enum values reject every acceptance, including an otherwise
  idempotent repeat. That argument is **not** fresh server validation. Suspension does not erase
  existing visual proof. `WithdrawVisualConsent` clears only these five fields and needs no status
  exception or publication transition; repeating an absent withdrawal is a no-op.
- This standalone type cannot change publication, street position, moderation reasons/dates,
  branding, checkout, CGU or aggregate version. Future aggregate integration must preserve that
  isolation and ensure approval after withdrawal never restores old consent.
- The methods do not emit audit events or verify authority. No `StorefrontVisualConsentEvent`
  entity is included here: its complete snapshot, proposal context/correlation and transaction
  belong to the next persistence tranche, separate from `StorefrontPublishingConsent`.

## Required before server integration or activation

1. Attach the state to `StorefrontProfile` together with the Master-only nullable columns, explicit
   bounded mapping, all-null/all-complete CHECK
   (including nonempty content), technical rowversion and append-only visual-consent journal.
   No private-classification backfill, CGU copy, tenant migration or reuse of tenant `AuditService`.
2. In dedicated owner handlers, derive tenant, active actor and UTC time from the server. Freshly
   re-read effective permission/membership and suspension, not only old JWT claims or cached
   security stamp. Withdrawal while suspended still requires authority; it never lifts suspension
   or relaxes the generic branding `UpdateProfile` prohibition.
3. Revalidate the exact current proposal, effective catalogue links and supported/authorized
   editorial revision. Syntactically valid arbitrary, retired or revoked references must fail.
   Reclassification only changes a suggestion. Keep an accepted old revision only while it stays
   active/supported/authorized, including N−1; otherwise project neutral/HTML without changing proof.
4. Check a concurrency precondition before domain mutation, **including no-ops**. Stale requests
   return 409 with a fresh proposal, never a silent overwrite. Domain `Result<bool>` distinguishes
   changes on the current loaded aggregate, not HTTP retry safety: replaying an old acceptance
   after withdrawal must fail the server precondition, not resurrect consent. Serialize/check
   races among acceptance, withdrawal, branding, moderation and owner permission changes.
5. In one Master transaction, save a changed profile and its immutable audit snapshot (previous
   identity/revision/terms on withdrawal, fresh withdrawal actor/time, proposal context/correlation).
   Audit failure must roll back the mutation. No-op repeats do not refresh proof or append duplicate
   consent events. Preserve authorization checks for no-ops. A returned `true` is not persisted audit.
6. Replace unsafe detached full-aggregate updates as needed; prove old/new binary coexistence and
   rowversion handling across all existing storefront commands. Do not deploy aggregate attachment
   without its Master schema changes.
7. Use a dedicated public allowlist projector: optional visual identity only when consent and
   current availability permit, with existing publication filters. Never expose actor/time/terms,
   private classification or raw entities. No public field is added at this checkpoint.

## Qualification boundary

`StorefrontVisualConsentTests` exercises absent/complete standalone state, rejected atomic
replacement, explicit acceptance, preservation of the initial proof on repeats, idempotent
withdrawal and the supplied-status suspension guard. Status enums are passed directly; there
is no connected profile whose isolation this suite could verify. Existing storefront domain
tests remain applicable, but do not prove integration with visual consent.

When the state is attached to the aggregate/EF model, add real isolation tests for CGU, branding,
publication, moderation, street position, checkout and events, including withdrawal during
suspension and approval without resurrecting consent. None of that profile-isolation evidence
is claimed at this checkpoint. Test execution/results are reported separately, not implied by
the tests' presence.

V03 is **not closed**: actual HTTP permissions, stale proposals, concurrency, SQL CHECK and audit
rollback require real API/SQL tests. V01 public isolation/allowlists and V12 N/N−1 projection and
rollback are also future integration gates; domain tests cannot certify them. Graphics rollback
must never restore a database, run a down migration, erase recent proof or resurrect withdrawn consent.
