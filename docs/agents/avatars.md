# Avatars

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


Each person can choose a picture, shown in place of their initials wherever
they are drawn: on their cards, in the comments, in the participants panel, in
the headers, on the dashboard's members tab and on the join screen. Six
families of twenty pictures; the picture takes the person's own tone. The
pieces: `utils/avatars.js` (the ids, shared by server and client),
`server/routes/teamAvatarRoutes.js` (the one writer),
`components/common/avatars/` (the pictures, as data, and `AvatarArt`),
`components/common/Avatar.tsx` (draws a person: initials, or a picture when
given an `avatarId`), `components/common/AvatarPicker.tsx` (the dialog),
`components/session/sessionAvatars.ts` (which avatar a session shows, and the
own-entry rule), `components/session/useOwnAvatar.ts` (what both session
screens share), `components/session/ViewerAvatarButton.tsx` (the opener) and
`components/common/useAvatarDiscoveryHint.ts` with
`components/common/AvatarDiscoveryHint.tsx` (the one-time hint that the
avatar can be changed).
Rules:

- **The choice is the team's, keyed by member, with a date.**
  `Team.memberAvatars[memberId] = { id, at }`, written by
  `POST /api/team/:teamId/member/avatar` alone (see the API table and *Data
  Persistence Structure*). `at` is the server's clock and **the newer `at`
  wins everywhere**: a browser holding an old copy of the team never pushes an
  old choice back, and two browsers of one person write the same value. That
  is why this feature needs **no own-change ledger slice**. A clear is a dated
  choice too, a first one included: "My initials" picked by someone with no
  stored choice is stored as `{ id: null, at }`, so in the session it was made
  in it replaces a picture another client planted on their entry with an older
  time (a time planted ahead follows *A participant entry is data* below) —
  drawn and marked as initials in their browser at once (`useOwnAvatar.test.tsx`
  → *after a first clear made in the session*), and for the room through the
  route's stamp (`teamAvatarRoutes.test.ts` → *stores a first clear as a dated
  entry, like any choice, and stamps it into the session*). So is a repeat:
  the stored picture picked again, or a clear of a cleared choice, is dated
  again like any pick and written, so in the session it was made in its stamp
  replaces another picture planted on the entry with a time newer than the
  stored choice (a time planted ahead follows *A participant entry is data*
  below), and the newer copy a merge kept or a tab open across a restore
  stamped (`teamAvatarRoutes.test.ts` → *puts the stored picture back over a
  newer entry when the person picks it again in that session*;
  `useOwnAvatar.test.tsx` → *draws and marks the stored picture again over a
  newer one planted on the entry, and writes the entry once the wait is
  over*).
