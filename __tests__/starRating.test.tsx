import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import StarRating, { Star } from '../components/common/StarRating';

/**
 * The stars are an inline SVG rather than the icon font because the
 * self-hosted `material-symbols-outlined.woff2` is a static cut with no `FILL`
 * axis: in it `star`, `star_border`, `star_outline` and `grade` all resolve to
 * the *same* outlined glyph, so a rating drawn with it is four identical hollow
 * stars. These tests pin the two properties that made the SVG worth writing —
 * a partial fill, and a filled/empty difference that is a shape and not only a
 * colour.
 */

const starsOf = (container: HTMLElement) => Array.from(container.querySelectorAll('svg'));
const filledPathOf = (svg: SVGElement) =>
  Array.from(svg.querySelectorAll('path')).find((p) => p.getAttribute('fill') === 'currentColor');

describe('StarRating', () => {
  it('draws one star per point on the scale', () => {
    const { container } = render(<StarRating value={2} />);

    expect(starsOf(container)).toHaveLength(3);
  });

  it('fills the stars up to the score and leaves the rest empty', () => {
    const { container } = render(<StarRating value={2} />);
    const [one, two, three] = starsOf(container);

    expect(filledPathOf(one)).toBeTruthy();
    expect(filledPathOf(two)).toBeTruthy();
    expect(filledPathOf(three)).toBeFalsy();
  });

  // The whole reason this is not three whole stars: an average of 2.5 has to
  // read as 2.5, not round to a number the team never gave.
  it('fills the last star partially for a fractional average', () => {
    const { container } = render(<StarRating value={2.5} />);
    const third = starsOf(container)[2];

    expect(third.querySelector('rect')?.getAttribute('width')).toBe('12');
  });

  it('never overfills or underfills past the ends of the scale', () => {
    const { container } = render(<StarRating value={9} />);

    expect(
      starsOf(container).every((svg) => svg.querySelector('rect')?.getAttribute('width') === '24')
    ).toBe(true);
  });

  // Colour alone cannot carry the difference (WCAG 1.4.1): no amber dark enough
  // to read as gold clears 3:1 against the pale grey an unfilled star wants to
  // be. A solid shape against an outline does.
  it('draws an empty star as an outline, not as a paler fill', () => {
    const { container } = render(<Star fill={0} />);
    const paths = Array.from(container.querySelectorAll('path'));

    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('fill')).toBe('none');
    expect(paths[0].getAttribute('stroke')).toBe('currentColor');
  });

  it('announces itself as one image when it carries the meaning', () => {
    const { getByRole } = render(<StarRating value={2} label="Average impact 2 out of 3" />);

    expect(getByRole('img').getAttribute('aria-label')).toBe('Average impact 2 out of 3');
  });

  // Where the score is already in the text beside it, the stars are decoration:
  // exposing them too makes a screen reader read the same number twice.
  it('stays out of the way when the caller supplies no name', () => {
    const { container, queryByRole } = render(<StarRating value={2} />);

    expect(queryByRole('img')).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  // Two rows on one screen must not share a clipPath id, or the first one's
  // clip silently governs the second.
  it('gives each star its own clip so two ratings cannot collide', () => {
    const { container } = render(
      <>
        <StarRating value={1.5} />
        <StarRating value={2.5} />
      </>
    );
    const ids = Array.from(container.querySelectorAll('clipPath')).map((c) => c.id);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
