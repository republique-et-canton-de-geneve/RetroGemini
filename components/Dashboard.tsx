
import React, { useState, useMemo, useEffect } from 'react';
import { Team, User, RetroSession, Column, HealthCheckSession, HealthCheckTemplate, HealthCheckDimension, TeamFeedback as TeamFeedbackType } from '../types';
import { dataService } from '../services/dataService';
import {
  PASSWORD_MIN_LENGTH,
  isPasswordLongEnough
} from '../utils/passwordPolicy.js';
import { randomId } from '../utils/randomId';
import { readableTextColor } from '../utils/colorUtils';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';
import TeamFeedback from './TeamFeedback';
import DashboardActionsTab from './dashboard/DashboardActionsTab';
import DashboardTabs, { DashboardTab } from './dashboard/DashboardTabs';
import { getSuggestedName } from './dashboard/dashboardUtils';
import { localizeDecimal } from '../i18n/formatNumber';
import { sortActionsByClosure, sortActionsByRecency } from './dashboard/actionSorting';
import { retroImpactSummary } from './dashboard/actionImpact';
import { ROTI_MAX, retroRotiSummary } from './dashboard/retroRoti';
import StarRating from './common/StarRating';
import { isActionImpactRatingEnabled } from './session/closedActionsForRating';
import { groupHealthChecksByTemplate } from './dashboard/healthCheckUtils';
import ReleaseAnalysisModal from './dashboard/ReleaseAnalysisModal';
import ModalDialog from './common/ModalDialog';
import { useTranslation } from '../i18n/I18nContext';
import { Notice, noticeText } from '../i18n/notice';
import { Language, LANGUAGE_NATIVE_NAMES, SUPPORTED_LANGUAGES } from '../i18n/languages';
import {
  RETRO_TEMPLATES,
  getCustomTemplateStarterColumns,
  getDefaultRetroName,
  getRetroTemplateColumns,
  getRetroTemplateWords,
  initialTemplateLanguage
} from '../i18n/content/retroTemplates';
import { effectiveSessionStatus } from '../utils/sessionStatus';

interface Props {
  team: Team;
  currentUser: User;
  onOpenSession: (id: string) => void;
  onOpenHealthCheck: (id: string) => void;
  onRefresh: () => void;
  onDeleteTeam?: () => void;
  initialTab?: 'ACTIONS' | 'RETROS' | 'HEALTH_CHECKS' | 'MEMBERS' | 'SETTINGS' | 'FEEDBACK';
}

