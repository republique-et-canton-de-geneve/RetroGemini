import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { QUIET_AFTER_LIVE_MS, arrivedPeople } from '../../utils/sessionMotion';
import { EFFECT_LENGTH_MS, motionAllowed } from '../common/motion/effects';

/**
 * The participants panel's motion: who just arrived, who just finished, and
 * whether the head's count just changed. Every effect is decoration — the row,
 * the check and the number are already on screen — so this only decides which
 * classes of `index.css` (`fx-person-in`, `fx-pop`, `fx-halo`, `fx-bump`) a
 * row wears for the length of one animation.
 *
 * Something plays only when it just happened, read by comparing what the
 * panel showed at its previous commit with what it shows now: never because
 * an element was drawn (a collapsed panel expanded, a phase change). And it
 * stays quiet when a change is not news:
 *
 * - before the server's first roster since the session was last live
 *   (`ready`, which the screens put down when it stops being live): the rows
 *   drawn until then come from the cached session, or from before the outage,
 *   and are never compared with what it says; then on that first population
 *   (`arrivedPeople` answers nobody when it has no previous list) and for
 *   `QUIET_MS` after it, however late it lands;
 * - for `QUIET_MS` after the viewer's own connection comes back, when every
 *   roster is delivered again;
 * - when more than two people arrive, or more than two finish, at once (a
 *   reconnect wave, a restore);
 * - while the panel is collapsed, on the render that expands it, and when the
 *   scope (the phase) changes, which can turn every row's check on at once;
 * - for a reader who asked for less motion, or whose browser cannot say (no
 *   `matchMedia`): the classes stay off the page, by the rule every effect
 *   follows (`motionAllowed`).
 */

/** How long after the mount, or after the viewer's own reconnection, nothing plays: the board's seconds too. */
export const QUIET_MS = QUIET_AFTER_LIVE_MS;
/**
 * How long a row wears the arrival (ms): its longest piece, the presence dot's
 * two pulses after 0.3s (`fx-halo`), past the row's slide and wash
 * (`fx-person-in`) and the avatar's spring (`fx-pop`), and a margin. The panel
 * listens for no animationend, so its classes come off by this clock alone:
 * read from `EFFECT_LENGTH_MS`, which `__tests__/motionEffects.test.ts` holds
 * to index.css, an animation lengthened there is never cut short here.
 */
export const ARRIVAL_MS = Math.max(EFFECT_LENGTH_MS['fx-person-in'], EFFECT_LENGTH_MS['fx-halo'], EFFECT_LENGTH_MS['fx-pop']) + 100;
/** How long a check springs in (`fx-pop`) and the title's count bumps (`fx-bump`), and a margin (ms). */
export const POP_MS = Math.max(EFFECT_LENGTH_MS['fx-pop'], EFFECT_LENGTH_MS['fx-bump']) + 50;

export interface PanelMotionInput {
  /** Who is listed and connected, in any order. The viewer is ignored. */
  presentIds: readonly string[];
  /** Who is listed and has not left, in any order. */
  activeIds: readonly string[];
  /** Who shows a check right now (done for the phase). */
  checkedIds: readonly string[];
  /** The number in the panel's title. */
  count: number;
  isCollapsed: boolean;
  /** The viewer's own connection. Without it the panel counts as live. */
  isLive: boolean;
  /** Changes whenever a change of the whole board is not news (the phase). */
  scope?: string;
  /**
   * The server's first roster since the session was last live has been
   * applied. Until then nothing is compared, and the quiet seconds open when
   * it turns true. Without it the panel counts as ready from its mount.
   */
  ready?: boolean;
  currentUserId: string;
}

export interface PanelMotion {
  /** The rows that wear the arrival: slide, wash, avatar spring, presence pulse. */
  arriving: ReadonlySet<string>;
  /** The rows whose check springs in. */
  finishing: ReadonlySet<string>;
  /** 0 at rest; a new number each time the count changed, to restart the bump. */
  bump: number;
}

const EMPTY: ReadonlySet<string> = new Set();

const sortedKey = (ids: readonly string[]) => [...ids].sort().join('\u0000');

export function usePanelMotion(input: PanelMotionInput): PanelMotion {
  const { presentIds, activeIds, checkedIds, count, isCollapsed, isLive, scope, currentUserId, ready = true } = input;
  const [arriving, setArriving] = useState<ReadonlySet<string>>(EMPTY);
  const [finishing, setFinishing] = useState<ReadonlySet<string>>(EMPTY);
  const [bump, setBump] = useState(0);

  const previous = useRef<{
    present: string[];
    active: Set<string>;
    checked: string[];
    count: number;
    scope: string | undefined;
    isLive: boolean;
    isCollapsed: boolean;
  } | null>(null);
  const quietUntil = useRef<number>(0);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const bumps = useRef(0);

  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      fn();
    }, ms);
    timers.current.add(timer);
  };

  const presentKey = sortedKey(presentIds);
  const activeKey = sortedKey(activeIds);
  const checkedKey = sortedKey(checkedIds);

  // A layout effect, so the class is on before the browser paints the new row:
  // painted once without it, the row would flash in place before sliding.
  useLayoutEffect(() => {
    const now = Date.now();
    // The seed drawn before the server's first roster since the session was
    // last live is never a "before".
    if (!ready) {
      previous.current = null;
      return;
    }
    const before = previous.current;
    const present = presentIds.filter((id) => id !== currentUserId);
    const checked = [...checkedIds];
    previous.current = {
      present,
      active: new Set(activeIds),
      checked,
      count,
      scope,
      isLive,
      isCollapsed,
    };
    if (!before) {
      quietUntil.current = now + QUIET_MS;
      return;
    }
    if (isLive && !before.isLive) quietUntil.current = now + QUIET_MS;

    const calm =
      isLive &&
      !isCollapsed &&
      !before.isCollapsed &&
      before.scope === scope &&
      now >= quietUntil.current &&
      motionAllowed();
    if (!calm) return;

    const arrived = arrivedPeople(before.present, present);
    // A check that comes back with a row marked as returned is not news: only a
    // row that was active before can finish.
    const finished = arrivedPeople(before.checked, checked).filter((id) => before.active.has(id));

    // Each row wears its class now, and takes it off once its effect is over.
    const flash = (set: typeof setArriving, ids: string[], ms: number) => {
      if (ids.length === 0) return;
      set((current) => new Set([...current, ...ids]));
      later(ms, () =>
        set((current) => {
          const next = new Set(current);
          ids.forEach((id) => next.delete(id));
          return next.size ? next : EMPTY;
        })
      );
    };
    flash(setArriving, arrived, ARRIVAL_MS);
    flash(setFinishing, finished, POP_MS);
    if (count !== before.count) {
      // A second change within the bump restarts it, and only the last one ends it.
      const mine = ++bumps.current;
      setBump(mine);
      later(POP_MS, () => setBump((value) => (value === mine ? 0 : value)));
    }
    // The keys stand for the lists: a new array of the same people is no change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentKey, activeKey, checkedKey, count, isCollapsed, isLive, scope, currentUserId, ready]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return { arriving, finishing, bump };
}
