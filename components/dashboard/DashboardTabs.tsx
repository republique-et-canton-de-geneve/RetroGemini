import React from 'react';

export type DashboardTab = 'ACTIONS' | 'RETROS' | 'HEALTH_CHECKS' | 'MEMBERS' | 'SETTINGS' | 'FEEDBACK';

interface Props {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
}

const TABS: { id: DashboardTab; label: string; icon: string }[] = [
  { id: 'ACTIONS', label: 'Actions', icon: 'check_circle' },
  { id: 'RETROS', label: 'Retrospectives', icon: 'history' },
  { id: 'HEALTH_CHECKS', label: 'Health Checks', icon: 'monitoring' },
  { id: 'MEMBERS', label: 'Members', icon: 'groups' },
  { id: 'SETTINGS', label: 'Settings', icon: 'settings' },
  { id: 'FEEDBACK', label: 'Feedback Hub', icon: 'hub' }
];

const DashboardTabs: React.FC<Props> = ({ activeTab, onChange }) => (
  <div className="flex border-b border-slate-200 mb-6 overflow-x-auto">
    {TABS.map((tab) => (
      <button
        key={tab.id}
        onClick={() => onChange(tab.id)}
        className={`dash-tab px-6 py-3 font-bold text-sm flex items-center transition whitespace-nowrap ${activeTab === tab.id ? 'active' : 'text-slate-500 hover:text-retro-primary'}`}
      >
        <span className="material-symbols-outlined mr-2">{tab.icon}</span>
        {tab.label}
      </button>
    ))}
  </div>
);

export default DashboardTabs;
