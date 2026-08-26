/**
 * Finds `<label>` elements that name nothing.
 *
 * A label is only a label to assistive technology if it resolves to a form
 * control — by wrapping one, or by `htmlFor` pointing at one that exists. The
 * accessibility audit (H42) left 29 that did neither: visually they sat above
 * their field, so the defect is invisible on screen, and **axe reports none of
 * them** because every one of those inputs carries a `placeholder`, which axe
 * accepts as an accessible name of last resort. That is why this is a unit
 * check and not another axe rule.
 *
 * A placeholder is not a label: it disappears the moment the user types, it is
 * not spoken by every screen reader as a name, and it cannot be clicked to
 * focus the field.
 *
 * Reads `HTMLLabelElement.control`, which the HTML standard defines as exactly
 * this resolution — nesting first, then `for`, and only against *labelable*
 * elements. So a `htmlFor` aimed at a `<div>` counts as orphaned here just as
 * it does in a browser, and no selector list of our own can drift from the
 * spec's.
 *
 * Not a `*.test.ts` file, so vitest does not collect it as a suite.
 */

/**
 * The visible text of every label in `root` that names no control. An empty
 * array is the passing state; the text is returned rather than the element so
 * a failure message names the field a human can find on screen.
 */
export const orphanLabels = (root: HTMLElement = document.body): string[] =>
  Array.from(root.querySelectorAll('label'))
    .filter((label) => label.control === null)
    .map((label) => label.textContent?.replace(/\s+/g, ' ').trim() ?? '(empty label)');