const Dashboard: React.FC<Props> = ({ team, currentUser, onOpenSession, onOpenHealthCheck, onRefresh, onDeleteTeam, initialTab = 'ACTIONS' }) => {
  const { t, tp, tRich, language, locale } = useTranslation();
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [actionFilter, setActionFilter] = useState<'OPEN' | 'CLOSED' | 'ALL'>('OPEN');
  const [showNewRetroModal, setShowNewRetroModal] = useState(false);
  const [showNewHealthCheckModal, setShowNewHealthCheckModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [retroToDelete, setRetroToDelete] = useState<RetroSession | null>(null);
  const [healthCheckToDelete, setHealthCheckToDelete] = useState<HealthCheckSession | null>(null);
  const [memberPendingRemoval, setMemberPendingRemoval] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [editingMemberEmail, setEditingMemberEmail] = useState('');
  const [memberEditError, setMemberEditError] = useState<Notice>(null);
  const [editingRetroId, setEditingRetroId] = useState<string | null>(null);
  const [editingRetroName, setEditingRetroName] = useState('');
  const [editingHealthCheckId, setEditingHealthCheckId] = useState<string | null>(null);
  const [editingHealthCheckName, setEditingHealthCheckName] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [showReleaseAnalysisModal, setShowReleaseAnalysisModal] = useState(false);

  // Health Check State
  const [healthCheckName, setHealthCheckName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [isHealthCheckAnonymous, setIsHealthCheckAnonymous] = useState(false);
  const [healthCheckOffsets, setHealthCheckOffsets] = useState<Record<string, number>>({});
  const MAX_VISIBLE_HEALTH_CHECKS = 6;

  // Settings State - Custom Template Editor
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<HealthCheckTemplate | null>(null);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDimensions, setNewTemplateDimensions] = useState<HealthCheckDimension[]>([]);
  const [expandedTemplates, setExpandedTemplates] = useState<string[]>([]);

  // Settings State - Password Change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState<Notice>(null);
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState<Notice>(null);
  // A restored session is token-only (stage 7e: no password is persisted in
  // the browser), so rotating the password must collect the current one.
  const needsCurrentPassword = !dataService.getAuthenticatedPassword();

  // Settings State - Team Rename
  const [newTeamName, setNewTeamName] = useState('');
  const [teamRenameError, setTeamRenameError] = useState<Notice>(null);
  const [teamRenameSuccess, setTeamRenameSuccess] = useState<Notice>(null);

  // Get available health check templates
  const healthCheckTemplates = useMemo(() => {
    return dataService.getHealthCheckTemplates(team.id);
  }, [team.id, team.customHealthCheckTemplates]);

  // Get health checks with statistics
  const healthChecks = team.healthChecks || [];
  const orderedHealthChecks = useMemo(() => [...healthChecks].reverse(), [healthChecks]);
  const healthChecksByTemplate = useMemo(() => groupHealthChecksByTemplate(orderedHealthChecks), [orderedHealthChecks]);

  useEffect(() => {
    if (tab !== 'HEALTH_CHECKS') return;

    setHealthCheckOffsets(prev => {
      let changed = false;
      const next = { ...prev };

      healthChecksByTemplate.forEach(group => {
        if (next[group.templateId] == null) {
          next[group.templateId] = Math.max(0, group.checks.length - MAX_VISIBLE_HEALTH_CHECKS);
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [healthChecksByTemplate, tab]);

  useEffect(() => {
    const loadInfoMessage = async () => {
      try {
        const response = await fetch('/api/info-message');
        if (response.ok) {
          const data = await response.json();
          setInfoMessage(data.infoMessage || '');
        }
      } catch (err) {
        console.error('Failed to load info message', err);
      }
    };
    loadInfoMessage();
  }, []);

  useEffect(() => {
    fetch('/api/ai-status')
      .then(r => r.json())
      .then(d => setAiEnabled(!!d.enabled))
      .catch(() => setAiEnabled(false));
  }, []);

  // Action Creation State
  const [newActionText, setNewActionText] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState<string>('');

  // Custom Template State in Modal
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  // Language of the retro's *content* (column titles, icebreaker), chosen
  // independently of the interface language in the "Start New Retrospective"
  // dialog. Reset each time the dialog opens; see initialTemplateLanguage.
  const [templateLanguage, setTemplateLanguage] = useState<Language>(() =>
    initialTemplateLanguage(team.retrospectives[0], language)
  );
  const [customCols, setCustomCols] = useState<Column[]>(() => getCustomTemplateStarterColumns(templateLanguage));
  const [templateName, setTemplateName] = useState('');
  const [retroName, setRetroName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showRetroTemplateBuilder, setShowRetroTemplateBuilder] = useState(false);
  const [retroTemplateName, setRetroTemplateName] = useState('');
  const [retroTemplateCols, setRetroTemplateCols] = useState<Column[]>(() => [
    {id: '1', title: t('dashboard.columns.numbered', { number: 1 }), color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#10B981'},
    {id: '2', title: t('dashboard.columns.numbered', { number: 2 }), color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#F43F5E'}
  ]);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null); // Column ID with open color picker
  const [iconPickerOpen, setIconPickerOpen] = useState<string | null>(null); // Column ID with open icon picker

  const archivedMembers = team.archivedMembers || [];
  const knownMembers = [...team.members, ...archivedMembers];

  // Combine global actions, retro actions, and health check actions. Each
  // action carries the date of its origin session (originDate) so legacy
  // actions without a precise `createdAt` can still be ordered by recency.
  const allActions = ([
      ...team.globalActions.map(a => ({...a, originRetro: 'Dashboard', contextText: '', originDate: undefined})),
      ...team.retrospectives.flatMap(r => r.actions
        .filter(a => a.type !== 'proposal')
        .map(a => {
          let contextText = '';
          if (a.linkedTicketId) {
              const ticket = r.tickets.find(x => x.id === a.linkedTicketId);
              if(ticket) contextText = ticket.text;
              else {
                  const g = r.groups.find(x => x.id === a.linkedTicketId);
                  if(g) contextText = t('dashboard.actions.groupContext', { title: g.title });
              }
          }
          return {...a, originRetro: r.name, contextText, originDate: r.date };
      })),
      ...(team.healthChecks || []).flatMap(hc => hc.actions
        .filter(a => a.type !== 'proposal')
        .map(a => ({...a, originRetro: hc.name, contextText: '', originDate: hc.date })))
  ]);

  const filteredActions = (() => {
      const matching = allActions.filter(a => {
          if (actionFilter === 'OPEN') return !a.done;
          if (actionFilter === 'CLOSED') return a.done;
          return true;
      });
      // The Closed filter asks "what did we just finish?", so it answers with
      // closing order. Ordering it by creation is what made the list unreadable:
      // an action opened in January and closed yesterday sat below one opened
      // last week and closed a month ago. There is deliberately no "Sort by"
      // control — the filter's own name already states the question.
      return actionFilter === 'CLOSED'
          ? sortActionsByClosure(matching)
          : sortActionsByRecency(matching);
  })();

  const suggestRetroName = (contentLanguage: Language) =>
    getSuggestedName(team.retrospectives[0]?.name, getDefaultRetroName(contentLanguage));

  const handleOpenNewRetroModal = () => {
    const nextLanguage = initialTemplateLanguage(team.retrospectives[0], language);
    handleTemplateLanguageChange(nextLanguage);
    setRetroName(suggestRetroName(nextLanguage));
    setIsAnonymous(false);
    setShowNewRetroModal(true);
  };

  // Switching the template language re-words whatever the facilitator has not
  // touched yet — the proposed session name and the custom template's starter
  // columns — and leaves anything they typed alone.
  const handleTemplateLanguageChange = (nextLanguage: Language) => {
    if (nextLanguage === templateLanguage) return;
    if (retroName === suggestRetroName(templateLanguage)) {
      setRetroName(suggestRetroName(nextLanguage));
    }
    if (JSON.stringify(customCols) === JSON.stringify(getCustomTemplateStarterColumns(templateLanguage))) {
      setCustomCols(getCustomTemplateStarterColumns(nextLanguage));
    }
    setTemplateLanguage(nextLanguage);
  };

  const handleCreateAction = (e: React.FormEvent) => {
      e.preventDefault();
      if(!newActionText.trim()) return;
      // If empty string, pass null to leave unassigned
      const assignee = newActionAssignee || null;
      dataService.addGlobalAction(team.id, newActionText, assignee);
      setNewActionText('');
      setNewActionAssignee('');
      onRefresh();
  };

  const handleToggleAction = (id: string) => {
      dataService.toggleGlobalAction(team.id, id);
      onRefresh();
  };

  const handleUpdateAssignee = (actionId: string, assigneeId: string | null) => {
      const action = allActions.find(a => a.id === actionId);
      if(action) {
          const updated = { ...action, assigneeId };
          dataService.updateGlobalAction(team.id, updated);
          onRefresh();
      }
  };

  const handleStartMemberEdit = (member: User) => {
    setEditingMemberId(member.id);
    setEditingMemberName(member.name);
    setEditingMemberEmail(member.email || '');
    setMemberEditError(null);
  };

  const handleCancelMemberEdit = () => {
    setEditingMemberId(null);
    setEditingMemberName('');
    setEditingMemberEmail('');
    setMemberEditError(null);
  };

  const handleSaveMemberEdit = () => {
    if (!editingMemberId) return;
    try {
      dataService.updateMember(team.id, editingMemberId, {
        name: editingMemberName,
        email: editingMemberEmail
      });
      handleCancelMemberEdit();
      onRefresh();
    } catch (err: any) {
      setMemberEditError(err.message ? { raw: err.message } : { key: 'dashboard.members.updateFailed' });
    }
  };

  const handleRemoveMember = (memberId: string) => {
    if (memberId === currentUser.id) return;
    dataService.removeMember(team.id, memberId);
    setMemberPendingRemoval(null);
    onRefresh();
  };

  const handleRenameRetro = (retroId: string) => {
    if (!editingRetroName.trim()) return;
    dataService.updateSessionName(team.id, retroId, editingRetroName.trim());
    setEditingRetroId(null);
    setEditingRetroName('');
    onRefresh();
  };

  const handleRenameHealthCheck = (healthCheckId: string) => {
    if (!editingHealthCheckName.trim()) return;
    dataService.updateHealthCheckName(team.id, healthCheckId, editingHealthCheckName.trim());
    setEditingHealthCheckId(null);
    setEditingHealthCheckName('');
    onRefresh();
  };

  const handleUpdateActionText = (actionId: string, newText: string) => {
    const action = allActions.find(a => a.id === actionId);
    if(action && newText.trim() !== action.text) {
        const updated = { ...action, text: newText.trim() };
        dataService.updateGlobalAction(team.id, updated);
        onRefresh();
    }
  };

  const handleStartRetro = (cols: Column[]) => {
    // Deep copy cols
    const safeCols = JSON.parse(JSON.stringify(cols));
    const finalName = retroName.trim() || getDefaultRetroName(templateLanguage);
    const session = dataService.createSession(team.id, finalName, safeCols, { isAnonymous, templateLanguage });
    
    // Save template if name provided during creation of CUSTOM
    if(isCreatingCustom && templateName) {
        dataService.saveTemplate(team.id, { name: templateName, cols: safeCols });
    }

    setShowNewRetroModal(false);
    onRefresh();
    onOpenSession(session.id);
  };

  const isAdmin = currentUser.role === 'facilitator';

  const handleDeleteTeam = () => {
    if (deleteConfirmText === team.name) {
      dataService.deleteTeam(team.id);
      setShowDeleteModal(false);
      if (onDeleteTeam) {
        onDeleteTeam();
      }
    }
  };

  const handleDeleteRetro = () => {
    if (!retroToDelete) return;
    dataService.deleteRetrospective(team.id, retroToDelete.id);
    setRetroToDelete(null);
    onRefresh();
  };

  // Health Check Handlers
  const handleOpenNewHealthCheckModal = (preselectedTemplateId?: string) => {
    const defaultName = getSuggestedName(
      healthChecks[0]?.name,
      t('dashboard.newHealthCheck.defaultName', { date: new Date().toLocaleDateString(locale) })
    );
    setHealthCheckName(defaultName);
    // A team that already runs health checks continues with the template it
    // used last — the Health Checks tab trends results per template, so a
    // different default would quietly start a new table. A team with none is
    // offered the built-in check in the language of the screen.
    const lastTemplate = healthCheckTemplates.find(tpl => tpl.id === healthChecks[0]?.templateId);
    const languageDefault = healthCheckTemplates.find(tpl => tpl.id === `team_health_${language}`);
    setSelectedTemplateId(
      preselectedTemplateId || lastTemplate?.id || languageDefault?.id || healthCheckTemplates[0]?.id || ''
    );
    setIsHealthCheckAnonymous(false);
    setShowNewHealthCheckModal(true);
  };

  const handleStartHealthCheck = () => {
    if (!selectedTemplateId) return;
    const finalName = healthCheckName.trim() || t('dashboard.newHealthCheck.defaultName', { date: new Date().toLocaleDateString(locale) });
    const session = dataService.createHealthCheckSession(team.id, finalName, selectedTemplateId, { isAnonymous: isHealthCheckAnonymous });
    setShowNewHealthCheckModal(false);
    onRefresh();
    onOpenHealthCheck(session.id);
  };

  const handleDeleteHealthCheck = () => {
    if (!healthCheckToDelete) return;
    dataService.deleteHealthCheck(team.id, healthCheckToDelete.id);
    setHealthCheckToDelete(null);
    onRefresh();
  };

  // Settings Handlers - Template Editor
  const handleOpenTemplateEditor = (template?: HealthCheckTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setNewTemplateName(template.name);
      setNewTemplateDimensions(JSON.parse(JSON.stringify(template.dimensions)));
    } else {
      setEditingTemplate(null);
      setNewTemplateName('');
      setNewTemplateDimensions([
        { id: '1', name: '', goodDescription: '', badDescription: '' }
      ]);
    }
    setShowTemplateEditor(true);
  };

  const handleSaveTemplate = () => {
    if (!newTemplateName.trim() || newTemplateDimensions.length === 0) return;

    const validDimensions = newTemplateDimensions.filter(d => d.name.trim());
    if (validDimensions.length === 0) return;

    const template: HealthCheckTemplate = {
      id: editingTemplate?.id || '',
      name: newTemplateName.trim(),
      dimensions: validDimensions.map((d, idx) => ({
        ...d,
        id: d.id || `dim_${idx}`,
        name: d.name.trim(),
        goodDescription: d.goodDescription.trim(),
        badDescription: d.badDescription.trim()
      }))
    };

    dataService.saveHealthCheckTemplate(team.id, template);
    setShowTemplateEditor(false);
    onRefresh();
  };

  const handleDeleteTemplate = (templateId: string) => {
    dataService.deleteHealthCheckTemplate(team.id, templateId);
    onRefresh();
  };

  // Settings Handlers - Password Change
  const handleChangePassword = async () => {
    setPasswordChangeError(null);
    setPasswordChangeSuccess(null);

    if (needsCurrentPassword && !currentPassword) {
      setPasswordChangeError({ key: 'dashboard.settings.enterCurrentPassword' });
      return;
    }

    // Audit H39 — one rule, read from the module the server routes read too.
    if (!isPasswordLongEnough(newPassword)) {
      setPasswordChangeError({ key: 'errors.passwordTooShort', params: { min: PASSWORD_MIN_LENGTH } });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordChangeError({ key: 'dashboard.settings.passwordMismatch' });
      return;
    }

    try {
      await dataService.changeTeamPassword(team.id, newPassword, currentPassword || undefined);
      setPasswordChangeSuccess({ key: 'dashboard.settings.passwordChanged' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordChangeSuccess(null), 3000);
    } catch (err: any) {
      setPasswordChangeError(err.message ? { raw: err.message } : { key: 'errors.changePasswordFailed' });
    }
  };

  // Settings Handlers - Team Rename
  // `renameTeam` is async and rejects on a taken name, a throttled availability
  // check, or an unreachable one. Without awaiting it, none of those rejections
  // could reach the catch below and the success banner was shown regardless.
  const handleRenameTeam = async () => {
    setTeamRenameError(null);
    setTeamRenameSuccess(null);

    if (!newTeamName.trim()) {
      setTeamRenameError({ key: 'errors.teamNameEmpty' });
      return;
    }

    if (newTeamName.trim() === team.name) {
      setTeamRenameError({ key: 'dashboard.settings.sameName' });
      return;
    }

    try {
      await dataService.renameTeam(team.id, newTeamName.trim());
      setTeamRenameSuccess({ key: 'dashboard.settings.renamed' });
      setNewTeamName('');
      onRefresh();
      setTimeout(() => setTeamRenameSuccess(null), 3000);
    } catch (err: any) {
      setTeamRenameError(err.message ? { raw: err.message } : { key: 'dashboard.settings.renameFailed' });
    }
  };

  const addDimension = () => {
    setNewTemplateDimensions([...newTemplateDimensions, {
      id: randomId(),
      name: '',
      goodDescription: '',
      badDescription: ''
    }]);
  };

  const removeDimension = (idx: number) => {
    setNewTemplateDimensions(newTemplateDimensions.filter((_, i) => i !== idx));
  };

  const updateDimension = (idx: number, field: keyof HealthCheckDimension, value: string) => {
    const updated = [...newTemplateDimensions];
    updated[idx] = { ...updated[idx], [field]: value };
    setNewTemplateDimensions(updated);
  };

  const toggleTemplateDetails = (templateId: string) => {
    setExpandedTemplates(prev => (
      prev.includes(templateId)
        ? prev.filter(id => id !== templateId)
        : [...prev, templateId]
    ));
  };

  const handleSaveRetroTemplate = () => {
    const validCols = retroTemplateCols.filter(c => c.title.trim());
    if (!retroTemplateName.trim() || validCols.length === 0) return;

    dataService.saveTemplate(team.id, { name: retroTemplateName.trim(), cols: validCols });
    setShowRetroTemplateBuilder(false);
    onRefresh();
  };

  // Calculate health check statistics for trend visualization
  const getHealthCheckStats = (hc: HealthCheckSession) => {
    const stats: Record<string, number> = {};
    hc.dimensions.forEach(d => {
      const ratings: number[] = [];
      Object.values(hc.ratings).forEach(userRatings => {
        if (userRatings[d.id]?.rating) {
          ratings.push(userRatings[d.id].rating);
        }
      });
      stats[d.id] = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : 0;
    });
    return stats;
  };

  // Get score distribution for a dimension
  const getScoreDistribution = (hc: HealthCheckSession, dimensionId: string): Record<number, number> => {
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    Object.values(hc.ratings).forEach(userRatings => {
      const rating = userRatings[dimensionId]?.rating;
      if (rating && rating >= 1 && rating <= 5) {
        distribution[rating]++;
      }
    });
    return distribution;
  };

  // Get score color - distinct colors for each rating level
  const getScoreColor = (score: number) => {
    if (score >= 4.5) return 'bg-emerald-600';  // 5: dark green
    if (score >= 3.5) return 'bg-emerald-400';  // 4: light green
    if (score >= 2.5) return 'bg-amber-400';    // 3: amber
    if (score >= 1.5) return 'bg-orange-500';   // 2: orange-red
    return 'bg-rose-600';                       // 1: red
  };

  const getScoreTextColor = (score: number) => {
    if (score >= 4.5) return 'text-emerald-700';
    if (score >= 3.5) return 'text-emerald-700';
    if (score >= 2.5) return 'text-amber-600';
    if (score >= 1.5) return 'text-orange-600';
    return 'text-rose-700';
  };

  return (
    <div id="main-scroller" className="grow container mx-auto p-6 max-w-6xl overflow-y-auto">
      {/* Delete Team Confirmation Modal */}
      {showDeleteModal && (
        <ModalDialog
          labelledBy="dashboard-delete-team-title"
          onClose={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
          overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs"
          panelClassName="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full"
        >
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">warning</span>
              </div>
              <h2 id="dashboard-delete-team-title" className="text-xl font-bold text-slate-800 mb-2">{t('dashboard.deleteTeam.title')}</h2>
              <p className="text-slate-500 text-sm">
                {tRich('dashboard.deleteTeam.warning', {
                  irreversible: <strong className="text-red-600">{t('dashboard.deleteTeam.irreversible')}</strong>
                })}
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-700 mb-3">
                {tRich('dashboard.deleteTeam.confirmPrompt', { name: <strong>{team.name}</strong> })}
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t('dashboard.deleteTeam.placeholder')}
                className="w-full border border-red-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-red-500 focus:ring-1 focus:ring-red-500"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- inside ModalDialog, which moves focus in regardless; this only picks the field the user must type in
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
                className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-lg font-bold hover:bg-slate-200 transition"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={deleteConfirmText !== team.name}
                className="flex-1 bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {t('dashboard.deleteTeam.title')}
              </button>
            </div>
          </>
        </ModalDialog>
      )}

      {/* Delete Retro Confirmation */}
      {retroToDelete && (
        <ModalDialog
          labelledBy="dashboard-delete-retro-title"
          onClose={() => setRetroToDelete(null)}
          overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs"
          panelClassName="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full"
        >
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">archive</span>
              </div>
              <h2 id="dashboard-delete-retro-title" className="text-xl font-bold text-slate-800 mb-2">{t('dashboard.deleteRetro.title')}</h2>
              <p className="text-slate-500 text-sm">
                {tRich('dashboard.deleteSession.keepActions', { name: <strong>{retroToDelete.name}</strong> })}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setRetroToDelete(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-lg font-bold hover:bg-slate-200 transition"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteRetro}
                className="flex-1 bg-amber-500 text-white py-3 rounded-lg font-bold hover:bg-amber-600 transition"
              >
                {t('dashboard.deleteRetro.confirm')}
              </button>
            </div>
          </>
        </ModalDialog>
      )}

      {/* New Retro Modal */}
      {showNewRetroModal && (
          <ModalDialog
            labelledBy="dashboard-new-retro-title"
            onClose={() => setShowNewRetroModal(false)}
            // Holds unsaved input: only a deliberate Escape or Cancel closes it.
            closeOnBackdropClick={false}
            overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs"
            panelClassName="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          >
              <>
                  <div className="flex justify-between items-center mb-6">
                      <h2 id="dashboard-new-retro-title" className="text-2xl font-bold text-slate-800">{t('dashboard.newRetro.title')}</h2>
                      <button onClick={() => setShowNewRetroModal(false)} className="text-slate-500 hover:text-slate-600" aria-label={t('dashboard.newRetro.close')}><span className="material-symbols-outlined">close</span></button>
                  </div>
                  
                  <div className="mb-6">
                      <label htmlFor="new-retro-name" className="block text-sm font-bold text-slate-700 mb-1">{t('dashboard.form.sessionName')}</label>
                      <input 
                        id="new-retro-name"
                        type="text" 
                        value={retroName} 
                        onChange={(e) => setRetroName(e.target.value)} 
                        className="w-full border border-slate-300 rounded-sm p-2 bg-white text-slate-900 font-medium"
                      />
                  </div>
                  
                  {!isCreatingCustom ? (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                          <div>
                            <div className="text-sm font-bold text-slate-700">{t('dashboard.form.anonymousMode')}</div>
                            <p className="text-xs text-slate-500">{t('dashboard.newRetro.anonymousHint')}</p>
                          </div>
                          <button
                            onClick={() => setIsAnonymous(!isAnonymous)}
                            className={`w-12 h-6 rounded-full relative transition ${isAnonymous ? 'bg-indigo-600' : 'bg-slate-300'}`}
                            aria-label={t('dashboard.form.toggleAnonymous')}
                          >
                            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition ${isAnonymous ? 'translate-x-6' : ''}`}></span>
                          </button>
                        </div>

                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                          <div className="flex items-center justify-between gap-3">
                            <div id="template-language-label" className="text-sm font-bold text-slate-700">{t('templates.language.label')}</div>
                            <div
                              role="group"
                              aria-labelledby="template-language-label"
                              aria-describedby="template-language-hint"
                              className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-bold shrink-0"
                            >
                              {SUPPORTED_LANGUAGES.map(option => (
                                <button
                                  key={option}
                                  type="button"
                                  lang={option}
                                  aria-pressed={templateLanguage === option}
                                  onClick={() => handleTemplateLanguageChange(option)}
                                  className={`rounded-md px-3 py-1 transition ${templateLanguage === option ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                  data-testid={`template-language-${option}`}
                                >
                                  {LANGUAGE_NATIVE_NAMES[option]}
                                </button>
                              ))}
                            </div>
                          </div>
                          <p id="template-language-hint" className="text-xs text-slate-500 mt-1">{t('templates.language.hint')}</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-80 overflow-y-auto pr-2" lang={templateLanguage}>
                            {RETRO_TEMPLATES.map(template => {
                                const words = getRetroTemplateWords(template.id, templateLanguage);
                                return (
                                    <button
                                        key={template.id}
                                        onClick={() => handleStartRetro(getRetroTemplateColumns(template.id, templateLanguage))}
                                        className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group"
                                        data-testid={`retro-template-${template.id}`}
                                    >
                                        <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">{words.name}</div>
                                        <p className="text-xs text-slate-500">{words.description}</p>
                                    </button>
                                );
                            })}
                        </div>

                        {team.customTemplates.length > 0 && (
                            <div>
                                <h3 className="text-sm font-bold text-slate-500 uppercase mb-3">{t('dashboard.newRetro.savedTemplates')}</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {team.customTemplates.map((savedTemplate, idx) => (
                                        <button key={idx} onClick={() => handleStartRetro(savedTemplate.cols)} className="p-3 border border-slate-200 rounded-lg hover:border-retro-primary hover:bg-indigo-50 text-sm font-bold text-slate-700">
                                            {savedTemplate.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="border-t border-slate-100 pt-4 text-center">
                            <button onClick={() => setIsCreatingCustom(true)} className="text-retro-primary font-bold hover:underline flex items-center justify-center w-full py-2">
                                <span className="material-symbols-outlined mr-2">edit</span> {t('dashboard.newRetro.createCustom')}
                            </button>
                        </div>
                      </div>
                  ) : (
                      <div className="space-y-4">
                          <div>
                              <label htmlFor="custom-template-name" className="block text-sm font-bold text-slate-700 mb-1">{t('dashboard.newRetro.customTemplateName')}</label>
                              <input 
                                id="custom-template-name"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                className="w-full border border-slate-300 rounded-sm p-2 bg-white text-slate-900"
                                placeholder={t('dashboard.retroTemplate.namePlaceholder')}
                              />
                          </div>
                          <div role="group" aria-labelledby="custom-template-columns-label">
                              <span id="custom-template-columns-label" className="block text-sm font-bold text-slate-700 mb-2">{t('dashboard.columns.label')}</span>
                              {customCols.map((c, idx) => (
                                  <div key={c.id} className="flex gap-2 mb-3 items-center">
                                      {/* Icon Picker Button */}
                                      <div className="relative">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setIconPickerOpen(iconPickerOpen === c.id ? null : c.id);
                                            setColorPickerOpen(null);
                                          }}
                                          className="w-10 h-10 border-2 border-slate-300 rounded-lg flex items-center justify-center hover:border-indigo-400 hover:bg-indigo-50 transition-all bg-white"
                                          title={t('dashboard.columns.pickIcon')}
                                          aria-label={t('dashboard.columns.pickIconFor', { number: idx + 1 })}
                                        >
                                          <span
                                            className="material-symbols-outlined text-xl"
                                            style={{ color: readableTextColor(c.customColor || '#64748B') }}
                                          >
                                            {c.icon}
                                          </span>
                                        </button>
                                        {iconPickerOpen === c.id && (
                                          <IconPicker
                                            initialIcon={c.icon}
                                            onChange={(icon) => {
                                              const newCols = [...customCols];
                                              newCols[idx] = { ...newCols[idx], icon };
                                              setCustomCols(newCols);
                                            }}
                                            onClose={() => setIconPickerOpen(null)}
                                          />
                                        )}
                                      </div>

                                      {/* Color Picker Button */}
                                      <div className="relative">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setColorPickerOpen(colorPickerOpen === c.id ? null : c.id);
                                            setIconPickerOpen(null);
                                          }}
                                          className="w-10 h-10 border-2 border-slate-300 rounded-lg hover:scale-105 transition-transform"
                                          style={{ backgroundColor: c.customColor || '#6366F1' }}
                                          title={t('dashboard.columns.pickColor')}
                                          aria-label={t('dashboard.columns.pickColorFor', { number: idx + 1 })}
                                        />
                                        {colorPickerOpen === c.id && (
                                          <ColorPicker
                                            initialColor={c.customColor || '#6366F1'}
                                            onChange={(color) => {
                                              const newCols = [...customCols];
                                              newCols[idx] = { ...newCols[idx], customColor: color };
                                              setCustomCols(newCols);
                                            }}
                                            onClose={() => setColorPickerOpen(null)}
                                          />
                                        )}
                                      </div>

                                      <input
                                        value={c.title}
                                        onChange={(e) => {
                                            const newCols = [...customCols];
                                            newCols[idx] = { ...newCols[idx], title: e.target.value };
                                            setCustomCols(newCols);
                                        }}
                                        className="grow border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-hidden"
                                        placeholder={t('dashboard.columns.numbered', { number: idx + 1 })}
                                      />
                                      {customCols.length > 2 && (
                                        <button
                                          onClick={() => {
                                            setCustomCols(customCols.filter((_, i) => i !== idx));
                                            if (colorPickerOpen === c.id) setColorPickerOpen(null);
                                            if (iconPickerOpen === c.id) setIconPickerOpen(null);
                                          }}
                                          className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-sm transition-colors"
                                          aria-label={t('dashboard.columns.remove', { number: idx + 1 })}
                                        >
                                          <span className="material-symbols-outlined">delete</span>
                                        </button>
                                      )}
                                  </div>
                              ))}
                              <button
                                onClick={() => setCustomCols([...customCols, {id: randomId(), title: '', color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#64748B'}])}
                                className="text-sm font-bold text-indigo-600 hover:underline flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-lg">add</span>
                                {t('dashboard.columns.add')}
                              </button>
                          </div>
                          <div className="flex justify-between pt-4 border-t border-slate-100 mt-4">
                              <button onClick={() => setIsCreatingCustom(false)} className="text-slate-500">{t('common.back')}</button>
                              <button onClick={() => handleStartRetro(customCols)} className="bg-retro-primary text-white px-6 py-2 rounded-lg font-bold hover:bg-retro-primaryHover">{t('dashboard.newRetro.start')}</button>
                          </div>
                      </div>
                  )}
              </>
          </ModalDialog>
      )}

      {/* New Health Check Modal */}
      {showNewHealthCheckModal && (
        <ModalDialog
          labelledBy="dashboard-new-healthcheck-title"
          onClose={() => setShowNewHealthCheckModal(false)}
          // Holds unsaved input: only a deliberate Escape or Cancel closes it.
          closeOnBackdropClick={false}
          overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs"
          panelClassName="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full"
        >
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 id="dashboard-new-healthcheck-title" className="text-2xl font-bold text-slate-800">{t('dashboard.newHealthCheck.title')}</h2>
              <button onClick={() => setShowNewHealthCheckModal(false)} className="text-slate-500 hover:text-slate-600" aria-label={t('dashboard.newHealthCheck.close')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="new-healthcheck-name" className="block text-sm font-bold text-slate-700 mb-1">{t('dashboard.form.sessionName')}</label>
                <input
                  id="new-healthcheck-name"
                  type="text"
                  value={healthCheckName}
                  onChange={(e) => setHealthCheckName(e.target.value)}
                  className="w-full border border-slate-300 rounded-sm p-2 bg-white text-slate-900 font-medium"
                />
              </div>

              <div>
                <label htmlFor="healthcheck-template" className="block text-sm font-bold text-slate-700 mb-1">{t('dashboard.newHealthCheck.template')}</label>
                <select
                  id="healthcheck-template"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full border border-slate-300 rounded-sm p-2 bg-white text-slate-900"
                >
                  {healthCheckTemplates.map(tpl => (
                    <option key={tpl.id} value={tpl.id}>
                      {tp('dashboard.newHealthCheck.templateOption', tpl.dimensions.length, { name: tpl.name })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <div className="text-sm font-bold text-slate-700">{t('dashboard.form.anonymousMode')}</div>
                  <p className="text-xs text-slate-500">{t('dashboard.newHealthCheck.anonymousHint')}</p>
                </div>
                <button
                  onClick={() => setIsHealthCheckAnonymous(!isHealthCheckAnonymous)}
                  className={`w-12 h-6 rounded-full relative transition ${isHealthCheckAnonymous ? 'bg-indigo-600' : 'bg-slate-300'}`}
                  aria-label={t('dashboard.form.toggleAnonymous')}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition ${isHealthCheckAnonymous ? 'translate-x-6' : ''}`}></span>
                </button>
              </div>

              <button
                onClick={handleStartHealthCheck}
                disabled={!selectedTemplateId}
                className="w-full bg-cyan-600 text-white py-3 rounded-lg font-bold hover:bg-cyan-700 disabled:opacity-50 transition"
              >
                {t('dashboard.newHealthCheck.title')}
              </button>
            </div>
          </>
        </ModalDialog>
      )}

      {/* Delete Health Check Confirmation */}
      {healthCheckToDelete && (
        <ModalDialog
          labelledBy="dashboard-delete-healthcheck-title"
          onClose={() => setHealthCheckToDelete(null)}
          overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs"
          panelClassName="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full"
        >
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">archive</span>
              </div>
              <h2 id="dashboard-delete-healthcheck-title" className="text-xl font-bold text-slate-800 mb-2">{t('dashboard.deleteHealthCheck.title')}</h2>
              <p className="text-slate-500 text-sm">
                {tRich('dashboard.deleteSession.keepActions', { name: <strong>{healthCheckToDelete.name}</strong> })}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setHealthCheckToDelete(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-lg font-bold hover:bg-slate-200 transition"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteHealthCheck}
                className="flex-1 bg-amber-500 text-white py-3 rounded-lg font-bold hover:bg-amber-600 transition"
              >
                {t('common.delete')}
              </button>
            </div>
          </>
        </ModalDialog>
      )}

      {/* Template Editor Modal */}
      {showTemplateEditor && (
        <ModalDialog
          labelledBy="dashboard-template-editor-title"
          onClose={() => setShowTemplateEditor(false)}
          // Holds unsaved input: only a deliberate Escape or Cancel closes it.
          closeOnBackdropClick={false}
          overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs"
          panelClassName="bg-white rounded-2xl shadow-2xl p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        >
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 id="dashboard-template-editor-title" className="text-2xl font-bold text-slate-800">
                {editingTemplate ? t('dashboard.hcTemplate.editTitle') : t('dashboard.hcTemplate.createTitle')}
              </h2>
              <button onClick={() => setShowTemplateEditor(false)} className="text-slate-500 hover:text-slate-600" aria-label={t('dashboard.hcTemplate.close')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="healthcheck-template-name" className="block text-sm font-bold text-slate-700 mb-1">{t('dashboard.form.templateName')}</label>
                <input
                  id="healthcheck-template-name"
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder={t('dashboard.hcTemplate.namePlaceholder')}
                  className="w-full border border-slate-300 rounded-sm p-2 bg-white text-slate-900"
                />
              </div>

              <div>
                <span id="healthcheck-template-dimensions-label" className="block text-sm font-bold text-slate-700 mb-2">{t('dashboard.hcTemplate.dimensions')}</span>
                <div role="group" aria-labelledby="healthcheck-template-dimensions-label" className="space-y-4">
                  {newTemplateDimensions.map((dim, idx) => (
                    <div key={dim.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-xs font-bold text-slate-500">{t('dashboard.hcTemplate.dimensionNumber', { number: idx + 1 })}</span>
                        {newTemplateDimensions.length > 1 && (
                          <button onClick={() => removeDimension(idx)} className="text-red-500 hover:text-red-700" aria-label={t('dashboard.hcTemplate.removeDimension', { number: idx + 1 })}>
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder={t('dashboard.hcTemplate.dimensionName')}
                        value={dim.name}
                        onChange={(e) => updateDimension(idx, 'name', e.target.value)}
                        className="w-full border border-slate-300 rounded-sm p-2 mb-2 bg-white text-slate-900 font-medium"
                      />
                      <textarea
                        placeholder={t('dashboard.hcTemplate.goodPlaceholder')}
                        value={dim.goodDescription}
                        onChange={(e) => updateDimension(idx, 'goodDescription', e.target.value)}
                        className="w-full border border-slate-300 rounded-sm p-2 mb-2 bg-white text-slate-900 text-sm resize-none h-16"
                      />
                      <textarea
                        placeholder={t('dashboard.hcTemplate.badPlaceholder')}
                        value={dim.badDescription}
                        onChange={(e) => updateDimension(idx, 'badDescription', e.target.value)}
                        className="w-full border border-slate-300 rounded-sm p-2 bg-white text-slate-900 text-sm resize-none h-16"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={addDimension}
                  className="mt-3 text-sm font-bold text-indigo-600 hover:underline flex items-center"
                >
                  <span className="material-symbols-outlined mr-1 text-sm">add</span>
                  {t('dashboard.hcTemplate.addDimension')}
                </button>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  onClick={() => setShowTemplateEditor(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={!newTemplateName.trim() || newTemplateDimensions.every(d => !d.name.trim())}
                  className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50"
                >
                  {t('dashboard.form.saveTemplate')}
                </button>
              </div>
            </div>
          </>
        </ModalDialog>
      )}

      {showRetroTemplateBuilder && (
        <ModalDialog
          labelledBy="dashboard-retro-template-title"
          onClose={() => setShowRetroTemplateBuilder(false)}
          // Holds unsaved input: only a deliberate Escape or Cancel closes it.
          closeOnBackdropClick={false}
          overlayClassName="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs"
          panelClassName="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        >
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 id="dashboard-retro-template-title" className="text-2xl font-bold text-slate-800">{t('dashboard.retroTemplate.title')}</h2>
              <button onClick={() => setShowRetroTemplateBuilder(false)} className="text-slate-500 hover:text-slate-600" aria-label={t('dashboard.retroTemplate.close')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="retro-template-name" className="block text-sm font-bold text-slate-700 mb-1">{t('dashboard.form.templateName')}</label>
                <input
                  id="retro-template-name"
                  type="text"
                  value={retroTemplateName}
                  onChange={(e) => setRetroTemplateName(e.target.value)}
                  placeholder={t('dashboard.retroTemplate.namePlaceholder')}
                  className="w-full border border-slate-300 rounded-sm p-2 bg-white text-slate-900"
                />
              </div>

              <div role="group" aria-labelledby="retro-template-columns-label">
                <span id="retro-template-columns-label" className="block text-sm font-bold text-slate-700 mb-2">{t('dashboard.columns.label')}</span>
                {retroTemplateCols.map((c, idx) => {
                  return (
                    <div key={c.id} className="flex gap-2 mb-3 items-center">
                      {/* Icon Picker Button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setIconPickerOpen(iconPickerOpen === c.id ? null : c.id);
                            setColorPickerOpen(null);
                          }}
                          className="w-12 h-12 border-2 border-slate-300 rounded-lg flex items-center justify-center hover:border-indigo-400 hover:bg-indigo-50 transition-all bg-white"
                          title={t('dashboard.columns.pickIcon')}
                          aria-label={t('dashboard.columns.pickIconFor', { number: idx + 1 })}
                        >
                          <span
                            className="material-symbols-outlined text-2xl"
                            style={{ color: readableTextColor(c.customColor || '#64748B') }}
                          >
                            {c.icon}
                          </span>
                        </button>
                        {iconPickerOpen === c.id && (
                          <IconPicker
                            initialIcon={c.icon}
                            onChange={(icon) => {
                              const next = [...retroTemplateCols];
                              next[idx] = { ...next[idx], icon };
                              setRetroTemplateCols(next);
                            }}
                            onClose={() => setIconPickerOpen(null)}
                          />
                        )}
                      </div>

                      {/* Color Picker Button */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setColorPickerOpen(colorPickerOpen === c.id ? null : c.id);
                            setIconPickerOpen(null);
                          }}
                          className="w-12 h-12 border-2 border-slate-300 rounded-lg hover:scale-105 transition-transform"
                          style={{ backgroundColor: c.customColor || '#6366F1' }}
                          title={t('dashboard.columns.pickColor')}
                          aria-label={t('dashboard.columns.pickColorFor', { number: idx + 1 })}
                        />
                        {colorPickerOpen === c.id && (
                          <ColorPicker
                            initialColor={c.customColor || '#6366F1'}
                            onChange={(color) => {
                              const next = [...retroTemplateCols];
                              next[idx] = { ...next[idx], customColor: color };
                              setRetroTemplateCols(next);
                            }}
                            onClose={() => setColorPickerOpen(null)}
                          />
                        )}
                      </div>

                      {/* Column Title Input */}
                      <input
                        value={c.title}
                        onChange={(e) => {
                          const next = [...retroTemplateCols];
                          next[idx] = { ...next[idx], title: e.target.value };
                          setRetroTemplateCols(next);
                        }}
                        className="grow border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-hidden"
                        placeholder={t('dashboard.columns.numbered', { number: idx + 1 })}
                      />

                      {/* Delete Button */}
                      {retroTemplateCols.length > 2 && (
                        <button
                          type="button"
                          onClick={() => {
                            setRetroTemplateCols(retroTemplateCols.filter((_, i) => i !== idx));
                            if (colorPickerOpen === c.id) setColorPickerOpen(null);
                            if (iconPickerOpen === c.id) setIconPickerOpen(null);
                          }}
                          className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded-sm transition-colors"
                          aria-label={t('dashboard.columns.remove', { number: idx + 1 })}
                        >
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setRetroTemplateCols([...retroTemplateCols, {
                      id: randomId(),
                      title: t('dashboard.columns.numbered', { number: retroTemplateCols.length + 1 }),
                      color: 'bg-slate-50',
                      border: 'border-slate-300',
                      icon: 'star',
                      text: 'text-slate-700',
                      ring: 'focus:ring-slate-200',
                      customColor: '#64748B'
                    }]);
                  }}
                  className="text-sm font-bold text-indigo-600 hover:underline flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-lg">add</span>
                  {t('dashboard.columns.add')}
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button onClick={() => setShowRetroTemplateBuilder(false)} className="px-4 py-2 rounded-sm border border-slate-200 text-slate-600">{t('common.cancel')}</button>
                <button onClick={handleSaveRetroTemplate} className="px-4 py-2 rounded-sm bg-retro-primary text-white font-bold hover:bg-retro-primaryHover">{t('dashboard.form.saveTemplate')}</button>
              </div>
            </div>
          </>
        </ModalDialog>
      )}

      {infoMessage && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-600 text-xl shrink-0">info</span>
            <p className="text-sm text-amber-800 whitespace-pre-wrap">{infoMessage}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">{t('dashboard.header.title', { name: team.name })}</h1>
            <p className="text-slate-500">{t('dashboard.header.subtitle')}</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2 mt-4 md:mt-0">
                <button onClick={handleOpenNewRetroModal} className="bg-retro-primary text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-retro-primaryHover shadow-lg transition">
                    <span className="material-symbols-outlined mr-2">add</span> {t('dashboard.header.newRetro')}
                </button>
                <button
                    onClick={() => setShowDeleteModal(true)}
                    className="bg-white border border-red-300 text-red-600 px-3 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-red-50 hover:border-red-400 shadow-xs transition"
                    title={t('dashboard.deleteTeam.title')}
                    aria-label={t('dashboard.deleteTeam.title')}
                >
                    <span className="material-symbols-outlined">delete</span>
                </button>
            </div>
          )}
      </div>

      <DashboardTabs activeTab={tab} onChange={setTab} />

      {tab === 'ACTIONS' && (
        <DashboardActionsTab
          team={team}
          knownMembers={knownMembers}
          actionFilter={actionFilter}
          onActionFilterChange={setActionFilter}
          newActionText={newActionText}
          onNewActionTextChange={setNewActionText}
          newActionAssignee={newActionAssignee}
          onNewActionAssigneeChange={setNewActionAssignee}
          onCreateAction={handleCreateAction}
          filteredActions={filteredActions}
          onToggleAction={handleToggleAction}
          onUpdateActionText={handleUpdateActionText}
          onUpdateAssignee={handleUpdateAssignee}
        />
      )}

      {tab === 'RETROS' && (
          <div>
              {isAdmin && aiEnabled && team.retrospectives.length > 0 && (
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setShowReleaseAnalysisModal(true)}
                    data-testid="open-release-analysis"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 transition"
                    title={t('dashboard.retros.analyzeTitle')}
                  >
                    <span className="material-symbols-outlined text-sm">smart_toy</span>
                    {t('dashboard.retros.analyze')}
                  </button>
                </div>
              )}
              {team.retrospectives.length === 0 ? (
                  <div className="text-center text-slate-500 py-10">{t('dashboard.retros.empty')}</div>
              ) : (
                  team.retrospectives.map(retro => (
                    <div key={retro.id} className="bg-white p-5 rounded-lg shadow-xs border border-slate-200 flex items-center justify-between mb-3 hover:shadow-md transition">
                        <div className="flex items-center grow">
                            <div className="w-12 h-12 rounded-sm bg-indigo-50 text-indigo-600 flex items-center justify-center mr-4">
                                <span className="material-symbols-outlined">event_note</span>
                            </div>
                            <div className="grow">
                                {editingRetroId === retro.id ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editingRetroName}
                                            onChange={(e) => setEditingRetroName(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleRenameRetro(retro.id);
                                                if (e.key === 'Escape') {
                                                    setEditingRetroId(null);
                                                    setEditingRetroName('');
                                                }
                                            }}
                                            className="border border-indigo-500 rounded-sm px-2 py-1 text-lg font-bold text-slate-800 outline-hidden focus:ring-2 focus:ring-indigo-200"
                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- the rename button it replaces is unmounted by this very click
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => handleRenameRetro(retro.id)}
                                            className="p-1.5 text-white bg-indigo-600 hover:bg-indigo-700 rounded-sm"
                                            title={t('common.save')}
                                            aria-label={t('dashboard.retros.saveName')}
                                        >
                                            <span className="material-symbols-outlined text-base">check</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingRetroId(null);
                                                setEditingRetroName('');
                                            }}
                                            className="p-1.5 text-slate-600 hover:text-slate-800 rounded-sm"
                                            title={t('common.cancel')}
                                            aria-label={t('dashboard.retros.cancelRename')}
                                        >
                                            <span className="material-symbols-outlined text-base">close</span>
                                        </button>
                                    </div>
                                ) : (
                                    <h3 className="font-bold text-slate-800 text-lg">{retro.name}</h3>
                                )}
                                <div className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2">
                                    <span>{retro.date}</span> •
                                    <span className={retro.status === 'IN_PROGRESS' ? 'text-green-600' : 'text-slate-500'}>
                                        {t(`dashboard.retroStatus.${retro.status}`)}
                                    </span>
                                </div>
                                {/* What this retro's actions were worth, once the
                                    team has said. Rendered only when at least one
                                    of them has a score: an unrated retro shows
                                    nothing at all, because "0/3" reads as a
                                    damning verdict when the truth is that nobody
                                    has answered yet. The rating round is one retro
                                    behind by design, so a fresh retro is blank for
                                    a sprint. */}
                                {(() => {
                                    const roti = retroRotiSummary(retro);
                                    const rotiAverage = roti ? localizeDecimal(String(roti.average), locale) : '';
                                    const summary = isActionImpactRatingEnabled(team)
                                        ? retroImpactSummary(team, retro.id)
                                        : null;
                                    if (!roti && !summary) return null;
                                    const impactAverage = summary ? localizeDecimal(String(summary.average), locale) : '';
                                    return (
                                        <div
                                            className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1"
                                            data-testid="retro-scores"
                                        >
                                            {/* Two scores, two scales, and each says which it is.
                                                ROTI is out of 5 and rates the *session*; the impact
                                                is out of 3 and rates what the session's actions
                                                changed. Unlabelled star rows side by side would
                                                read as one measurement taken twice, and the gap
                                                between them — a great conversation that produced
                                                nothing — is the whole point of showing both.

                                                `role="img"` over each pill so a screen reader hears
                                                one phrase rather than a label followed by a loose
                                                number. */}
                                            {roti && (
                                                <span
                                                    role="img"
                                                    aria-label={tp('dashboard.retros.rotiAria', roti.count, { average: rotiAverage, max: ROTI_MAX })}
                                                    data-testid="retro-roti-summary"
                                                    className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5"
                                                    title={tp('dashboard.retros.rotiTitle', roti.count)}
                                                >
                                                    <span className="text-[10px] font-bold uppercase tracking-wide text-sky-700">ROTI</span>
                                                    <StarRating
                                                        value={roti.average}
                                                        max={ROTI_MAX}
                                                        starClassName="w-3 h-3"
                                                        className="text-sky-600"
                                                    />
                                                    <span className="text-xs font-bold text-slate-700">{rotiAverage}/{ROTI_MAX}</span>
                                                </span>
                                            )}
                                            {summary && (
                                                <span
                                                    data-testid="retro-impact-summary"
                                                    className="inline-flex flex-wrap items-center gap-x-2 gap-y-1"
                                                >
                                                    <span
                                                        role="img"
                                                        aria-label={tp('dashboard.retros.impactAria', summary.ratedCount, { average: impactAverage })}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5"
                                                        title={t('dashboard.retros.impactTitle')}
                                                    >
                                                        <span className="text-[10px] font-bold uppercase tracking-wide text-amber-700">{t('dashboard.retros.impactLabel')}</span>
                                                        <StarRating value={summary.average} starClassName="w-3 h-3" />
                                                        <span className="text-xs font-bold text-slate-700">{impactAverage}/3</span>
                                                    </span>
                                                    <span className="text-xs text-slate-600">
                                                        {tp('dashboard.retros.actionCount', summary.actionCount)}
                                                        {' · '}
                                                        {tp('dashboard.retros.ratedCount', summary.ratedCount)}
                                                        {summary.outsideRetroCount > 0 && (
                                                            <span
                                                                className="text-slate-500"
                                                                title={tp('dashboard.retros.outsideTitle', summary.outsideRetroCount)}
                                                            >
                                                                {' · '}{tp('dashboard.retros.outsideCount', summary.outsideRetroCount)}
                                                            </span>
                                                        )}
                                                    </span>
                                                </span>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isAdmin && editingRetroId !== retro.id && (
                              <>
                                <button
                                  onClick={() => {
                                      setEditingRetroId(retro.id);
                                      setEditingRetroName(retro.name);
                                  }}
                                  className="p-2 text-slate-500 hover:text-indigo-600 border border-transparent hover:border-indigo-200 rounded-sm"
                                  title={t('dashboard.retros.rename')}
                                  aria-label={t('dashboard.retros.rename')}
                                >
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                                <button
                                  onClick={() => setRetroToDelete(retro)}
                                  className="p-2 text-slate-500 hover:text-amber-600 border border-transparent hover:border-amber-200 rounded-sm"
                                  title={t('dashboard.deleteRetro.title')}
                                  aria-label={t('dashboard.deleteRetro.title')}
                                >
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              </>
                            )}
                            <button
                                onClick={() => onOpenSession(retro.id)}
                                className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-sm font-bold text-sm hover:border-retro-primary hover:text-retro-primary transition"
                            >
                                {retro.status === 'IN_PROGRESS' ? t('dashboard.session.resume') : t('dashboard.retros.viewSummary')}
                            </button>
                        </div>
                    </div>
                ))
            )}
          </div>
      )}

      {tab === 'MEMBERS' && (
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
          {team.members.map((member) => (
            <div key={member.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${member.color} text-white flex items-center justify-center font-bold uppercase`}>
                {member.name.substring(0, 2)}
              </div>
              <div className="flex flex-col flex-1">
                {editingMemberId === member.id ? (
                  <div className="space-y-2">
                    <div>
                      <label htmlFor={`member-name-${member.id}`} className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">{t('dashboard.members.name')}</label>
                      <input
                        id={`member-name-${member.id}`}
                        type="text"
                        value={editingMemberName}
                        onChange={(e) => setEditingMemberName(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 outline-hidden"
                      />
                    </div>
                    <div>
                      <label htmlFor={`member-email-${member.id}`} className="block text-[11px] uppercase tracking-wide text-slate-500 mb-1">{t('dashboard.members.email')}</label>
                      <input
                        id={`member-email-${member.id}`}
                        type="email"
                        value={editingMemberEmail}
                        onChange={(e) => setEditingMemberEmail(e.target.value)}
                        placeholder={t('dashboard.members.emailPlaceholder')}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 outline-hidden"
                      />
                    </div>
                    {memberEditError && (
                      <div className="text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-sm px-2 py-1">
                        {noticeText(memberEditError, t)}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-bold text-slate-800">{member.name}</span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-500">{t(`dashboard.members.role.${member.role}`)}</span>
                    {member.email && <span className="text-xs text-slate-500">{member.email}</span>}
                  </>
                )}
              </div>
              {isAdmin && (
                <div className="ml-auto flex items-center gap-2">
                  {editingMemberId === member.id ? (
                    <>
                      <button
                        onClick={handleSaveMemberEdit}
                        className="text-emerald-700 hover:text-emerald-700"
                        title={t('dashboard.members.save')}
                        aria-label={t('dashboard.members.save')}
                      >
                        <span className="material-symbols-outlined">check_circle</span>
                      </button>
                      <button
                        onClick={handleCancelMemberEdit}
                        className="text-slate-500 hover:text-slate-600"
                        title={t('dashboard.members.cancelEdit')}
                        aria-label={t('dashboard.members.cancelEdit')}
                      >
                        <span className="material-symbols-outlined">cancel</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleStartMemberEdit(member)}
                        className="text-slate-300 hover:text-indigo-500"
                        title={t('dashboard.members.edit')}
                        aria-label={t('dashboard.members.edit')}
                      >
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      {member.id !== currentUser.id && (
                        <>
                          {memberPendingRemoval === member.id ? (
                            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-full px-3 py-1 text-xs font-semibold text-red-700">
                              <span>{t('dashboard.members.removeConfirm')}</span>
                              <button
                                onClick={() => handleRemoveMember(member.id)}
                                className="bg-red-600 text-white px-2 py-0.5 rounded-full hover:bg-red-700"
                              >
                                {t('common.confirm')}
                              </button>
                              <button
                                onClick={() => setMemberPendingRemoval(null)}
                                className="text-red-600 hover:text-red-700"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setMemberPendingRemoval(member.id)}
                              className="text-slate-300 hover:text-red-500"
                              title={t('dashboard.members.remove')}
                              aria-label={t('dashboard.members.remove')}
                            >
                              <span className="material-symbols-outlined">person_remove</span>
                            </button>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {team.members.length === 0 && (
            <div className="text-center text-slate-500 py-10 col-span-full">{t('dashboard.members.empty')}</div>
          )}
        </div>
      )}

      {/* Health Checks Tab */}
      {tab === 'HEALTH_CHECKS' && (
        <div>
          {/* Start Health Check Button */}
          {isAdmin && (
            <div className="mb-6 flex justify-between items-center">
              <button
                onClick={() => handleOpenNewHealthCheckModal()}
                className="bg-cyan-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-cyan-700 shadow-lg transition"
              >
                <span className="material-symbols-outlined mr-2">add</span> {t('dashboard.healthChecks.start')}
              </button>
            </div>
          )}

          {healthChecks.length === 0 ? (
            <div className="text-center text-slate-500 py-10">{t('dashboard.healthChecks.empty')}</div>
          ) : (
            <>
              {/* Trend Table */}
              {healthChecksByTemplate.map(group => {
                const dimensions = (() => {
                  const seen = new Set<string>();
                  const list: { id: string; name: string; goodDescription?: string; badDescription?: string }[] = [];
                  group.checks.forEach(hc => {
                    hc.dimensions.forEach(d => {
                      if (!seen.has(d.id)) {
                        seen.add(d.id);
                        list.push({ id: d.id, name: d.name, goodDescription: d.goodDescription, badDescription: d.badDescription });
                      }
                    });
                  });
                  return list;
                })();

                // Pagination logic - show max 6 health checks at a time
                const MAX_VISIBLE = MAX_VISIBLE_HEALTH_CHECKS;
                const offset = healthCheckOffsets[group.templateId] ?? Math.max(0, group.checks.length - MAX_VISIBLE);
                const visibleChecks = group.checks.slice(offset, offset + MAX_VISIBLE);
                const hasOlder = offset + MAX_VISIBLE < group.checks.length;
                const hasNewer = offset > 0;

                return (
                  <div key={group.templateId} className="bg-white border border-slate-200 rounded-xl shadow-xs mb-6">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                      <div>
                        <div className="text-sm font-bold text-slate-700">{group.templateName}</div>
                        <div className="text-xs text-slate-500">
                          {/* `> 1`, not tp: the original rule, under which 0 reads singular. */}
                          {t(group.checks.length > 1 ? 'dashboard.healthChecks.sessionsPlural' : 'dashboard.healthChecks.sessionsSingular', { count: group.checks.length })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => hasNewer && setHealthCheckOffsets(prev => ({ ...prev, [group.templateId]: Math.max(0, offset - 1) }))}
                          className={`p-1 rounded-sm transition ${hasNewer ? 'text-slate-500 hover:text-cyan-600 hover:bg-cyan-50' : 'text-slate-300 cursor-not-allowed'}`}
                          title={t('dashboard.healthChecks.showNewer')}
                          disabled={!hasNewer}
                          aria-disabled={!hasNewer}
                          aria-label={t('dashboard.healthChecks.showNewer')}
                        >
                          <span className="material-symbols-outlined text-lg">chevron_left</span>
                        </button>
                        <button
                          onClick={() => hasOlder && setHealthCheckOffsets(prev => ({ ...prev, [group.templateId]: offset + 1 }))}
                          className={`p-1 rounded-sm transition ${hasOlder ? 'text-slate-500 hover:text-cyan-600 hover:bg-cyan-50' : 'text-slate-300 cursor-not-allowed'}`}
                          title={t('dashboard.healthChecks.showOlder')}
                          disabled={!hasOlder}
                          aria-disabled={!hasOlder}
                          aria-label={t('dashboard.healthChecks.showOlder')}
                        >
                          <span className="material-symbols-outlined text-lg">chevron_right</span>
                        </button>
                      </div>
                    </div>
                    <div className="overflow-visible">
                      <table className="w-full table-fixed">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-3 py-2 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide sticky left-0 bg-slate-50 z-20 w-48">
                              {t('dashboard.healthChecks.dimension')}
                            </th>
                            {visibleChecks.map((hc) => {
                              const participantCount = Object.keys(hc.ratings).length;
                              return (
                                <th key={hc.id} className="px-3 py-2 text-left w-24">
                                  <button
                                    type="button"
                                    onClick={() => onOpenHealthCheck(hc.id)}
                                    className="block w-full text-xs font-bold text-slate-700 truncate text-left leading-tight hover:text-cyan-700 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cyan-500 rounded-sm"
                                    title={t('dashboard.healthChecks.openTitle', { name: hc.name })}
                                  >
                                    {hc.name}
                                  </button>
                                  <div className="text-[9px] text-slate-500">{hc.date}</div>
                                  <div className="text-[9px] text-slate-500">
                                    <span className="material-symbols-outlined text-[10px] align-middle">people</span> {participantCount}
                                  </div>
                                </th>
                              );
                            })}
                            <th className="px-3 py-2 text-left w-16">
                              <button
                                onClick={() => handleOpenNewHealthCheckModal(group.templateId)}
                                className="text-cyan-600 hover:text-cyan-700 flex flex-col items-start justify-center w-full"
                                aria-label={t('dashboard.healthChecks.newAria')}
                              >
                                <span className="material-symbols-outlined text-xl">add</span>
                              </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dimensions.map((dim) => (
                            <tr key={dim.id} className="border-b border-slate-200 relative z-0 hover:z-9999">
                              <td className="px-3 py-2 text-xs font-medium text-slate-700 sticky left-0 bg-white border-r border-slate-200 w-48 z-30">
                                <div className="flex items-center gap-1">
                                  <span className="truncate" title={dim.name}>{dim.name}</span>
                                  {(dim.goodDescription || dim.badDescription) && (
                                    <div className="relative inline-block group/info">
                                      <span className="material-symbols-outlined text-xs text-slate-500 cursor-help hover:text-slate-600">info</span>
                                      <div className="invisible group-hover/info:visible absolute left-full top-0 ml-2 mt-1 bg-white border-2 border-slate-300 text-slate-800 text-xs rounded-lg p-3 shadow-2xl w-72 pointer-events-none z-9999">
                                        {dim.goodDescription && (
                                          <div className="mb-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                                            <div className="font-bold text-emerald-700 mb-1">{t('dashboard.healthChecks.good')}</div>
                                            <div className="text-slate-700">{dim.goodDescription}</div>
                                          </div>
                                        )}
                                        {dim.badDescription && (
                                          <div className="bg-rose-50 border border-rose-200 rounded-lg p-2">
                                            <div className="font-bold text-rose-700 mb-1">{t('dashboard.healthChecks.bad')}</div>
                                            <div className="text-slate-700">{dim.badDescription}</div>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                              {visibleChecks.map((hc) => {
                                const stats = getHealthCheckStats(hc);
                                const score = stats[dim.id];
                                const distribution = getScoreDistribution(hc, dim.id);
                                const totalVotes = Object.values(distribution).reduce((a, b) => a + b, 0);

                                if (score === undefined || score === 0) {
                                  return <td key={hc.id} className="px-3 py-2 text-center text-slate-500 text-xs border-r border-slate-200 w-24">-</td>;
                                }

                                // Calculate percentages for visual layers (waves)
                                const layers = [5, 4, 3, 2, 1].map(rating => ({
                                  rating,
                                  count: distribution[rating] || 0,
                                  percentage: totalVotes > 0 ? ((distribution[rating] || 0) / totalVotes) * 100 : 0,
                                  color: rating === 5 ? '#10B981' : rating === 4 ? '#34D399' : rating === 3 ? '#FBBF24' : rating === 2 ? '#F97316' : '#DC2626'
                                }));

                                return (
                                  <td key={hc.id} className="px-3 py-2 relative group/cell border-r border-slate-200 w-24">
                                    <div className="relative w-full h-8 rounded-sm overflow-hidden border border-slate-300 flex items-center justify-center">
                                      {/* Visual evolution layers (waves) */}
                                      <div className="absolute inset-0 flex">
                                        {layers.map(layer => layer.count > 0 && (
                                          <div
                                            key={layer.rating}
                                            className="h-full transition-all"
                                            style={{
                                              width: `${layer.percentage}%`,
                                              backgroundColor: layer.color
                                            }}
                                            title={`${layer.rating}: ${layer.count}`}
                                          />
                                        ))}
                                      </div>
                                      {/* Score overlay - centered */}
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <span className="text-white font-bold text-sm drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                                          {localizeDecimal(score.toFixed(1), locale)}
                                        </span>
                                      </div>
                                    </div>
                                    {/* Hover tooltip with detailed distribution */}
                                    {totalVotes > 0 && (
                                      <div className="invisible group-hover/cell:visible absolute left-1/2 bottom-full mb-2 -translate-x-1/2 bg-white border-2 border-slate-300 text-slate-800 text-xs rounded-lg p-3 shadow-2xl pointer-events-none min-w-[200px] z-50">
                                        <div className="space-y-1.5">
                                          {[5, 4, 3, 2, 1].map(rating => {
                                            const count = distribution[rating] || 0;
                                            const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                                            const bgColor = rating === 5 ? 'bg-emerald-600' : rating === 4 ? 'bg-emerald-400' : rating === 3 ? 'bg-amber-500' : rating === 2 ? 'bg-orange-500' : 'bg-rose-600';
                                            const badgeBg = rating === 5 ? 'bg-emerald-100 text-emerald-700' : rating === 4 ? 'bg-emerald-50 text-emerald-700' : rating === 3 ? 'bg-amber-100 text-amber-700' : rating === 2 ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700';
                                            return (
                                              <div key={rating} className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 w-16">
                                                  <span className={`w-5 h-5 rounded-full ${bgColor} text-white flex items-center justify-center text-xs font-bold`}>
                                                    {rating}
                                                  </span>
                                                  <span className={`px-1.5 py-0.5 rounded-sm text-xs font-bold ${badgeBg}`}>{count}</span>
                                                </div>
                                                <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                                                  <div className={`h-full ${bgColor} transition-all`} style={{ width: `${percentage}%` }}></div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 border-r border-slate-200 w-16"></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

              {/* Health Check List */}
              <div className="space-y-3">
                {healthChecks.map(hc => {
                  const participantCount = Object.keys(hc.ratings).length;
                  // A health check that reached Close is finished even when its
                  // stored status never caught up (see utils/sessionStatus.ts).
                  const hcStatus = effectiveSessionStatus(hc);
                  return (
                    <div key={hc.id} className="bg-white p-5 rounded-lg shadow-xs border border-slate-200 flex items-center justify-between hover:shadow-md transition">
                      <div className="flex items-center grow">
                        <div className="w-12 h-12 rounded-sm bg-cyan-50 text-cyan-600 flex items-center justify-center mr-4">
                          <span className="material-symbols-outlined">monitoring</span>
                        </div>
                        <div className="grow">
                          {editingHealthCheckId === hc.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={editingHealthCheckName}
                                onChange={(e) => setEditingHealthCheckName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleRenameHealthCheck(hc.id);
                                  if (e.key === 'Escape') {
                                    setEditingHealthCheckId(null);
                                    setEditingHealthCheckName('');
                                  }
                                }}
                                className="border border-cyan-500 rounded-sm px-2 py-1 text-lg font-bold text-slate-800 outline-hidden focus:ring-2 focus:ring-cyan-200"
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the rename button it replaces is unmounted by this very click
                                autoFocus
                              />
                              <button
                                onClick={() => handleRenameHealthCheck(hc.id)}
                                className="p-1.5 text-white bg-cyan-600 hover:bg-cyan-700 rounded-sm"
                                title={t('common.save')}
                                aria-label={t('dashboard.healthChecks.saveName')}
                              >
                                <span className="material-symbols-outlined text-base">check</span>
                              </button>
                              <button
                                onClick={() => {
                                  setEditingHealthCheckId(null);
                                  setEditingHealthCheckName('');
                                }}
                                className="p-1.5 text-slate-600 hover:text-slate-800 rounded-sm"
                                title={t('common.cancel')}
                                aria-label={t('dashboard.healthChecks.cancelRename')}
                              >
                                <span className="material-symbols-outlined text-base">close</span>
                              </button>
                            </div>
                          ) : (
                            <h3 className="font-bold text-slate-800 text-lg">{hc.name}</h3>
                          )}
                          <div className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2">
                            <span>{hc.date}</span> •
                            <span>{hc.templateName}</span> •
                            <span>{tp('dashboard.healthChecks.participants', participantCount)}</span> •
                            <span className={hcStatus === 'IN_PROGRESS' ? 'text-green-600' : 'text-slate-500'}>
                              {t(`dashboard.healthCheckStatus.${hcStatus}`)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isAdmin && editingHealthCheckId !== hc.id && (
                          <>
                            <button
                              onClick={() => {
                                setEditingHealthCheckId(hc.id);
                                setEditingHealthCheckName(hc.name);
                              }}
                              className="p-2 text-slate-500 hover:text-cyan-600 border border-transparent hover:border-cyan-200 rounded-sm"
                              title={t('dashboard.healthChecks.rename')}
                              aria-label={t('dashboard.healthChecks.rename')}
                            >
                              <span className="material-symbols-outlined">edit</span>
                            </button>
                            <button
                              onClick={() => setHealthCheckToDelete(hc)}
                              className="p-2 text-slate-500 hover:text-amber-600 border border-transparent hover:border-amber-200 rounded-sm"
                              title={t('dashboard.deleteHealthCheck.title')}
                              aria-label={t('dashboard.deleteHealthCheck.title')}
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => onOpenHealthCheck(hc.id)}
                          className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded-sm font-bold text-sm hover:border-cyan-500 hover:text-cyan-600 transition"
                        >
                          {hcStatus === 'IN_PROGRESS' ? t('dashboard.session.resume') : t('dashboard.healthChecks.viewResults')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Settings Tab */}
      {tab === 'SETTINGS' && (
        <div className="max-w-4xl mx-auto">
          {/* Team Settings */}
          {isAdmin && (
            <div className="mb-8">
              <h2 className="text-xl font-bold text-slate-800 mb-4">{t('dashboard.settings.teamSettings')}</h2>
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
                {/* Team Name Section */}
                <div className="mb-6 pb-6 border-b border-slate-200">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center">
                    <span className="material-symbols-outlined mr-2 text-slate-500">badge</span>
                    {t('dashboard.settings.teamName')}
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    {tRich('dashboard.settings.currentTeamName', {
                      name: <span className="font-semibold text-slate-700">{team.name}</span>
                    })}
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                      placeholder={t('dashboard.settings.newTeamNamePlaceholder')}
                    />
                    <button
                      onClick={handleRenameTeam}
                      disabled={!newTeamName.trim()}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('dashboard.settings.renameTeam')}
                    </button>
                    {teamRenameError && (
                      <p className="text-xs text-red-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">error</span>
                        {noticeText(teamRenameError, t)}
                      </p>
                    )}
                    {teamRenameSuccess && (
                      <p className="text-xs text-green-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">check_circle</span>
                        {noticeText(teamRenameSuccess, t)}
                      </p>
                    )}
                  </div>
                </div>

                {/* The off switch the one-time notice in the retro points at.
                    Team-scoped rather than per-user because it changes what the
                    round asks, not how one person sees it. */}
                <div className="mb-6 pb-6 border-b border-slate-200">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center">
                    <span className="material-symbols-outlined mr-2 text-slate-500">insights</span>
                    {t('dashboard.settings.impactTitle')}
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    {t('dashboard.settings.impactDescription')}
                  </p>
                  <label className="flex items-center gap-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={isActionImpactRatingEnabled(team)}
                      onChange={(e) => {
                        dataService.setActionImpactRatingEnabled(team.id, e.target.checked);
                        onRefresh();
                      }}
                      className="w-4 h-4 accent-indigo-600"
                    />
                    {t('dashboard.settings.impactToggle')}
                  </label>
                </div>

                <div className="mb-4">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center">
                    <span className="material-symbols-outlined mr-2 text-slate-500">email</span>
                    {t('dashboard.settings.recoveryEmail')}
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    {t('dashboard.settings.recoveryEmailDescription')}
                  </p>
                  <div className="flex gap-3">
                    <input
                      type="email"
                      value={team.facilitatorEmail || ''}
                      onChange={(e) => {
                        const updatedTeam = { ...team, facilitatorEmail: e.target.value };
                        dataService.updateFacilitatorEmail(team.id, e.target.value);
                        onRefresh();
                      }}
                      className="flex-1 border border-slate-300 rounded-lg p-2 text-sm"
                      placeholder={t('dashboard.settings.recoveryEmailPlaceholder')}
                    />
                  </div>
                  {!team.facilitatorEmail && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center">
                      <span className="material-symbols-outlined text-xs mr-1">warning</span>
                      {t('dashboard.settings.noRecoveryEmail')}
                    </p>
                  )}
                </div>

                {/* Password Change Section */}
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center">
                    <span className="material-symbols-outlined mr-2 text-slate-500">lock</span>
                    {t('dashboard.settings.changePassword')}
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    {t('dashboard.settings.changePasswordDescription')}
                  </p>
                  <div className="space-y-3">
                    {needsCurrentPassword && (
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                        placeholder={t('dashboard.settings.currentPassword')}
                      />
                    )}
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                      placeholder={t('dashboard.settings.newPassword', { min: PASSWORD_MIN_LENGTH })}
                    />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                      placeholder={t('dashboard.settings.confirmPassword')}
                    />
                    <button
                      onClick={handleChangePassword}
                      disabled={!newPassword || !confirmPassword}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {t('dashboard.settings.changePassword')}
                    </button>
                    {passwordChangeError && (
                      <p className="text-xs text-red-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">error</span>
                        {noticeText(passwordChangeError, t)}
                      </p>
                    )}
                    {passwordChangeSuccess && (
                      <p className="text-xs text-green-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">check_circle</span>
                        {noticeText(passwordChangeSuccess, t)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Health Check Templates (Custom Only) */}
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">{t('dashboard.settings.hcTemplates')}</h2>
              {isAdmin && (
                <button
                  onClick={() => handleOpenTemplateEditor()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-indigo-700"
                >
                  <span className="material-symbols-outlined mr-2">add</span> {t('dashboard.settings.createHcTemplate')}
                </button>
              )}
            </div>

            <div className="space-y-3">
              {healthCheckTemplates.filter(tpl => !tpl.isDefault).length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                  <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">dashboard_customize</span>
                  <p className="text-slate-500">{t('dashboard.settings.noHcTemplates')}</p>
                  {isAdmin && <p className="text-sm text-slate-500 mt-1">{t('dashboard.settings.noHcTemplatesHint')}</p>}
                </div>
              ) : (
                healthCheckTemplates.filter(tpl => !tpl.isDefault).map(template => (
                  <div key={template.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-slate-800 flex items-center">
                          {template.name}
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">{tp('dashboard.settings.dimensionCount', template.dimensions.length)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleTemplateDetails(template.id)}
                          className="text-slate-500 hover:text-slate-600"
                          title={expandedTemplates.includes(template.id) ? t('dashboard.settings.hideDetails') : t('dashboard.settings.viewDetails')}
                          aria-label={expandedTemplates.includes(template.id) ? t('dashboard.settings.hideDetails') : t('dashboard.settings.viewDetails')}
                        >
                          <span className="material-symbols-outlined">{expandedTemplates.includes(template.id) ? 'expand_less' : 'expand_more'}</span>
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleOpenTemplateEditor(template)}
                              className="text-slate-500 hover:text-indigo-600"
                              title={t('dashboard.settings.editTemplate')}
                              aria-label={t('dashboard.settings.editTemplate')}
                            >
                              <span className="material-symbols-outlined">edit</span>
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(template.id)}
                              className="text-slate-500 hover:text-red-500"
                              title={t('dashboard.settings.deleteTemplate')}
                              aria-label={t('dashboard.settings.deleteTemplate')}
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {template.dimensions.slice(0, 5).map(dim => (
                        <span key={dim.id} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-sm">
                          {dim.name}
                        </span>
                      ))}
                      {template.dimensions.length > 5 && (
                        <span className="text-xs text-slate-500">{t('dashboard.settings.moreDimensions', { count: template.dimensions.length - 5 })}</span>
                      )}
                    </div>

                    {expandedTemplates.includes(template.id) && (
                      <div className="mt-4 space-y-2">
                        {template.dimensions.map(dim => (
                          <div key={dim.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                            <div className="font-bold text-slate-800 text-sm">{dim.name}</div>
                            <div className="text-xs text-emerald-700 mt-1"><strong className="text-emerald-700">👍</strong> {dim.goodDescription}</div>
                            <div className="text-xs text-rose-700 mt-1"><strong className="text-rose-700">👎</strong> {dim.badDescription}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Retro Templates (Custom Only) */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-slate-800">{t('dashboard.settings.retroTemplates')}</h2>
              {isAdmin && (
                <button
                  onClick={() => {
                    setRetroTemplateName('');
                    setRetroTemplateCols([
                      {id: '1', title: t('dashboard.columns.numbered', { number: 1 }), color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'},
                      {id: '2', title: t('dashboard.columns.numbered', { number: 2 }), color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200'}
                    ]);
                    setShowRetroTemplateBuilder(true);
                  }}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-indigo-700"
                >
                  <span className="material-symbols-outlined mr-2">add</span> {t('dashboard.retroTemplate.title')}
                </button>
              )}
            </div>
            <div className="space-y-3">
              {(!team.customTemplates || team.customTemplates.length === 0) ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                  <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">view_column</span>
                  <p className="text-slate-500">{t('dashboard.settings.noRetroTemplates')}</p>
                  {isAdmin && <p className="text-sm text-slate-500 mt-1">{t('dashboard.settings.noRetroTemplatesHint')}</p>}
                </div>
              ) : (
                team.customTemplates.map((template, idx) => (
                  <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-slate-800">{template.name}</h3>
                        <p className="text-sm text-slate-500 mt-1">{tp('dashboard.settings.columnCount', template.cols.length)}</p>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => {
                            const newTemplates = (team.customTemplates || []).filter((_, i) => i !== idx);
                            dataService.updateTeam({ ...team, customTemplates: newTemplates });
                            onRefresh();
                          }}
                          className="text-slate-500 hover:text-red-500"
                          title={t('dashboard.settings.deleteTemplate')}
                          aria-label={t('dashboard.settings.deleteTemplate')}
                        >
                          <span className="material-symbols-outlined">delete</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Feedback Hub Tab */}
      {tab === 'FEEDBACK' && (
        <TeamFeedback
          teamId={team.id}
          teamName={team.name}
          teamPassword={dataService.getAuthenticatedPassword() || ''}
          sessionToken={dataService.getSessionToken()}
          currentUserId={currentUser.id}
          currentUserName={currentUser.name}
          feedbacks={team.teamFeedbacks || []}
          onSubmitFeedback={async (feedback) => {
            // Create feedback via API to avoid sync issues
            try {
              const response = await fetch('/api/feedbacks/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  teamId: team.id,
                  password: dataService.getAuthenticatedPassword(),
                  sessionToken: dataService.getSessionToken() ?? undefined,
                  feedback
                })
              });
              if (response.ok) {
                const data = await response.json();
                onRefresh();
                // Send notification email to admin (fire-and-forget).
                // Carries the same team credential as the create call above:
                // the route mails caller-supplied content through the
                // deployment's SMTP identity, so it is authenticated (H29).
                fetch('/api/notify-new-feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    teamId: team.id,
                    password: dataService.getAuthenticatedPassword(),
                    sessionToken: dataService.getSessionToken() ?? undefined,
                    feedback: data.feedback
                  })
                }).catch(() => {});
              }
            } catch (err) {
              console.error('Failed to create feedback', err);
            }
          }}
          onRefresh={onRefresh}
        />
      )}

      {showReleaseAnalysisModal && (
        <ReleaseAnalysisModal
          retrospectives={team.retrospectives}
          members={knownMembers.map(m => ({ id: m.id, name: m.name }))}
          onClose={() => setShowReleaseAnalysisModal(false)}
        />
      )}
    </div>
  );
};

export default Dashboard;
