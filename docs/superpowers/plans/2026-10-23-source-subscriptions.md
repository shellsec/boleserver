# Source subscriptions implementation plan

> Execute inline in this session, using executing-plans and test-driven-development.

**Goal:** Port the mobile catalog subscription and bounded failure recovery to lxserver.
**Architecture:** Pure catalog parsing/recovery helpers; filesystem subscription service; existing authenticated HTTP server, player failover and management UI integration.
**Tech Stack:** TypeScript, Node.js, existing needle/vm2, vanilla browser JavaScript.
**Spec:** ../specs/2026-10-23-source-subscriptions-design.md

## Global Constraints
Keep manual sources and disabled states; no unsafe VM escalation; one recovery per song and one check per URL per minute; no default subscription URL.

## Review Focus
Invalid/duplicate catalogs; relative URLs; cross-user access; failed download/validation preserving old files; hung source requests and bounded recovery.

## Tasks
- [x] Write failing node tests for parsing, merge preservation, failure recovery limits and request timeout; implement sourceSubscriptionCore.ts.
- [x] Implement sourceSubscriptions.ts: complete-download/validation before commit, persistent per-owner address/status, explicit clear and single-flight updates. Add filesystem integration tests.
- [x] Add authenticated subscription API and management UI, connect music URL recovery and request deadlines. Test local HTTP fixtures, syntax and TypeScript compilation.
- [x] Review changes, document JSON format and behavior, commit and push to shellsec/lxserver; verify remote commit.

Rulings: user confirmed mobile catalog parity; user requested BoleServer rebranding, own repository shellsec/boleserver and local folder E:\GITHUB\boleserver. Quality defaults remain unchanged per latest instruction. Issue analysis is documented separately; no upstream comments or unrelated feature changes.

Final verification: 15 tests passed; full TypeScript build passed; full-service smoke check passed in the renamed directory. Independent review found no remaining release blockers.
