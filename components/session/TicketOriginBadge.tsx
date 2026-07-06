import React from 'react';
import { Column } from '../../types';

// Chip shown on a ticket that currently sits in a different column than the
// one it was written in (cross-column grouping). It keeps the original
// sentiment visible — e.g. a "went well" card grouped under a "went wrong"
// topic — through the Group, Vote, Discuss and Review phases, so diverging
// viewpoints gathered on one subject never lose where each card came from.
// The white pill keeps the chip readable on any card background colour.
const TicketOriginBadge: React.FC<{ column: Column; className?: string }> = ({ column, className = '' }) => (
  <span
    data-testid="ticket-origin-badge"
    title={`This ticket was originally written in "${column.title}"`}
    className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/90 border border-slate-200 text-slate-600 shadow-xs max-w-full ${className}`}
  >
    <span
      className={`material-symbols-outlined text-xs leading-none shrink-0 ${!column.customColor ? column.text : ''}`}
      style={column.customColor ? { color: column.customColor } : undefined}
      aria-hidden="true"
    >
      {column.icon}
    </span>
    <span className="truncate">from {column.title}</span>
  </span>
);

export default TicketOriginBadge;
