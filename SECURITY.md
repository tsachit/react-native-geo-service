# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues, as this exposes the vulnerability to everyone before a fix is available.

Instead, open a [GitHub Security Advisory](https://github.com/tsachit/react-native-geo-service/security/advisories/new) (private disclosure). You will receive a response within 48 hours. If confirmed, a patch will be released and you will be credited in the release notes.

## What counts as a vulnerability

- Code execution during `npm install` or at runtime beyond the declared purpose (location tracking)
- Data exfiltration — the package must never send location data anywhere on its own
- Permission escalation on Android or iOS beyond what is documented
- Any native code behaviour that differs from the documented API
