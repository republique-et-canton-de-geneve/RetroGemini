# Changelog

All notable changes to RetroGemini will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Version follows `X.Y` format where X increments for new features and Y for bug fixes.

## [19.0] - 2026-04-27

### Added
- Release retrospective analysis: when AI is configured, facilitators can now combine several retrospectives into one synthesis covering drivers, anchors, recurring themes, practice changes and new tools — either by typing a release keyword found in sprint names (e.g. "2606") to auto-select matching retros or by ticking sessions manually

## [18.0] - 2026-04-13

### Added
- AI assistant integration: connect an OpenAI-compatible LLM in Super Admin settings to enable automatic group title suggestions during the Group phase and AI-generated retrospective summaries in the Review phase

## [17.0] - 2026-04-09

### Added
- Full offline and air-gapped deployment support: all icons, fonts, sounds, and QR codes now load without internet access
- Wi-Fi QR code in the invite modal: when `WIFI_SSID` and `WIFI_PASSWORD` are configured, participants can scan a QR code to connect to the local network

## [16.0] - 2026-04-01

### Added
- Add an optional Retro tips panel with contextual guidance and suggested timeboxes for every retrospective stage

## [15.0] - 2026-03-27

### Added
- Add ticket comments during Brainstorm (when cards are revealed), Group, and Vote phases so participants can discuss individual ideas in real time

## [14.0] - 2026-03-19

### Changed
- Improve retrospective discuss step clarity: rename "Next Topic" vote button to "Move On" and add a "Click to discuss" hint on collapsed topics so new users can easily discover how to expand the next topic

## [13.0] - 2026-03-18

### Added
- Pin favorite teams to the top of the Your Teams page for instant access without scrolling or searching

## [12.0] - 2026-03-10

### Added
- Capture a retro report summary in the Review step and continue improving at close-out with ROTI follow-up proposals, team voting, facilitator acceptance, and assignee selection for accepted actions

## [11.0] - 2026-03-10

### Added
- Bring health check action proposals in line with retrospectives: color-code proposal votes and let facilitators see who voted, who has not, and each vote when Show votes is enabled

## [10.0] - 2026-03-03

### Added
- Improve the discuss phase experience: add comments from the discussion step without going back to survey, see who voted which score with hover tooltips in non-anonymous health check mode, and auto-expand the first topic in retrospectives so action proposals are immediately visible

## [9.0] - 2026-02-26

### Added
- Automated server-side data backups with configurable schedule, startup snapshots, and manual checkpoints you can name and restore from the super admin panel

## [8.0] - 2026-02-20

### Added
- Search and filter teams on the home page to quickly find your team

## [7.0] - 2026-02-05

### Added
- See who voted and who hasn't on each proposal action with a tooltip showing participant voting status
- Keep ticket text visible when grouping cards so you can easily compare content while organizing
- Preserve feedback (bug reports and feature requests) when a team is deleted so nothing is lost

## [6.0] - 2026-02-02

### Added
- Feedback Hub: view bugs and feature requests from all teams to avoid duplicates, add comments, and get notified by email when status changes or comments are added

## [5.0] - 2026-01-29

### Added
- Expand retrospective templates with 8 new formats: KALM, DAKI, Starfish, Rose/Thorn/Bud, Hot Air Balloon, Speed Car, Lean Coffee, and Three Little Pigs

## [4.0] - 2026-01-23

### Added
- Let facilitators edit member profiles and help invitees link their email to existing members

## [3.0] - 2026-01-21

### Added
- Team facilitators and super admins can now rename their teams from the Settings tab

## [2.0] - 2026-01-20

### Added
- Team facilitators can now change their team password from the Settings tab
- Super admins can change any team's password directly without requiring email configuration

## [1.1] - 2026-01-14

### Changed
- View updates from each version in the "What's New" modal

---

<!--
CHANGELOG FORMAT GUIDE FOR DEVELOPERS:

This changelog is DISPLAYED TO END USERS in the app. Only include user-visible changes!

## Format

## [X.Y] - YYYY-MM-DD

### Added
- Description of new feature (displayed as "New Feature" in announcements)

### Changed
- Description of improvement (displayed as "Improvement" in announcements)

### Fixed
- Description of bug fix (displayed as "Bug Fix" in announcements)

### Removed
- Description of removed feature (displayed as "Removed" in announcements)

### Security
- Description of security fix (displayed as "Security Update" in announcements)

## What TO Include
- New features users can interact with
- UI/UX improvements
- Bug fixes that affected users
- Security fixes

## What NOT to Include (technical/internal changes)
- GitHub workflow / CI/CD changes
- Docker/deployment configuration
- Internal refactoring
- Documentation updates
- Test changes
- Dependency updates (unless security)
- Version tracking infrastructure

## Writing Guidelines
- Write from USER'S perspective: "Add dark mode toggle" not "Implement dark mode feature"
- Keep it concise: 1 sentence max
- Avoid technical jargon
- Use present tense: "Add" not "Added"
-->