- **A session shows its own copy.** A participant entry of a session carries
  `avatar` and `avatarAt`. The route stamps the entry of the session the pick
  came from (the room sees it at once); and each client keeps a **copy of its
  own entry** on the team's choice when that choice is newer
  (`ownAvatarEntry`). Nobody writes another person's entry, and a team member
  row never gains an `avatar` field. When drawing, `sessionAvatarOf` takes the
  entry only when its `avatarAt` is newer than the team choice's `at` (an
  entry with no time counts as 0, so it never wins), otherwise the team's: a
  pick made on the dashboard stamps no session, and the session's copy must
  not outlive it. On a tie it draws the team's choice, as the picker marks it
  (`ownAvatarChoice`): a tie the server wrote carries one picture in both
  places (the route's stamp and the own entry copy the stored entry), so an
  entry with another picture at the same time was planted by another client
  (`sessionAvatars.test.ts` → *takes the team's choice on a tie, as the picker
  marks it: a tie with another picture is not one the server wrote*).
- **The own entry rides the writes the screen already sends.** Both screens
  stamp it in their one write function (`stampOwnAvatarEntry`, after the
  updater), so the write that adds a person to a session carries their
  avatar. Sent in a write of its own right behind, the avatar left from the
  same revision as that write: the server refused one of the two, healed, and
  the avatar went out again (four writes to enter a retrospective, two of them
  refused). `useOwnAvatar` writes the entry itself only where no write is on
  its way: the team's choice changed while in the session, a lost race healed
  the entry back, a health check entered by someone it already lists. It
  leaves the entry to the write a screen sends on entering
  (`entersWithAWrite`): a retrospective's presence write, which goes out once
  whatever the session holds, and a health check's when there is one to come
  (the viewer is not listed yet, or comes back marked as having left; the
  hook's own write, sent just before from the same revision, had the server
  refuse the write that takes the mark off, which nothing sends again). **A pick
  made in a session is left to the server**, whose stamp follows its answer:
  written by the client at once as well, the entry raced that stamp on every
  pick. The hook waits `SERVER_STAMP_WAIT_MS` (2 s) for the stamp and writes
  the entry only if it has not come (the server's is best effort); the wait
  ends with its timer, never by comparing clocks.
- **A participant entry is data, its avatar's time included.** Every client
  of a session writes the participant list, so a client can put any picture
  of the offered set, and any time, on anyone's entry there, as it can a name
  or a colour. Nothing but an offered picture is ever drawn (`toAvatarId`),
  and the team's map is out of its reach. A later pick of the person
  replaces what was planted when it is newer than the planted time. The
  route's stamp also replaces a stamp dated far ahead of the server's clock
  (more than five minutes past both the clock and the choice being stamped:
  no pick wrote it; a time planted less than that ahead stands until it has
  passed), so a pick made **in that session** reaches it;
  left to outrank every real stamp, one planted time kept each later pick out
  for as long as the session lived. **A time is whole milliseconds that a
  number counts exactly** (`isAvatarTime`, which is `Number.isSafeInteger`
  and not negative): anything else is no time, on a participant entry (it
  counts as none, so every real choice outranks it) and on the team's map (it
  is no entry, and heals at the next write). The route dates a pick at least
  one millisecond after the choice it replaces, and nothing can be dated
  after 1e300 (1e300 + 1 is 1e300): read as a date, such a value on the map
  made every later pick carry that same date, and each session stamped with
  it kept the older picture for good. The largest date that counts exactly
  has no next one either: the pick is then dated by the server's clock alone,
  and the stamp reads a copy of the old date as far ahead. A pick made
  elsewhere does not reach a
  session whose entry carries a time planted ahead of it, on purpose: **the
  clients compare the two times and never judge one by their own clock.** A
  browser whose clock is wrong would read a newer pick, stamped by the server
  for the person's other browser, as "ahead of the clock", write its older
  choice over it, and the two browsers would undo each other without end
  (the loop the own-change ledger exists to prevent). A
  row that passes to another id (someone back under a new id, matched by
  name in `mergeRosterIntoParticipants`) leaves its avatar behind
  (`withoutAvatar`): the picture is the choice of the member whose id it was.
- **Values are copied as stored and checked only to draw.** `toAvatarId` is
  applied where a picture is drawn (`Avatar`, `sessionAvatarOf`,
  `memberAvatarId`), never where a value is copied: a tab or pod that does not
  know a newer id keeps it as it is, and draws the initials, as long as the id
  is of the stored shape (`isMemberAvatarEntry`: words of the lower-case
  letters a to z joined by single hyphens, at most 64 characters). Every pod
  and tab from 45.0 on applies that shape when it reads the map, merges two
  teams or rebuilds the map at a pick, so an id of any other shape reads as no
  choice there and is dropped at the team's next pick. The shape is therefore
  a contract with every deployed release, not a naming style: a new id must
  fit it, and widening it in `utils/avatars.js` does not reach the pods
  already running (`__tests__/avatars.test.ts` holds it). Adding avatars
  therefore takes **two releases**: first the id goes into
  `ACCEPTED_ONLY_AVATAR_IDS` in `utils/avatars.js`, which the route accepts
  (`isAcceptedAvatarId`) and the picker neither offers nor draws; the next
  release moves it into its family with its art and its names. Offered at once,
  a pick routed to a pod of the previous release during the rollout would be
  refused for good (`invalid_avatar` is final). `__tests__/avatars.test.ts`
  checks that the accepted set holds every offered id.
- **An anonymous session draws no chosen avatar, anywhere.** One resolver
  decides, `sessionAvatarOf(session, team, memberId)`, and it answers `null`
  while the session is anonymous, wherever the session stores that (both
  session types keep it under `settings.isAnonymous`): a picture beside a card
  would say who wrote it. (A rule of what is drawn, like anonymity itself:
  the session's data carries each entry's avatar there too, as it carries
  each card's author, and the entry is written in an anonymous session so
  that the picture is there when the session names its authors again.) `__tests__/avatarSource.test.ts` walks the AST of
  `App.tsx` and `components/` and refuses a read of `.avatar`, `.avatarAt` or
  `.memberAvatars` anywhere but in `sessionAvatars.ts` or inside a call to
  `sessionAvatarOf`, `ownAvatarEntry`, `memberAvatar` or `memberAvatarId`, so a
  new screen cannot bypass the rule. Inside the session screens (`Session.tsx`,
  `HealthCheckSession.tsx`, `components/session/**`, the resolver excepted) it
  also reports any call to `memberAvatar` or `memberAvatarId`, which hide
  nothing in an anonymous session: a session draws through `sessionAvatarOf`
  only. Outside a session (the dashboard, the join
  screen) the callers use `memberAvatarId(team, id)`.
- **A picture is data, never markup.** `components/common/avatars/avatarArt.ts`
  holds each picture as a list of shapes with a closed vocabulary (eight tags,
  seven classes, a fixed list of attributes), and `AvatarArt` draws them with
  `React.createElement`: the id comes from a value another client stored, so
  nothing of it may reach the DOM as a string. An id it does not know draws
  nothing. `AvatarArt` is memoized on its id (`React.memo`): the board draws
  every card again on each change of the session, and a picture rebuilt on
  every redraw cost a 1000-card board about 20 ms per redraw; its colours come
  from the tone class in CSS, so the id alone decides what it draws
  (`avatarArt.test.tsx` → *is not built again when its parent draws again
  with the same id, and a new id draws at once*). The file is the source: its
  families (`AVATAR_FAMILIES`) are its one list of ids (*writes the ids once,
  in their families*), and `AvatarArtId` and `AVATAR_ART_IDS` are read from
  them, so tsc refuses a family's id that has no name or no picture, and a
  name or picture no family holds (`AVATAR_NAME_KEYS` and `AVATAR_ART` are
  keyed by `AvatarArtId`). To add or change a picture, edit its shapes
  there, with its id in its family there and in `utils/avatars.js`, and its
  name in both `avatars` dictionaries (`__tests__/avatarArt.test.tsx` checks
  the three agree).
- **A picture is drawn for a person who is in the session.** Two rows of the
  participants panel show none, on purpose, and both say why in words: a
  participant marked as having left is neutral initials (the "Left the
  session" chip), and an invitee still expected is a dashed circle holding
  initials (the "Invited" chip), drawn by the panel itself and not by `Avatar`.
  The picture arrives with the person, in their own tone, with the arrival's
  effect; an invitee who chose one is not shown it greyed out while they are
  away. `__tests__/avatarScreensWiring.test.tsx` holds it for the invitee.
- **The picture is decoration; the person's name is the name.** An `Avatar`
  without a `label` is hidden from assistive technology (a name is written
  beside it); with one it is an image named by the person, never by the
  picture. The opener is a button named "<name>, choose my avatar"; while it
  shows initials they lead its name ("AL, Alice Roux, choose my avatar"), as
  the picker's own initials tile does ("LM, My initials"): axe's
  `label-content-name-mismatch` reads visible initials as the button's text
  (WCAG 2.5.3).
- **The opener is where the viewer's avatar is**: both session headers (every
  width for a participant, from 360px for a facilitator, whose header also
  carries invite and play) and the dashboard's top bar (every width), measured
  by the header-fit spec. The picker writes one choice at a time, keeps the
  latest pick made during a write (dropped only when it is the choice that
  write just stored, a double click; written whatever it is after a refusal),
  shows a choice only once it is stored, and keeps its error on screen when
  the save fails. A click on the picture
  already marked is written too: the mark is this browser's copy of the
  choice and can be older than the server's (a pick made since in another
  browser, from the dashboard), and the server dates it again like any pick.
  When the opener reported another choice while a write ran (the person's
  other browser picked meanwhile, and its stamp reached this session first),
  the picker marks the opener's word once the answer is drawn, not the choice
  it stored (`avatarPicker.test.tsx` → *marks the opener's word after a write
  during which the opener reported another choice*). `App` merges the map a
  pick resolved with into the open team's, member by member
  (`mergeMemberAvatars`, as `dataService.setMemberAvatar` does in its cache:
  the answer is the map at that pick's write, and the team on screen may hold
  another member's later choice), on a **new** team object, only for the team
  still open (`__tests__/appAvatar.test.tsx`: not after a sign-out, not on
  another team opened meanwhile), so nothing survives a sign-out.
- **Each person is told once that the avatar can be changed** (the
  maintainer: nothing said it, and not everybody reads What's New). A band
  right under the header, `AvatarDiscoveryHint`: in both session screens after
  `<SyncStalledBanner />`, on the dashboard as the top bar's sibling, never
  inside a `<header>` (the header-fit spec measures the page's first one), and
  a still dot on the opener (`ViewerAvatarButton`'s `marked`, on a button that
  is `relative` in every state, so marking it moves nothing) while it shows.
  It is a note named by its title, met in reading order: not a live region,
  it never takes the focus and nothing about it animates. From `lg` (1024px)
  it shows three of the pictures (fox, rocket, moon) in the viewer's tone,
  hidden from assistive technology, and its sentence, beside its buttons;
  drawn by `Avatar`, the pictures carry `data-avatar-art`, so a page-wide
  count of pictures sees them while the band shows (they stay in the page
  below `lg`, not drawn). Below `lg` the band keeps its title and its two
  buttons, and its sentence is read, not shown (`sr-only lg:not-sr-only`, the
  pictures `hidden lg:flex`): one row of 43px from `sm`, and on a phone its
  buttons under its title where they do not fit beside it (69px at 320 and
  390px). From `sm` the pictures, the sentence and the buttons used to share
  a row that cannot wrap, which left the sentence about 250px wide: at 640px
  it took four lines under its title in French (three in English) and the
  band 117px (97px in English), and a landscape phone (667 × 375) kept 194px
  of session under the header and the band in French, 268px now. Its rule
  is `useAvatarDiscoveryHint`, called by the screen that draws the opener:
  - **Decided with the screen**: shown when, at the first render, the viewer
    has no stored choice (`hasOwnAvatarChoice` in a session, through
    `useOwnAvatar`'s `hasChoice`; `memberAvatar(team, id) !== null` on the
    dashboard, which App hands the bar), a cleared choice counting as one, a
    first "My initials" included; the session is not anonymous
    (`isAnonymousSession`, the drawing's rule: the
    band would promise a picture nobody sees); the credential is not revoked
    or the join refused (the picker could not save); and the member id is not
    on its seen list. It takes the opener's visibility class, so there is no
    band without an opener (a facilitator's, in a session, from 360px).
  - **Once gone, gone for the mount**: a choice arriving, the session turning
    anonymous, a blocked credential, the picker opening or "Got it" take it
    away, and nothing brings it back while the screen lasts. Its going moves
    what is under it up once, by its height, and three of those can come
    while people work, from outside this screen: a choice made in the
    person's other browser, the session made anonymous, a password changed
    or a join refused. The latch is what keeps that to once: the band never
    comes back to push the board down again, not when the session names its
    authors again, nor when another tab's new token clears a revocation.
    Another member in the same mount is decided afresh.
  - **Remembered per member and browser** in `localStorage`
    (`retro-avatar-hint-seen`, the one-time notes' shared seen list,
    `components/common/seenOnce.ts`: the fifty most recent, a storage that
    fails shows it) by its two buttons and whenever the picker opens, from
    anywhere. A choice needs no write: it is the server's, and stops the hint
    in every browser of the member, a first "My initials" included, which is
    stored like a picture (it stored nothing before 45.3, and another browser
    showed the hint once more).
  - "Choose my avatar" focuses the opener first, then opens the picker, so
    the picker gives the focus back to the opener once the band has gone.
    "Got it" moves the keyboard on only when the keyboard pressed it, which
    the click says (`nextFocusAfterDismiss`: a key's click carries no
    `detail`): to the next control drawn after the band (`nextFocusableAfter`
    passes over one that is not drawn, through `isVisible`), else back to the
    opener, which is drawn wherever the band is. A participant's Icebreaker
    below `lg` has no drawn control after the band, since the participants
    panel and its collapse toggle are `hidden lg:flex`: handed to that toggle,
    the keyboard fell to the page as the band went. After a pointer the focus
    stays where the browser put it. Where the browser left the focus says
    nothing: Chrome and Firefox focus the button they press, and moved on
    after a tap the focus landed in the next field, where a phone opened its
    keyboard (the facilitator's Icebreaker question). The login screen's star
    hands the focus on by the same test. Both are named by their words
    (`exact: true` in e2e: "Choose my avatar" is part of every opener's name,
    and "Got it" of What's New's "Got it!").

Residuals, stated on purpose:

- **Everyone who logs in with the team password is one member** (the
  facilitator's seat), and so shares one avatar, as that seat already shares
  one name and colour.
- **Any team credential can set any member's avatar.** "Your own" is a rule of
  the screens; the route checks the credential, the member id's shape and the
  avatar id, not who is asking (it cannot: a credential names a team, not a
  person). `SECURITY.md` says so.
- **A member who comes back under a new id starts without an avatar**, and a
  pick made on a merge source after the merge does not reach the merged team.
- **During a rolling update** a pod from before 45.0 answers the route with an
  HTML 404, which the client retries for about seven seconds before saying the
  avatar could not be saved; a 44.x tab ignores `memberAvatars` and draws
  initials. A pod from before 45.0 does not know the map: its single-team
  restore puts the archive's map back (or removes it, when the archive predates
  45.0), and its merge carries the primary's map without re-keying it. So, as
  for Jira, **do not merge or restore while such a pod runs**, during the
  rollout or after a rollback. Its `/update` also accepts `memberAvatars` from
  a client that sends it (it spreads the keys it does not know; no client
  sends this one), so while such a pod runs any team credential can write the
  map whole, dates included. Every reader takes the map as data
  (`memberAvatar`, `isAvatarTime`, `toAvatarId`), the next pick through the
  route rebuilds it from its valid entries, and the most such a write does is
  what the route lets any credential do: set a member's picture.
- **In an anonymous session the comments dialog still names each comment's
  author**, as it did before avatars; only the pictures are hidden there.
- **A pick made in a session is one write of that session**: the route's
  stamp moves its revision, as a vote does, so a participant's write that
  crosses it loses its race and is healed like any other. A first clear made
  in a session is one too, and so is a repeat of the stored choice: both are
  dated and stamped like any pick, and if no stamp comes within
  `SERVER_STAMP_WAIT_MS` the client writes the entry itself (`{ avatar: null,
  avatarAt }` for a clear); a repeat is also one team write (before 45.3 a
  first clear cost the session nothing, and a repeat wrote nothing to the
  team). The route
  builds a limiter of its own, with the team writes' budget (300 a minute per
  address and per pod, which a whole office shares): lower, it would refuse a
  team choosing its pictures together. Being a separate instance, its budget
  adds to the other team routes' (`SECURITY.md` → *Team Passwords*).
- **A pick answered while a Dashboard refresh is on its way** can be drawn
  over by that refresh's answer, read before the pick, until the next
  refresh (the general rule of a write made after a refresh started, see
  *Key Design Principles*); the server holds the pick, and the next refresh
  shows it. The other order is merged, not taken whole: a pick's answer that
  lands after a refresh which read the team later keeps, for each member, the
  newer of the two entries (`mergeMemberAvatars`), so another member's later
  choice stays (`dataServiceAvatar.test.ts` → *keeps a newer choice that a
  refresh brought in while the pick's answer was on its way*).
- **After a merge, a unified member's old sessions can show the other
  picture.** The merged team keeps the main team's choice for a member the
  merge unified, and the sessions that came from the second team carry that
  person's entry with the second team's choice and its time: where that time
  is the newer, those sessions draw the second team's picture and every
  other screen the main team's, until the person picks again.
- **A whole-store restore rolls the team's map back, not what open tabs
  hold.** The newer `at` wins everywhere, so a tab that was open across the
  restore keeps drawing, and stamping into the sessions it enters, the choice
  it knew, until it reloads or its Dashboard refreshes the team; a pick of its
  own no longer brings the other members' entries back to the record's there
  (its answer is merged, the newer entry of each), so their pre-restore
  choices stay drawn too. The record holds the archive's choice, and the next
  pick is newer than both, the archive's picture picked again included.
- **The avatar hint is once per member and browser, not once per person.**
  Everyone on the facilitator's seat is one member, so one choice hides it
  for all of them; a second browser shows it once more until the person
  chooses, a first "My initials" included (the only stop shared by every
  browser); a browser whose storage is blocked shows it on every load, until
  a choice; a second tab of the same
  browser keeps it until it reloads. A participant of a team that only runs
  anonymous sessions never sees it, where no picture would show anyway. It
  pushes the screen down while it shows (69px at 320 and 390px, 43px from
  `sm` to `lg`, 57 to 77px from `lg`), and its going moves the screen up
  once, which is why it is decided with the screen and never comes back
  during one.

The guards: `__tests__/avatars.test.ts` (with `memberAvatarEntries`,
`rosterIds` and `mergeMemberAvatars`), `teamAvatarRoutes.test.ts` (the route,
its two failure answers, its cap, which never evicts the pick just written,
its limiter's 301st pick, a repeat dated again, the stamp and a stamp dated
ahead of the clock), `dataServiceAvatar.test.ts` (an answer that arrives
after a sign-out or another team's login included, and one that lands after
a newer refresh, merged), `appAvatar.test.tsx`, the avatar cases of
`teamMerge.test.ts`, `teamRestore.test.ts` and `archiveContract.test.ts`,
`avatarArt.test.tsx`, `i18nAvatars.test.ts`, `avatarComponent.test.tsx`,
`avatarPicker.test.tsx`, `sessionAvatars.test.ts`, `useOwnAvatar.test.tsx`,
`avatarScreensWiring.test.tsx` (both session types: named, anonymous, the
entry carried by the entering write, the wait after a pick made in the
session), the avatar cases of `sessionRoster.test.ts`, `avatarSource.test.ts`,
`avatarColorSource.test.ts`, and `e2e/avatars.spec.ts` (two browsers: a pick
reaching the other's panel and card, a reload, a clear, a refused save, an
anonymous retrospective, and the picker in the axe audit). The hint's:
`avatarDiscoveryHint.test.tsx` (the rule and the band: English and French,
who sees it, the literal key and the fifty most recent kept under it, a
stored value that is not a list read as nobody, the latch, focus, where a
key's "Got it" hands
the keyboard past an undrawn control to the next drawn one, else to the
opener, and a pointer's moves nothing, the pictures and the sentence from
`lg` and never from `sm`, the visibility class, contrast), `seenOnce.test.ts`
(the shared seen list, and the next drawn control: one under
`display: none`, with or under `hidden`, or under `visibility: hidden` is
passed over), `hasOwnAvatarChoice` and `isAnonymousSession` in
`sessionAvatars.test.ts`,
`hasChoice` in `useOwnAvatar.test.tsx`, the hint cases of
`avatarScreensWiring.test.tsx` (both session types: who sees it, the
opener's width, the picker opened from the header and from the band, the
session turning anonymous, the band still gone when it names its authors
again (which holds the latch on both session screens), "Got it" remembered
across a new mount of the screen, a choice stamped on the viewer's own entry
from their other browser taking the band and the dot away in the render that
draws it, read at every commit through a React `Profiler`, a refused join,
still gone once the connection comes back, a revoked credential, still gone
once another tab's token clears it, a key's "Got it" handing the keyboard to
the first control after the band, and a screen left untouched, which shows
the band again at its next mount) and `appAvatar.test.tsx`
(the dashboard, with the picker opened from the top bar's avatar, a revoked
session, still gone once the revocation is cleared, which holds the latch on
the dashboard, and a key's "Got it" handing the keyboard to the dashboard),
`sessionHeaderLook.test.tsx` and
`healthCheckLook.test.tsx` (the same opener and dot in both headers),
`i18nAvatars.test.ts`, the hint block of `e2e/avatars.spec.ts` (a French
phone's guest and the dashboard, audited as `avatar-hint` and
`avatar-hint-dashboard`; an anonymous retrospective shows none), its band
test (on the dashboard in English and French, at 390,
640, 667, 768 and 1023px no picture and no visible sentence and, from 640px,
one row no taller than its title's line or its buttons with its frame; at
1024 and 1280px the pictures, and the sentence on two lines at most beside
the buttons) and `e2e/i18n.spec.ts`'s header fit (the band in view, no
overflow).
