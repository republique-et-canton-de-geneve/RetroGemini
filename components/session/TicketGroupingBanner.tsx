import React from 'react';

/**
 * The banners the Group phase puts on a ticket card.
 *
 * Deliberately normal-flow blocks with negative margins — flush with the card
 * edges, pushing the content down — instead of absolutely positioned overlays.
 * An earlier `inset-0` overlay covered the ticket text it was announcing, which
 * is exactly what a grouping affordance must not do.
 */

export type TicketGroupingBannerVariant = 'drop-target' | 'selected';

const BANNER = {
  'drop-target': {
    className: 'bg-indigo-500',
    icon: 'merge',
    label: 'Group with this'
  },
  selected: {
    className: 'bg-blue-500',
    icon: 'touch_app',
    label: 'Selected - Tap to cancel'
  }
} as const;

const TicketGroupingBanner: React.FC<{ variant: TicketGroupingBannerVariant }> = ({ variant }) => {
  const { className, icon, label } = BANNER[variant];
  return (
    <div
      className={`-mx-3 -mt-3 mb-2 ${className} flex items-center justify-center rounded-t font-bold text-white text-xs py-1 pointer-events-none`}
    >
      <span className="material-symbols-outlined text-sm mr-1">{icon}</span> {label}
    </div>
  );
};

export default TicketGroupingBanner;
