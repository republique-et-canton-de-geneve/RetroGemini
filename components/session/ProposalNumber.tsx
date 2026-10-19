import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';

/**
 * The number badge in front of an action proposal (see `proposalNumbering.ts`).
 * The digit alone would be read out as a bare "4", so a screen reader gets the
 * phrase instead and the digit is hidden from it.
 */
const ProposalNumber: React.FC<{ number: number; surface?: 'light' | 'dark' }> = ({ number, surface = 'light' }) => {
  const { t } = useTranslation();
  const colorClass = surface === 'dark'
    ? 'bg-slate-700 text-slate-50 border border-slate-500'
    : 'bg-slate-700 text-white';

  return (
    <span
      data-testid="proposal-number"
      data-proposal-number={number}
      title={t('phases.proposal.number', { number })}
      className={`inline-flex items-center justify-center min-w-6 h-6 px-1.5 mr-2 rounded-full text-xs font-bold tabular-nums shrink-0 ${colorClass}`}
    >
      <span aria-hidden="true">{number}</span>
      <span className="sr-only">{t('phases.proposal.number', { number })}</span>
    </span>
  );
};

export default ProposalNumber;
