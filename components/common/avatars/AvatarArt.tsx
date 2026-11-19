import React from 'react';
import { AVATAR_ART, type AvatarArtId, type AvatarShape } from './avatarArt';

// The attributes a shape may carry, copied by name: whatever else an entry
// might hold never reaches the DOM.
const SHAPE_ATTRIBUTES = [
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2', 'points', 'transform',
] as const;
const SHAPE_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline', 'g']);

const drawShape = (shape: AvatarShape, key: number): React.ReactElement | null => {
  if (!SHAPE_TAGS.has(shape.tag)) return null;
  const props: Record<string, string | number> & { key: number } = { key };
  if (shape.class) props.className = shape.class;
  for (const name of SHAPE_ATTRIBUTES) {
    const value = shape[name];
    if (value !== undefined) props[name] = value;
  }
  return React.createElement(shape.tag, props, shape.children?.map(drawShape));
};

/**
 * One avatar picture. It fills its container and takes its colours from the
 * --av-* variables of the nearest tone-* class (index.css, .avatar-art); the
 * name is said by whatever holds it, so the picture is hidden from assistive
 * technology. An id it does not know draws nothing: the id comes from a value
 * another client stored.
 */
const AvatarArt: React.FC<{ id: AvatarArtId }> = ({ id }) => {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(AVATAR_ART, id)) return null;
  return (
    <svg className="avatar-art" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      {AVATAR_ART[id].map(drawShape)}
    </svg>
  );
};

export default AvatarArt;
