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
    <div className="flex border-b border-slate-200 mb-6 overflow-x-auto">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`dash-tab px-6 py-3 font-bold text-sm flex items-center transition whitespace-nowrap ${activeTab === tab.id ? 'active' : 'text-slate-500 hover:text-retro-primary'}`}
        >
          <span className="material-symbols-outlined mr-2">{tab.icon}</span>
          {t(tab.labelKey)}
        </button>
      ))}
    </div>
  );
};

export default DashboardTabs;
