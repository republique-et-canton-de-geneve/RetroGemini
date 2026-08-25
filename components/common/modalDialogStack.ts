/**
 * The stack of open modal dialogs.
 *
 * Module-level state rather than a React context: it has to be readable from
 * plain `document` keydown listeners — including ones outside the dialog tree,
 * such as the Group phase's Escape handler — and a context would not reach
 * them.
 *
 * It lives in its own file so `ModalDialog.tsx` exports a component and nothing
 * else. Mixing a component export with a runtime helper breaks fast refresh,
 * and the lint rule that says so is right about the shape: this is shared
 * state, not a detail of one component.
 */

/** Open dialogs, innermost last. */
const openDialogs: symbol[] = [];

/** Register a dialog as open. Returns the function that removes it again. */
export const pushDialog = (id: symbol): (() => void) => {
  openDialogs.push(id);
  return () => {
    const index = openDialogs.indexOf(id);
    if (index > -1) openDialogs.splice(index, 1);
  };
};

/**
 * Whether `id` is the dialog Escape belongs to. With one `document` listener
 * per dialog, a confirmation opened over a modal would otherwise close both at
 * once.
 */
export const isTopDialog = (id: symbol): boolean =>
  openDialogs[openDialogs.length - 1] === id;

/**
 * Whether any modal dialog is open.
 *
 * The one caller outside this layer is the Group phase's own Escape handler.
 * Both are `document` listeners, and `stopPropagation()` does not stop other
 * listeners already registered on the same target — so without this, one Escape
 * both closed the dialog and dropped the held card (Codex, PR #436). Escape
 * belongs to the dialog while a dialog is open; everything else stands down.
 */
export const hasOpenModalDialog = (): boolean => openDialogs.length > 0;
