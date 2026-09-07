# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | Best-effort |

## Reporting a vulnerability

If you find a security issue in hangnone (for example, a fix path that could corrupt CI configs unsafely, or a dependency vulnerability in the published package), please **do not** open a public GitHub issue.

Instead:

1. Email or use GitHub **Private vulnerability reporting** on [Onur45500/hangnone](https://github.com/Onur45500/hangnone/security) if enabled
2. Include steps to reproduce, affected version, and impact
3. Allow reasonable time for a fix before public disclosure

hangnone is a static analyzer. BYPASS sandbox-signal detection is **heuristic only** and is not a security audit of CI isolation.
