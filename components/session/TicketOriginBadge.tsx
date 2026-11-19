import React from 'react';
import { Column } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import { columnHue } from '../../utils/columnHue';
import { cardTones } from '../../utils/cardTones';
import { columnIconName } from '../iconPickerIcons';

// Chip shown on a ticket that currently sits in a different column than the
// one it was written in (cross-column grouping). It keeps the original
// sentiment visible — e.g. a "went well" card grouped under a "went wrong"
// topic — through the Group, Vote, Discuss and Review phases, so diverging
// viewpoints gathered on one subject never lose where each card came from.
// The white pill keeps the chip readable on any card background colour. Its
// icon takes the origin column's ink (utils/cardTones.ts), which reads on
// white whatever the column's colour: the raw colour did not (a pale custom
// colour measured under 3:1).
const TicketOriginBadge: React.FC<{ column: Column; className?: string }> = ({ column, className = '' }) => {
  const { t } = useTranslation();
  const ink = cardTones(columnHue(column))?.ink;
  return (
    <span
      data-testid="ticket-origin-badge"
      title={t('session.originBadge.title', { column: column.title })}
      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-700 max-w-full ${className}`}
    >
      <span
        className={`material-symbols-outlined text-sm! leading-none shrink-0 ${ink ? '' : 'text-slate-500'}`}
        style={ink ? { color: ink } : undefined}
        aria-hidden="true"
      >
        {columnIconName(column.icon)}
      </span>
      <span className="truncate">{t('session.originBadge.from', { column: column.title })}</span>
    </span>
  );
};

export default TicketOriginBadge;
