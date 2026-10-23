# Administrator setup implementation plan

User-approved flow: fresh installations set their own administrator password on the first admin visit. Existing deployments keep their password. No commits or pushes.

- [x] Remove bundled default password; add a one-time setup endpoint with bounded JSON input, same-origin protection, synchronous atomic persistence and a setup-required API gate.
- [x] Add password confirmation to the admin login screen, surface environment-managed password restrictions, reject empty password changes.
- [x] Verify setup validation, concurrent attempts, persistence, existing credentials and full smoke tests.
- [x] Update README and Docker instructions, package and redeploy the local image; provide the installed version and access instructions.
