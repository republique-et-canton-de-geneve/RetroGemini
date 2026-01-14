# Changelog

All notable changes to RetroGemini will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Version follows `X.Y` format where X increments for new features and Y for bug fixes.

## [1.0] - 2026-01-14

### Added
- Feature announcement system to notify users of new features on login
- Version tracking with automatic changelog parsing
- Ability for users to see what's new since their last visit

### Changed
- Docker deployment workflow now reads version from VERSION file

---

<!--
CHANGELOG FORMAT GUIDE FOR DEVELOPERS:

Each version entry MUST follow this structure for the announcement system to work:

## [X.Y] - YYYY-MM-DD

### Added
- Description of new feature (displayed as "New Feature" in announcements)

### Changed
- Description of change (displayed as "Improvement" in announcements)

### Fixed
- Description of bug fix (displayed as "Bug Fix" in announcements)

### Removed
- Description of removed feature (displayed as "Removed" in announcements)

### Security
- Description of security fix (displayed as "Security Update" in announcements)

IMPORTANT:
- Keep descriptions concise (1-2 sentences max)
- Write from the user's perspective (what they can do now)
- Avoid technical jargon when possible
- Each bullet point becomes one announcement item

COMMIT MESSAGE CONVENTION:
For automatic changelog updates, use these commit prefixes:
- feat: New feature (-> Added)
- fix: Bug fix (-> Fixed)
- improve: Improvement (-> Changed)
- security: Security fix (-> Security)
- remove: Removed feature (-> Removed)

Example commit: "feat: Add dark mode toggle to settings"
-->
