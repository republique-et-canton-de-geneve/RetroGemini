# Changelog

All notable changes to RetroGemini will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Version follows `X.Y` format where X increments for new features and Y for bug fixes.

## [30.0] - 2026-08-25

### Added
- Group ideas without a mouse: pick a card up with Enter and choose where it goes — another card, a group, or a column — close any dialog with Escape, and see where you are with a visible focus outline; text and buttons are also darker so they stay readable on a projector or a phone in bright light

## [29.1] - 2026-08-19

### Added
- Every topic you voted for now carries your own vote count during the Discuss step, so you can see at a glance which subjects you backed and how much weight you put on each while the team works down the list

## [28.0] - 2026-08-06

### Changed
- Team passwords now have to be at least 8 characters long, and every screen that sets one — creating a team, changing the password, resetting it from an email link — says so before you type; existing passwords keep working, so nothing changes until you next choose a new one

## [27.0] - 2026-07-06

### Added
- Retrospectives keep better track of people and ideas: tickets grouped into another column now show a "from ..." badge (and keep their original post-it colour) through the Group, Vote, Discuss and Review phases, the facilitator can mark a participant who had to leave mid-retro so they stay visible in the panel while every vote counter stops waiting for them (they're automatically back on reconnect), and teammates invited by email appear as "Invited · waiting to join" in the participants panel so you know who you're still expecting before starting

## [25.0] - 2026-06-29

### Added
- The participants panel now comes alive during a retrospective: see who is currently writing a ticket (Brainstorm) or proposing an action (Discuss) with a messaging-style typing cue next to their name, and tell active contributors from quiet ones at a glance thanks to a per-person dot tally of how many tickets each participant has added

## [24.0] - 2026-06-23

### Changed
- The release retrospective analysis is now easier to read and more reliable: its AI synthesis is shown as cleanly formatted text (headings, bullet lists, emphasis) instead of raw Markdown symbols, and long analyses are no longer cut off partway through

## [23.0] - 2026-06-19

### Changed
- Dashboard actions are now ordered by creation date, from the most recent to the oldest, in both the Open and Closed views
- Health check discussions are easier to follow: read each dimension's Good/Bad descriptions on demand with the new info toggle, and comments now use a clear submit-then-edit flow instead of an always-on field that confusingly duplicated your own comment

## [22.0] - 2026-06-11

### Added
- Smarter Discuss phase: topics now show the number of distinct voters next to total votes when multi-voting is allowed, action proposals display voting progress with an "everyone voted" indicator (facilitator excluded), and facilitators can reject proposals (shown struck through) or undo any accept/reject decision

## [21.0] - 2026-06-10

### Changed
- AI group suggestions can now be fine-tuned before they are applied: uncheck any ticket you want to leave out of a proposed group, then accept the group with only the tickets you kept

## [20.1] - 2026-05-13

### Added
- Easier ticket grouping in the Group phase: the board now auto-scrolls when dragging a card near any edge, and facilitators connected to an LLM can ask the assistant to suggest thematic groups that they validate one by one before they are applied

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
CHANGELOG FORMAT GUIDE FOR DEVELOPERS — see AGENTS.md "Version Management" for the full rules.

This changelog is PARSED BY THE BACKEND and DISPLAYED TO END USERS in the
"What's New" modal. It is a user-facing release note, not a commit log.

THE TWO RULES THAT MATTER MOST:
1. ONE entry per version, ONE bullet. Each release is a single "## [X.Y] - DATE"
   block with a single "###" section and a single consolidated bullet that
   summarises ALL the user-visible changes of that version. Do NOT add several
   bullets or several "###" sections for one version.
2. NEVER document bug fixes or security patches. There is no "### Fixed" or
   "### Security" entry for new releases. Bug fixes, security patches, refactors,
   tests, docs, CI, deps and deployment are not user-visible: they only bump the
   VERSION file's minor "Y" number and stay out of this file.

VERSION <-> CHANGELOG golden rule:
  A changelog entry exists IF AND ONLY IF you bumped the major "X" (and reset
  "Y" to 0). Internal changes bump the minor "Y" and add nothing here.

## Format (pick the ONE section that fits the release)

## [X.Y] - YYYY-MM-DD

### Added       (new feature - most common; shown as "New Feature")
- One sentence describing everything new in this version, from the user's perspective

Other sections, one at a time:
### Changed     (improvement to existing behaviour; shown as "Improvement")
### Removed     (removed user-facing feature; shown as "Removed")

## What TO Include (and bump X)
- New features users can interact with
- UI/UX improvements
- Removed user-facing features

## What NOT to Include (bump Y only, no entry here)
- Bug fixes
- Security patches / fixes (not user-visible)
- GitHub workflow / CI/CD changes
- Docker / deployment configuration
- Internal refactoring
- Documentation / comment updates
- Test changes
- Dependency updates
- Version tracking infrastructure

## Writing Guidelines
- Write from the USER'S perspective: "Add dark mode toggle" not "Implement dark mode feature"
- Keep it concise: 1 sentence, no technical jargon or implementation detail
- Use present tense: "Add" not "Added"
-->
