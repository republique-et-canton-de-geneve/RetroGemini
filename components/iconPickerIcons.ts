/**
 * The Material Symbols names a facilitator can give a column. A chosen name is
 * stored on the template or the session and drawn as a font ligature, so every
 * name here must be one the font draws: `e2e-prod/icon-ligatures.spec.ts`
 * measures each in the built application.
 */
export const ICON_PICKER_ICONS: ReadonlyArray<{ name: string; keywords: string }> = [
  // Emotions & Feedback
  { name: 'sentiment_satisfied', keywords: 'happy smile emotion positive' },
  { name: 'sentiment_very_satisfied', keywords: 'very happy smile emotion positive great' },
  { name: 'sentiment_dissatisfied', keywords: 'sad unhappy emotion negative' },
  { name: 'sentiment_very_dissatisfied', keywords: 'very sad angry emotion negative bad' },
  { name: 'sentiment_neutral', keywords: 'neutral meh emotion okay' },
  { name: 'mood', keywords: 'happy emotion positive' },
  { name: 'mood_bad', keywords: 'sad negative emotion' },
  { name: 'thumb_up', keywords: 'like approve positive good' },
  { name: 'thumb_down', keywords: 'dislike disapprove negative bad' },
  { name: 'favorite', keywords: 'heart love like star' },
  { name: 'favorite_border', keywords: 'heart love like star outline-solid' },

  // Actions & Movement
  { name: 'play_arrow', keywords: 'start begin play action go' },
  { name: 'stop', keywords: 'stop end halt action' },
  { name: 'pause', keywords: 'pause wait hold action' },
  { name: 'fast_forward', keywords: 'continue forward next action' },
  { name: 'arrow_forward', keywords: 'next forward continue arrow' },
  { name: 'arrow_back', keywords: 'back previous return arrow' },
  { name: 'arrow_upward', keywords: 'up improve increase arrow' },
  { name: 'arrow_downward', keywords: 'down decrease reduce arrow' },
  { name: 'trending_up', keywords: 'improve increase growth success' },
  { name: 'trending_down', keywords: 'decrease decline reduce problem' },
  { name: 'trending_flat', keywords: 'stable steady neutral' },
  { name: 'north_east', keywords: 'improve growth increase diagonal' },
  { name: 'south_east', keywords: 'decline reduce decrease diagonal' },

  // Ideas & Learning
  { name: 'lightbulb', keywords: 'idea innovation think creative learn' },
  { name: 'auto_fix_high', keywords: 'magic improve experiment sparkle' },
  { name: 'psychology', keywords: 'think brain mind thought learn' },
  { name: 'school', keywords: 'learn education study knowledge' },
  { name: 'science', keywords: 'experiment research learn discover' },
  { name: 'emoji_objects', keywords: 'idea lightbulb innovation creative' },
  { name: 'tips_and_updates', keywords: 'idea suggestion tip lightbulb' },

  // Goals & Achievements
  { name: 'flag', keywords: 'goal target finish achievement' },
  { name: 'military_tech', keywords: 'achievement medal award success' },
  { name: 'trophy', keywords: 'win achievement success award' },
  { name: 'emoji_events', keywords: 'event achievement trophy award' },
  { name: 'workspace_premium', keywords: 'premium quality badge achievement' },
  { name: 'star', keywords: 'favorite important highlight achievement' },
  { name: 'star_border', keywords: 'favorite important highlight outline-solid' },
  { name: 'grade', keywords: 'rating star important' },
  { name: 'check_circle', keywords: 'complete done success tick yes' },
  { name: 'task_alt', keywords: 'complete done success tick checkmark' },

  // Problems & Risks
  { name: 'warning', keywords: 'alert caution problem risk danger' },
  { name: 'error', keywords: 'error problem issue mistake wrong' },
  { name: 'report_problem', keywords: 'alert warning issue problem' },
  { name: 'dangerous', keywords: 'risk danger hazard problem' },
  { name: 'cancel', keywords: 'close remove delete no stop' },
  { name: 'block', keywords: 'stop block prevent prohibited' },
  { name: 'do_not_disturb', keywords: 'block stop prevent no' },
  { name: 'remove_circle', keywords: 'delete remove minus negative' },

  // Navigation & Journey
  { name: 'sailing', keywords: 'boat ship journey travel wind' },
  { name: 'anchor', keywords: 'hold steady slow blocker ship' },
  { name: 'directions_boat', keywords: 'boat ship journey sailing' },
  { name: 'rocket_launch', keywords: 'rocket start launch fast boost' },
  { name: 'flight_takeoff', keywords: 'plane start launch takeoff' },
  { name: 'explore', keywords: 'compass direction navigate discovery' },
  { name: 'map', keywords: 'journey plan navigation route' },
  { name: 'place', keywords: 'location destination target goal' },
  { name: 'near_me', keywords: 'direction navigation location' },

  // Communication & Collaboration
  { name: 'chat', keywords: 'talk discuss communicate message' },
  { name: 'chat_bubble', keywords: 'talk discuss communicate message' },
  { name: 'forum', keywords: 'discuss talk communicate conversation' },
  { name: 'question_answer', keywords: 'qa question help support chat' },
  { name: 'groups', keywords: 'team people collaboration together' },
  { name: 'diversity_3', keywords: 'team people collaboration diverse' },
  { name: 'people', keywords: 'team group collaboration together' },
  { name: 'handshake', keywords: 'agree deal partnership collaboration' },
  { name: 'campaign', keywords: 'announce communicate megaphone' },
  { name: 'record_voice_over', keywords: 'speak announce voice communication' },

  // Time & Speed
  { name: 'schedule', keywords: 'time clock timing plan' },
  { name: 'timer', keywords: 'time clock countdown timing' },
  { name: 'hourglass_empty', keywords: 'time wait timing patience' },
  { name: 'speed', keywords: 'fast quick velocity performance' },
  { name: 'slow_motion_video', keywords: 'slow delay performance' },
  { name: 'update', keywords: 'refresh reload renew time' },
  { name: 'history', keywords: 'past time previous retrospective' },

  // Work & Tools
  { name: 'work', keywords: 'job task work briefcase business' },
  { name: 'build', keywords: 'tool fix create make construct' },
  { name: 'construction', keywords: 'build make tools work progress' },
  { name: 'handyman', keywords: 'fix repair tools work' },
  { name: 'settings', keywords: 'configure adjust settings tools' },
  { name: 'tune', keywords: 'adjust configure settings fine-tune' },
  { name: 'engineering', keywords: 'build create develop technical' },

  // Puzzle & Problems
  { name: 'extension', keywords: 'puzzle piece plugin extend' },
  { name: 'view_module', keywords: 'blocks components parts modules' },
  { name: 'widgets', keywords: 'components parts tools features' },
  { name: 'apps', keywords: 'grid modules components blocks' },

  // Energy & Power
  { name: 'bolt', keywords: 'energy power lightning fast speed' },
  { name: 'flash_on', keywords: 'energy power speed lightning' },
  { name: 'electric_bolt', keywords: 'energy power lightning speed' },
  { name: 'battery_charging_full', keywords: 'energy power charge full' },
  { name: 'power', keywords: 'energy strength force capability' },

  // Growth & Nature
  { name: 'eco', keywords: 'nature growth green sustainable' },
  { name: 'local_florist', keywords: 'flower nature growth bloom' },
  { name: 'spa', keywords: 'wellness health relax balance' },
  { name: 'park', keywords: 'nature tree growth environment' },
  { name: 'yard', keywords: 'nature garden growth outside' },

  // Focus & Target
  { name: 'my_location', keywords: 'target focus center point' },
  { name: 'gps_fixed', keywords: 'target focus location center' },
  { name: 'center_focus_strong', keywords: 'target focus center aim' },
  { name: 'filter_center_focus', keywords: 'target focus center aim' },

  // Quality & Excellence
  { name: 'verified', keywords: 'check quality approved certified' },
  { name: 'verified_user', keywords: 'check quality approved certified secure' },
  { name: 'new_releases', keywords: 'new feature update quality' },
  { name: 'auto_awesome', keywords: 'quality excellent magic special' },
  { name: 'diamond', keywords: 'valuable quality premium excellent' },

  // Visibility & Clarity
  { name: 'visibility', keywords: 'see view show reveal transparent' },
  { name: 'visibility_off', keywords: 'hide hidden invisible blind' },
  { name: 'remove_red_eye', keywords: 'see view visibility observe' },
  { name: 'light_mode', keywords: 'clarity clear bright focus sharp understanding' },

  // Balance & Harmony
  { name: 'balance', keywords: 'balance harmony equal equilibrium' },
  { name: 'adjust', keywords: 'tune balance configure settings' },
  { name: 'whatshot', keywords: 'fire hot popular trending burning' },
  { name: 'ac_unit', keywords: 'cold cool freeze ice snow' },

  // Miscellaneous Useful Icons
  { name: 'health_and_safety', keywords: 'health safety wellness protection' },
  { name: 'bug_report', keywords: 'bug issue problem error defect' },
  { name: 'priority_high', keywords: 'important urgent priority critical' },
  { name: 'bookmark', keywords: 'save remember mark important' },
  { name: 'label', keywords: 'tag category organize classify' },
  { name: 'local_fire_department', keywords: 'fire urgent hot critical' },
  { name: 'wb_sunny', keywords: 'sun bright positive happy energy' },
  { name: 'nightlight', keywords: 'moon night calm quiet peaceful' },
  { name: 'celebration', keywords: 'party celebrate success happy achievement' },
  { name: 'cake', keywords: 'celebrate party achievement success' },
  { name: 'recycling', keywords: 'recycle reuse improve iterate cycle' },
  { name: 'refresh', keywords: 'reload renew update restart refresh' },
  { name: 'sync', keywords: 'synchronize update refresh alignment' },
  { name: 'lock', keywords: 'secure safe private protected blocked' },
  { name: 'lock_open', keywords: 'unlock open accessible available' },
  { name: 'key', keywords: 'access unlock solution important' },
  { name: 'push_pin', keywords: 'pin important keep remember' },
  { name: 'attach_file', keywords: 'attach link connect document' },
  { name: 'link', keywords: 'connect chain attach relationship' },
];

/**
 * Names a column may have stored that no cut of the font draws, and the name
 * drawn instead. The picker offered `clarity` until 45.0, and the font has no
 * such ligature: it showed as the word itself. Nothing is written back; the
 * stored value is read this way wherever a column's icon is drawn.
 */
const STORED_ICON_ALIASES: Readonly<Record<string, string>> = { clarity: 'light_mode' };

/** The ligature to draw for a column's stored icon name. */
export const columnIconName = (stored: string): string =>
  Object.prototype.hasOwnProperty.call(STORED_ICON_ALIASES, stored) ? STORED_ICON_ALIASES[stored] : stored;
