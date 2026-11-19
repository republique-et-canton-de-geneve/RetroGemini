import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import type { MessageKey } from '../../i18n/translate';

export type DashboardTab = 'ACTIONS' | 'RETROS' | 'HEALTH_CHECKS' | 'MEMBERS' | 'SETTINGS' | 'FEEDBACK';

interface Props {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}

// Message keys, not labels: the list is built once at module load, before any
// language is known, so the label is translated at render time.
const TABS: { id: DashboardTab; labelKey: MessageKey; icon: string }[] = [
  { id: 'ACTIONS', labelKey: 'dashboard.tabs.ACTIONS', icon: 'check_circle' },
  { id: 'RETROS', labelKey: 'dashboard.tabs.RETROS', icon: 'history' },
  { id: 'HEALTH_CHECKS', labelKey: 'dashboard.tabs.HEALTH_CHECKS', icon: 'monitoring' },
  { id: 'MEMBERS', labelKey: 'dashboard.tabs.MEMBERS', icon: 'groups' },
  { id: 'SETTINGS', labelKey: 'dashboard.tabs.SETTINGS', icon: 'settings' },
  { id: 'FEEDBACK', labelKey: 'dashboard.tabs.FEEDBACK', icon: 'hub' }
];

const DashboardTabs: React.FC<Props> = ({ activeTab, onChange }) => {
  const { t } = useTranslation();
  return (
    // The current tab is drawn by `.dash-tab.active` in index.css (the brand
    // colour and its underline); the others are slate-600, which reads on the
    // page's grey where slate-500 does not.
    <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`dash-tab -mb-px px-4 py-3 font-semibold text-sm flex items-center gap-2 rounded-t-lg transition whitespace-nowrap ${activeTab === tab.id ? 'active' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`}
        >
          <span className="material-symbols-outlined text-xl! leading-none" aria-hidden="true">{tab.icon}</span>
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default DashboardTabs;
