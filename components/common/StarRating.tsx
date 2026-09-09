import React, { useId } from 'react';

/**
 * Stars, for the impact rating and its rollups.
 *
 * ## Why this is an inline SVG and not the icon font
 *
 * Every other icon in this product comes from the self-hosted
 * `public/fonts/material-symbols-outlined.woff2`, and the offline rule says to
 * keep it that way. This is the one control that cannot: that file is a
 * **static** cut with no `FILL` axis, and in it `star`, `star_border`,
 * `star_outline` and `grade` all resolve to the *same* outlined glyph — so the
 * font cannot draw a filled star at all, and a "rating" made of four identical
 * hollow stars says nothing.
 *
 * Swapping in the variable font to recover `FILL` would replace a shared asset
 * every screen depends on, for one control. An inline path costs nothing, works
 * offline exactly like the font does, and is the only way to draw the partial
 * fill an average of 2.5 actually needs.
 *
 * ## Filled and empty differ in shape, not only in colour
 *
 * A filled star is solid; an empty one is an outline. That keeps the two states
 * distinguishable without relying on colour (WCAG 1.4.1), which matters here
 * because no amber dark enough to read as gold clears 3:1 against the pale grey
 * a "not filled" star wants to be. Callers pair the stars with the score or the
 * label in text as well.
 */

/** Material's star, on the same 24×24 grid as every icon around it. */
const STAR_PATH =
  'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z';

interface StarProps {
  /** How much of this star is filled, 0 to 1. */
  fill: number;
  className?: string;
}

export const Star: React.FC<StarProps> = ({ fill, className = 'w-4 h-4' }) => {
  // `useId` yields colons, which are legal in an id but awkward everywhere they
  // are read back; strip them so the `url(#…)` reference stays boring.
  const clipId = `star-${useId().replace(/:/g, '')}`;
  const clamped = Math.max(0, Math.min(1, fill));

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        d={STAR_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        className="text-slate-400"
      />
      {clamped > 0 && (
        <>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={24 * clamped} height="24" />
          </clipPath>
          <path d={STAR_PATH} fill="currentColor" clipPath={`url(#${clipId})`} />
        </>
      )}
    </svg>
  );
};

interface StarRatingProps {
  /** The score, on a 1..`max` scale. Fractions fill the last star partially. */
  value: number;
  /** How many stars the scale has. The impact rating is out of 3. */
  max?: number;
  /** Tailwind classes for one star (size). */
  starClassName?: string;
  /** Tailwind classes for the row — this is where the fill colour goes. */
  className?: string;
  /**
   * When given, the row is announced as one image with this name. Leave it out
   * where the stars merely repeat a number that is already in the text, so a
   * screen reader hears the score once rather than twice.
   */
  label?: string;
}

const StarRating: React.FC<StarRatingProps> = ({
  value,
  max = 3,
  starClassName = 'w-4 h-4',
  className = 'text-amber-600',
  label
}) => (
  <span
    className={`inline-flex items-center gap-0.5 ${className}`}
    {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': 'true' as const })}
  >
    {Array.from({ length: max }, (_, index) => (
      <Star key={index} fill={value - index} className={starClassName} />
    ))}
  </span>
);

export default StarRating;
