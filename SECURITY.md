# Security

Report vulnerabilities privately to the repository maintainer. Use the hosting service's private vulnerability reporting feature when enabled; avoid public issues containing exploit details, credentials, private source, or user data. This repository does not currently configure a separate security mailbox.

Include the application/Electron version, platform, minimal synthetic reproduction, prerequisites, and impact. Native terminals and agent CLIs run with the current OS user's authority and retain their native approval policies. Workspace file checks are not an OS sandbox for those processes. Trust source-control execution only for repositories whose programs you intend to run.

Release builds must use a supported, patched Electron major. Run the dependency audit and focused simulated QA before releases; audit counts do not establish exploitability. See docs/security-implementation.md for current controls, deferred work, release provisioning and verification.
