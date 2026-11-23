import { appFetch } from '../services/publicPath';

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
import { submitTeamFeedback, type FeedbackSubmitResult } from '../services/feedbackSubmission';
import DashboardActionsTab from './dashboard/DashboardActionsTab';
import DashboardTabs, { DashboardTab } from './dashboard/DashboardTabs';
import { getSuggestedName } from './dashboard/dashboardUtils';
import { localizeDecimal } from '../i18n/formatNumber';
import { sortActionsByClosure, sortActionsByRecency } from './dashboard/actionSorting';
import { retroImpactSummaries } from './dashboard/actionImpact';
import { ROTI_MAX, retroRotiSummary } from './dashboard/retroRoti';
import StarRating from './common/StarRating';
import { isActionImpactRatingEnabled } from './session/closedActionsForRating';
import { groupHealthChecksByTemplate } from './dashboard/healthCheckUtils';
import ReleaseAnalysisModal from './dashboard/ReleaseAnalysisModal';
import RecoveryEmailSetting from './dashboard/RecoveryEmailSetting';
import JiraTeamSettings from './jira/JiraTeamSettings';
import { useJiraStatus } from './jira/useJiraStatus';
import ModalDialog from './common/ModalDialog';
import ColumnMoveButtons from './common/ColumnMoveButtons';
import { moveColumn } from '../utils/columnOrder';
import { useTranslation } from '../i18n/I18nContext';
import { Notice, noticeText } from '../i18n/notice';
import { translateErrorMessage } from '../i18n/errorMessages';
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
import { isOpenBoard } from '../utils/openBoard';
import { avatarColorClasses } from '../utils/participantColors';
import Avatar from './common/Avatar';
import { memberAvatarId } from '../utils/avatars.js';
import { HEALTH_RATING_BADGE } from '../utils/healthRatingColors';
import { columnIconName } from './iconPickerIcons';
import {
  CARD,
  CHIP,
  COLUMN_COLOR_BUTTON,
  COLUMN_ICON_BUTTON,
  DANGER_BUTTON,
  DANGER_ICON_BUTTON,
  DANGER_SECONDARY_BUTTON,
  DIALOG_OVERLAY,
  DIALOG_PANEL,
  DIALOG_TITLE,
  EMPTY_STATE,
  ERROR_NOTICE,
  ERROR_TEXT,
  FIELD,
  FIELD_BOX,
  FIELD_LABEL,
  GHOST_BUTTON,
  ICON_BUTTON,
  LINK_BUTTON,
  LIST_ROW,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECTION_LABEL,
  SEGMENTED,
  SETTING_ICON,
  SETTING_TITLE,
  SEGMENT_OFF,
  SEGMENT_ON,
  SUCCESS_TEXT,
  SWITCH_KNOB,
  SWITCH_OFF,
  SWITCH_ON,
  SWITCH_TRACK,
  sessionStatusChip
} from './dashboard/dashboardLook';

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
  // A refusal from the server, kept as the data layer's English message and
  // translated on display (i18n/errorMessages.ts).
  const [deleteTeamError, setDeleteTeamError] = useState<string | null>(null);
  const [deletingTeam, setDeletingTeam] = useState(false);
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
  // The team's Jira status, for the Actions tab: read each time the tab opens,
  // which also picks up a change saved in Settings → Jira (finding U-9), and
  // never from dataService while rendering (finding T-49). The Settings card
  // reads its own.
  const { status: jiraStatus, refresh: refreshJiraStatus } = useJiraStatus(tab === 'ACTIONS' ? team.id : null);

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
  // Every retro's impact line, computed once per team record rather than per
  // retro on every render: each keystroke in a Dashboard field re-renders the
  // Retros tab, and at a hundred retros the per-retro version took 0.4 s.
  const retroImpactByRetro = useMemo(
    () => (isActionImpactRatingEnabled(team) ? retroImpactSummaries(team) : null),
    [team]
  );

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
        const response = await appFetch('/api/info-message');
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
    appFetch('/api/ai-status')
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
  // A guided retrospective, or an open board (utils/openBoard.ts): every card
  // activity on one screen, kept open. Reset each time the dialog opens.
  const [boardType, setBoardType] = useState<'guided' | 'open'>('guided');
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
    setBoardType('guided');
    setShowNewRetroModal(true);
  };

  // Both types name their authors unless the facilitator says otherwise, so a
  // change of type leaves the anonymity toggle below it as they set it.
  const handleBoardTypeChange = (next: 'guided' | 'open') => {
    if (next === boardType) return;
    setBoardType(next);
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
    const session = dataService.createSession(team.id, finalName, safeCols, {
      isAnonymous,
      templateLanguage,
      ...(boardType === 'open' ? { openBoard: true } : {})
    });
    
    // Save template if name provided during creation of CUSTOM
    if(isCreatingCustom && templateName) {
        dataService.saveTemplate(team.id, { name: templateName, cols: safeCols });
    }

    setShowNewRetroModal(false);
    onRefresh();
    onOpenSession(session.id);
  };

  const isAdmin = currentUser.role === 'facilitator';

  const handleDeleteTeam = async () => {
    if (deleteConfirmText !== team.name || deletingTeam) return;
    setDeleteTeamError(null);
    setDeletingTeam(true);
    try {
      await dataService.deleteTeam(team.id);
    } catch (err) {
      // The team is still there: say so instead of logging out as if it were
      // gone.
      setDeleteTeamError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setDeletingTeam(false);
    }
    setShowDeleteModal(false);
    if (onDeleteTeam) {
      onDeleteTeam();
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
          onClose={() => { setShowDeleteModal(false); setDeleteConfirmText(''); setDeleteTeamError(null); }}
          overlayClassName={DIALOG_OVERLAY}
          panelClassName={`${DIALOG_PANEL} p-6 sm:p-8 max-w-md`}
        >
          <>
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-rose-50 text-rose-700 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl" aria-hidden="true">warning</span>
              </div>
              <h2 id="dashboard-delete-team-title" className={`${DIALOG_TITLE} mb-2`}>{t('dashboard.deleteTeam.title')}</h2>
              <p className="text-slate-600 text-sm">
                {tRich('dashboard.deleteTeam.warning', {
                  irreversible: <strong className="text-rose-700">{t('dashboard.deleteTeam.irreversible')}</strong>
                })}
              </p>
            </div>

            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-6">
              <p className="text-sm text-rose-800 mb-3">
                {tRich('dashboard.deleteTeam.confirmPrompt', { name: <strong>{team.name}</strong> })}
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={t('dashboard.deleteTeam.placeholder')}
                className={FIELD}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- inside ModalDialog, which moves focus in regardless; this only picks the field the user must type in
                autoFocus
              />
            </div>

            {deleteTeamError && (
              <p role="alert" className={`${ERROR_NOTICE} mb-4`}>
                {translateErrorMessage(deleteTeamError, t)}
              </p>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); setDeleteTeamError(null); }}
                disabled={deletingTeam}
                className={`${SECONDARY_BUTTON} flex-1 py-2.5`}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={deleteConfirmText !== team.name || deletingTeam}
                className={`${DANGER_BUTTON} flex-1 py-2.5`}
              >
                {deletingTeam ? t('dashboard.deleteTeam.deleting') : t('dashboard.deleteTeam.title')}
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
          overlayClassName={DIALOG_OVERLAY}
          panelClassName={`${DIALOG_PANEL} p-6 sm:p-8 max-w-md`}
        >
          <>
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl" aria-hidden="true">archive</span>
              </div>
              <h2 id="dashboard-delete-retro-title" className={`${DIALOG_TITLE} mb-2`}>{t('dashboard.deleteRetro.title')}</h2>
              <p className="text-slate-600 text-sm">
                {tRich('dashboard.deleteSession.keepActions', { name: <strong className="text-slate-900">{retroToDelete.name}</strong> })}
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setRetroToDelete(null)}
                className={`${SECONDARY_BUTTON} flex-1 py-2.5`}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteRetro}
                className={`${DANGER_BUTTON} flex-1 py-2.5`}
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
            overlayClassName={DIALOG_OVERLAY}
            panelClassName={`${DIALOG_PANEL} p-6 sm:p-8 max-w-2xl max-h-[90vh] overflow-y-auto`}
          >
              <>
                  <div className="flex justify-between items-center mb-6">
                      <h2 id="dashboard-new-retro-title" className={DIALOG_TITLE}>{t('dashboard.newRetro.title')}</h2>
                      <button onClick={() => setShowNewRetroModal(false)} className={`${ICON_BUTTON} -mr-2`} aria-label={t('dashboard.newRetro.close')}><span className="material-symbols-outlined" aria-hidden="true">close</span></button>
                  </div>

                  <div className="mb-6">
                      <label htmlFor="new-retro-name" className={`${FIELD_LABEL} mb-1.5`}>{t('dashboard.form.sessionName')}</label>
                      <input
                        id="new-retro-name"
                        type="text"
                        value={retroName}
                        onChange={(e) => setRetroName(e.target.value)}
                        className={`${FIELD} font-medium`}
                      />
                  </div>

                  {!isCreatingCustom ? (
                      <div className="space-y-6">
                        {/* The three settings of the new session: one panel, hairlines
                            between them, rather than a box per setting. */}
                        <div className="rounded-xl border border-slate-200 divide-y divide-slate-200">
                        <div className="p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div id="board-type-label" className="text-sm font-semibold text-slate-900">{t('dashboard.newRetro.boardTypeLabel')}</div>
                            <div
                              role="group"
                              aria-labelledby="board-type-label"
                              aria-describedby="board-type-hint"
                              className={SEGMENTED}
                            >
                              {(['guided', 'open'] as const).map(option => (
                                <button
                                  key={option}
                                  type="button"
                                  aria-pressed={boardType === option}
                                  onClick={() => handleBoardTypeChange(option)}
                                  className={boardType === option ? SEGMENT_ON : SEGMENT_OFF}
                                  data-testid={`board-type-${option}`}
                                >
                                  {option === 'open' ? t('dashboard.newRetro.boardTypeOpen') : t('dashboard.newRetro.boardTypeGuided')}
                                </button>
                              ))}
                            </div>
                          </div>
                          <p id="board-type-hint" className="text-xs text-slate-600 mt-1.5">
                            {boardType === 'open' ? t('dashboard.newRetro.boardTypeOpenHint') : t('dashboard.newRetro.boardTypeGuidedHint')}
                          </p>
                        </div>

                        <div className="flex items-center justify-between gap-3 p-4">
                          <div>
                            <div className="text-sm font-semibold text-slate-900">{t('dashboard.form.anonymousMode')}</div>
                            <p className="text-xs text-slate-600 mt-0.5">{t('dashboard.newRetro.anonymousHint')}</p>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isAnonymous}
                            onClick={() => setIsAnonymous(!isAnonymous)}
                            className={`${SWITCH_TRACK} ${isAnonymous ? SWITCH_ON : SWITCH_OFF}`}
                            aria-label={t('dashboard.form.toggleAnonymous')}
                          >
                            <span className={`${SWITCH_KNOB} ${isAnonymous ? 'translate-x-5' : ''}`}></span>
                          </button>
                        </div>

                        <div className="p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div id="template-language-label" className="text-sm font-semibold text-slate-900">{t('templates.language.label')}</div>
                            <div
                              role="group"
                              aria-labelledby="template-language-label"
                              aria-describedby="template-language-hint"
                              className={SEGMENTED}
                            >
                              {SUPPORTED_LANGUAGES.map(option => (
                                <button
                                  key={option}
                                  type="button"
                                  lang={option}
                                  aria-pressed={templateLanguage === option}
                                  onClick={() => handleTemplateLanguageChange(option)}
                                  className={templateLanguage === option ? SEGMENT_ON : SEGMENT_OFF}
                                  data-testid={`template-language-${option}`}
                                >
                                  {LANGUAGE_NATIVE_NAMES[option]}
                                </button>
                              ))}
                            </div>
                          </div>
                          <p id="template-language-hint" className="text-xs text-slate-600 mt-1.5">{t('templates.language.hint')}</p>
                        </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto p-0.5 pr-2" lang={templateLanguage}>
                            {RETRO_TEMPLATES.map(template => {
                                const words = getRetroTemplateWords(template.id, templateLanguage);
                                return (
                                    <button
                                        key={template.id}
                                        onClick={() => handleStartRetro(getRetroTemplateColumns(template.id, templateLanguage))}
                                        className="p-4 bg-white border border-slate-200 rounded-xl shadow-xs hover:border-indigo-600 hover:bg-indigo-50 hover:shadow-md transition text-left group"
                                        data-testid={`retro-template-${template.id}`}
                                    >
                                        <div className="font-semibold text-slate-900 mb-1 group-hover:text-indigo-700">{words.name}</div>
                                        <p className="text-xs text-slate-600">{words.description}</p>
                                    </button>
                                );
                            })}
                        </div>

                        {team.customTemplates.length > 0 && (
                            <div>
                                <h3 className={`${SECTION_LABEL} mb-3`}>{t('dashboard.newRetro.savedTemplates')}</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {team.customTemplates.map((savedTemplate, idx) => (
                                        <button key={idx} onClick={() => handleStartRetro(savedTemplate.cols)} className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs hover:border-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 text-sm font-semibold text-slate-900 text-left transition">
                                            {savedTemplate.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="border-t border-slate-200 pt-4 flex justify-center">
                            <button onClick={() => setIsCreatingCustom(true)} className={`${LINK_BUTTON} py-2 px-2`}>
                                <span className="material-symbols-outlined text-xl" aria-hidden="true">edit</span> {t('dashboard.newRetro.createCustom')}
                            </button>
                        </div>
                      </div>
                  ) : (
                      <div className="space-y-4">
                          <div>
                              <label htmlFor="custom-template-name" className={`${FIELD_LABEL} mb-1.5`}>{t('dashboard.newRetro.customTemplateName')}</label>
                              <input
                                id="custom-template-name"
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                className={FIELD}
                                placeholder={t('dashboard.retroTemplate.namePlaceholder')}
                              />
                          </div>
                          <div role="group" aria-labelledby="custom-template-columns-label">
                              <span id="custom-template-columns-label" className={`${FIELD_LABEL} mb-2`}>{t('dashboard.columns.label')}</span>
                              {customCols.map((c, idx) => (
                                  <div key={c.id} className="relative flex gap-2 mb-3 items-center">
                                      <ColumnMoveButtons
                                        index={idx}
                                        count={customCols.length}
                                        orientation="vertical"
                                        previousLabel={t('dashboard.columns.moveUp', { number: idx + 1 })}
                                        nextLabel={t('dashboard.columns.moveDown', { number: idx + 1 })}
                                        onMove={(direction) => setCustomCols((current) => moveColumn(current, c.id, direction))}
                                      />
                                      {/* Icon Picker Button. Both pickers are anchored to the
                                          row (relative), so each fits its width on a phone. */}
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setIconPickerOpen(iconPickerOpen === c.id ? null : c.id);
                                            setColorPickerOpen(null);
                                          }}
                                          className={COLUMN_ICON_BUTTON}
                                          title={t('dashboard.columns.pickIcon')}
                                          aria-label={t('dashboard.columns.pickIconFor', { number: idx + 1 })}
                                        >
                                          <span
                                            className="material-symbols-outlined text-xl"
                                            aria-hidden="true"
                                            style={{ color: readableTextColor(c.customColor || '#64748B') }}
                                          >
                                            {columnIconName(c.icon)}
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
                                      <div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setColorPickerOpen(colorPickerOpen === c.id ? null : c.id);
                                            setIconPickerOpen(null);
                                          }}
                                          className={COLUMN_COLOR_BUTTON}
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
                                        className={`${FIELD_BOX} grow min-w-0 text-sm`}
                                        placeholder={t('dashboard.columns.numbered', { number: idx + 1 })}
                                      />
                                      {customCols.length > 2 && (
                                        <button
                                          onClick={() => {
                                            setCustomCols(customCols.filter((_, i) => i !== idx));
                                            if (colorPickerOpen === c.id) setColorPickerOpen(null);
                                            if (iconPickerOpen === c.id) setIconPickerOpen(null);
                                          }}
                                          className={DANGER_ICON_BUTTON}
                                          aria-label={t('dashboard.columns.remove', { number: idx + 1 })}
                                        >
                                          <span className="material-symbols-outlined" aria-hidden="true">delete</span>
                                        </button>
                                      )}
                                  </div>
                              ))}
                              <button
                                onClick={() => setCustomCols([...customCols, {id: randomId(), title: '', color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#64748B'}])}
                                className={LINK_BUTTON}
                              >
                                <span className="material-symbols-outlined text-lg" aria-hidden="true">add</span>
                                {t('dashboard.columns.add')}
                              </button>
                          </div>
                          <div className="flex justify-between gap-3 pt-4 border-t border-slate-200 mt-4">
                              <button onClick={() => setIsCreatingCustom(false)} className={`${GHOST_BUTTON} px-4 py-2`}>{t('common.back')}</button>
                              <button onClick={() => handleStartRetro(customCols)} className={`${PRIMARY_BUTTON} px-6 py-2`}>{t('dashboard.newRetro.start')}</button>
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
          overlayClassName={DIALOG_OVERLAY}
          panelClassName={`${DIALOG_PANEL} p-6 sm:p-8 max-w-lg`}
        >
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 id="dashboard-new-healthcheck-title" className={DIALOG_TITLE}>{t('dashboard.newHealthCheck.title')}</h2>
              <button onClick={() => setShowNewHealthCheckModal(false)} className={`${ICON_BUTTON} -mr-2`} aria-label={t('dashboard.newHealthCheck.close')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="new-healthcheck-name" className={`${FIELD_LABEL} mb-1.5`}>{t('dashboard.form.sessionName')}</label>
                <input
                  id="new-healthcheck-name"
                  type="text"
                  value={healthCheckName}
                  onChange={(e) => setHealthCheckName(e.target.value)}
                  className={`${FIELD} font-medium`}
                />
              </div>

              <div>
                <label htmlFor="healthcheck-template" className={`${FIELD_LABEL} mb-1.5`}>{t('dashboard.newHealthCheck.template')}</label>
                <select
                  id="healthcheck-template"
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className={FIELD}
                >
                  {healthCheckTemplates.map(tpl => (
                    <option key={tpl.id} value={tpl.id}>
                      {tp('dashboard.newHealthCheck.templateOption', tpl.dimensions.length, { name: tpl.name })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-3 p-4 border border-slate-200 rounded-xl">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{t('dashboard.form.anonymousMode')}</div>
                  <p className="text-xs text-slate-600 mt-0.5">{t('dashboard.newHealthCheck.anonymousHint')}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isHealthCheckAnonymous}
                  onClick={() => setIsHealthCheckAnonymous(!isHealthCheckAnonymous)}
                  className={`${SWITCH_TRACK} ${isHealthCheckAnonymous ? SWITCH_ON : SWITCH_OFF}`}
                  aria-label={t('dashboard.form.toggleAnonymous')}
                >
                  <span className={`${SWITCH_KNOB} ${isHealthCheckAnonymous ? 'translate-x-5' : ''}`}></span>
                </button>
              </div>

              <button
                onClick={handleStartHealthCheck}
                disabled={!selectedTemplateId}
                className={`${PRIMARY_BUTTON} w-full py-3`}
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
          overlayClassName={DIALOG_OVERLAY}
          panelClassName={`${DIALOG_PANEL} p-6 sm:p-8 max-w-md`}
        >
          <>
            <div className="text-center mb-6">
              <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl" aria-hidden="true">archive</span>
              </div>
              <h2 id="dashboard-delete-healthcheck-title" className={`${DIALOG_TITLE} mb-2`}>{t('dashboard.deleteHealthCheck.title')}</h2>
              <p className="text-slate-600 text-sm">
                {tRich('dashboard.deleteSession.keepActions', { name: <strong className="text-slate-900">{healthCheckToDelete.name}</strong> })}
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setHealthCheckToDelete(null)}
                className={`${SECONDARY_BUTTON} flex-1 py-2.5`}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteHealthCheck}
                className={`${DANGER_BUTTON} flex-1 py-2.5`}
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
          overlayClassName={DIALOG_OVERLAY}
          panelClassName={`${DIALOG_PANEL} p-6 sm:p-8 max-w-3xl max-h-[90vh] overflow-y-auto`}
        >
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 id="dashboard-template-editor-title" className={DIALOG_TITLE}>
                {editingTemplate ? t('dashboard.hcTemplate.editTitle') : t('dashboard.hcTemplate.createTitle')}
              </h2>
              <button onClick={() => setShowTemplateEditor(false)} className={`${ICON_BUTTON} -mr-2`} aria-label={t('dashboard.hcTemplate.close')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="healthcheck-template-name" className={`${FIELD_LABEL} mb-1.5`}>{t('dashboard.form.templateName')}</label>
                <input
                  id="healthcheck-template-name"
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder={t('dashboard.hcTemplate.namePlaceholder')}
                  className={FIELD}
                />
              </div>

              <div>
                <span id="healthcheck-template-dimensions-label" className={`${FIELD_LABEL} mb-2`}>{t('dashboard.hcTemplate.dimensions')}</span>
                <div role="group" aria-labelledby="healthcheck-template-dimensions-label" className="space-y-4">
                  {newTemplateDimensions.map((dim, idx) => (
                    <div key={dim.id} className={`${CARD} p-4`}>
                      <div className="flex justify-between items-center mb-3">
                        <span className={SECTION_LABEL}>{t('dashboard.hcTemplate.dimensionNumber', { number: idx + 1 })}</span>
                        {newTemplateDimensions.length > 1 && (
                          <button onClick={() => removeDimension(idx)} className={`${DANGER_ICON_BUTTON} -my-1.5 -mr-1.5`} aria-label={t('dashboard.hcTemplate.removeDimension', { number: idx + 1 })}>
                            <span className="material-symbols-outlined text-xl" aria-hidden="true">delete</span>
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder={t('dashboard.hcTemplate.dimensionName')}
                        value={dim.name}
                        onChange={(e) => updateDimension(idx, 'name', e.target.value)}
                        className={`${FIELD} mb-2 font-medium`}
                      />
                      <textarea
                        placeholder={t('dashboard.hcTemplate.goodPlaceholder')}
                        value={dim.goodDescription}
                        onChange={(e) => updateDimension(idx, 'goodDescription', e.target.value)}
                        className={`${FIELD} mb-2 text-sm resize-none h-16`}
                      />
                      <textarea
                        placeholder={t('dashboard.hcTemplate.badPlaceholder')}
                        value={dim.badDescription}
                        onChange={(e) => updateDimension(idx, 'badDescription', e.target.value)}
                        className={`${FIELD} text-sm resize-none h-16`}
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={addDimension}
                  className={`${LINK_BUTTON} mt-3`}
                >
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">add</span>
                  {t('dashboard.hcTemplate.addDimension')}
                </button>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  onClick={() => setShowTemplateEditor(false)}
                  className={`${GHOST_BUTTON} px-4 py-2`}
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={!newTemplateName.trim() || newTemplateDimensions.every(d => !d.name.trim())}
                  className={`${PRIMARY_BUTTON} px-6 py-2`}
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
          overlayClassName={DIALOG_OVERLAY}
          panelClassName={`${DIALOG_PANEL} p-6 sm:p-8 max-w-2xl max-h-[90vh] overflow-y-auto`}
        >
          <>
            <div className="flex justify-between items-center mb-6">
              <h2 id="dashboard-retro-template-title" className={DIALOG_TITLE}>{t('dashboard.retroTemplate.title')}</h2>
              <button onClick={() => setShowRetroTemplateBuilder(false)} className={`${ICON_BUTTON} -mr-2`} aria-label={t('dashboard.retroTemplate.close')}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label htmlFor="retro-template-name" className={`${FIELD_LABEL} mb-1.5`}>{t('dashboard.form.templateName')}</label>
                <input
                  id="retro-template-name"
                  type="text"
                  value={retroTemplateName}
                  onChange={(e) => setRetroTemplateName(e.target.value)}
                  placeholder={t('dashboard.retroTemplate.namePlaceholder')}
                  className={FIELD}
                />
              </div>

              <div role="group" aria-labelledby="retro-template-columns-label">
                <span id="retro-template-columns-label" className={`${FIELD_LABEL} mb-2`}>{t('dashboard.columns.label')}</span>
                {retroTemplateCols.map((c, idx) => {
                  return (
                    <div key={c.id} className="relative flex gap-2 mb-3 items-center">
                      <ColumnMoveButtons
                        index={idx}
                        count={retroTemplateCols.length}
                        orientation="vertical"
                        previousLabel={t('dashboard.columns.moveUp', { number: idx + 1 })}
                        nextLabel={t('dashboard.columns.moveDown', { number: idx + 1 })}
                        onMove={(direction) => setRetroTemplateCols((current) => moveColumn(current, c.id, direction))}
                      />
                      {/* Icon Picker Button. Both pickers are anchored to the row
                          (relative), as in Create Custom Template. */}
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setIconPickerOpen(iconPickerOpen === c.id ? null : c.id);
                            setColorPickerOpen(null);
                          }}
                          className={COLUMN_ICON_BUTTON}
                          title={t('dashboard.columns.pickIcon')}
                          aria-label={t('dashboard.columns.pickIconFor', { number: idx + 1 })}
                        >
                          <span
                            className="material-symbols-outlined text-xl"
                            aria-hidden="true"
                            style={{ color: readableTextColor(c.customColor || '#64748B') }}
                          >
                            {columnIconName(c.icon)}
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
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            setColorPickerOpen(colorPickerOpen === c.id ? null : c.id);
                            setIconPickerOpen(null);
                          }}
                          className={COLUMN_COLOR_BUTTON}
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
                        className={`${FIELD_BOX} grow min-w-0 text-sm`}
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
                          className={DANGER_ICON_BUTTON}
                          aria-label={t('dashboard.columns.remove', { number: idx + 1 })}
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">delete</span>
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
                  className={LINK_BUTTON}
                >
                  <span className="material-symbols-outlined text-lg" aria-hidden="true">add</span>
                  {t('dashboard.columns.add')}
                </button>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button onClick={() => setShowRetroTemplateBuilder(false)} className={`${SECONDARY_BUTTON} px-4 py-2`}>{t('common.cancel')}</button>
                <button onClick={handleSaveRetroTemplate} className={`${PRIMARY_BUTTON} px-6 py-2`}>{t('dashboard.form.saveTemplate')}</button>
              </div>
            </div>
          </>
        </ModalDialog>
      )}

      {infoMessage && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-700 text-xl shrink-0" aria-hidden="true">info</span>
            <p className="text-sm text-amber-900 whitespace-pre-wrap">{infoMessage}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 break-words">{t('dashboard.header.title', { name: team.name })}</h1>
            {/* slate-600 on the page's grey (slate-50), 6.29:1: a step darker than it needs, as slate-500 reads there too (5.01:1). */}
            <p className="text-slate-600 mt-1">{t('dashboard.header.subtitle')}</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2 shrink-0">
                <button onClick={handleOpenNewRetroModal} className={`${PRIMARY_BUTTON} px-4 py-2 text-sm`}>
                    <span className="material-symbols-outlined text-xl" aria-hidden="true">add</span> {t('dashboard.header.newRetro')}
                </button>
                <button
                    onClick={() => setShowDeleteModal(true)}
                    className={`${DANGER_SECONDARY_BUTTON} px-3 py-2`}
                    title={t('dashboard.deleteTeam.title')}
                    aria-label={t('dashboard.deleteTeam.title')}
                >
                    <span className="material-symbols-outlined text-xl" aria-hidden="true">delete</span>
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
          jiraStatus={jiraStatus}
          isFacilitator={isAdmin}
          requestedBy={currentUser.name}
          onJiraChanged={onRefresh}
          onJiraStatusStale={() => { void refreshJiraStatus(); }}
        />
      )}

      {tab === 'RETROS' && (
          <div>
              {isAdmin && aiEnabled && team.retrospectives.length > 0 && (
                <div className="flex justify-end mb-4">
                  <button
                    onClick={() => setShowReleaseAnalysisModal(true)}
                    data-testid="open-release-analysis"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 transition"
                    title={t('dashboard.retros.analyzeTitle')}
                  >
                    <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">smart_toy</span>
                    {t('dashboard.retros.analyze')}
                  </button>
                </div>
              )}
              {team.retrospectives.length === 0 ? (
                  <div className={EMPTY_STATE}>{t('dashboard.retros.empty')}</div>
              ) : (
                  team.retrospectives.map(retro => (
                    <div key={retro.id} className={`${LIST_ROW} p-4 sm:p-5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 mb-3`}>
                        <div className="flex items-center grow min-w-0">
                            <div className="w-11 h-11 shrink-0 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mr-4">
                                <span className="material-symbols-outlined" aria-hidden="true">{isOpenBoard(retro) ? 'view_kanban' : 'event_note'}</span>
                            </div>
                            <div className="grow min-w-0">
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
                                            className={`${FIELD_BOX} text-lg font-semibold min-w-0`}
                                            // eslint-disable-next-line jsx-a11y/no-autofocus -- the rename button it replaces is unmounted by this very click
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => handleRenameRetro(retro.id)}
                                            className={`${PRIMARY_BUTTON} w-9 h-9 shrink-0`}
                                            title={t('common.save')}
                                            aria-label={t('dashboard.retros.saveName')}
                                        >
                                            <span className="material-symbols-outlined text-xl" aria-hidden="true">check</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingRetroId(null);
                                                setEditingRetroName('');
                                            }}
                                            className={ICON_BUTTON}
                                            title={t('common.cancel')}
                                            aria-label={t('dashboard.retros.cancelRename')}
                                        >
                                            <span className="material-symbols-outlined text-xl" aria-hidden="true">close</span>
                                        </button>
                                    </div>
                                ) : (
                                    <h3 className="font-semibold text-slate-900 text-lg leading-snug break-words">{retro.name}</h3>
                                )}
                                <div className="mt-1 text-xs text-slate-600 font-medium flex flex-wrap items-center gap-2">
                                    <span className="tabular-nums">{retro.date}</span>
                                    {/* A board is never closed: the list says what it is instead.
                                        Each chip's ink is the 700 of its tint, measured at 4.5:1. */}
                                    <span className={`${CHIP} uppercase tracking-wide ${sessionStatusChip(isOpenBoard(retro) ? 'OPEN_BOARD' : retro.status)}`}>
                                        {isOpenBoard(retro) ? t('dashboard.retroStatus.OPEN_BOARD') : t(`dashboard.retroStatus.${retro.status}`)}
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
                                    const summary = retroImpactByRetro?.get(retro.id) ?? null;
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
                        <div className="flex items-center gap-1 ml-auto shrink-0">
                            {isAdmin && editingRetroId !== retro.id && (
                              <>
                                <button
                                  onClick={() => {
                                      setEditingRetroId(retro.id);
                                      setEditingRetroName(retro.name);
                                  }}
                                  className={ICON_BUTTON}
                                  title={t('dashboard.retros.rename')}
                                  aria-label={t('dashboard.retros.rename')}
                                >
                                  <span className="material-symbols-outlined text-xl" aria-hidden="true">edit</span>
                                </button>
                                <button
                                  onClick={() => setRetroToDelete(retro)}
                                  className={DANGER_ICON_BUTTON}
                                  title={t('dashboard.deleteRetro.title')}
                                  aria-label={t('dashboard.deleteRetro.title')}
                                >
                                  <span className="material-symbols-outlined text-xl" aria-hidden="true">delete</span>
                                </button>
                              </>
                            )}
                            <button
                                onClick={() => onOpenSession(retro.id)}
                                className={`${SECONDARY_BUTTON} px-4 py-2 text-sm ml-1`}
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
            <div key={member.id} className={`${CARD} p-4 flex flex-wrap items-center gap-3`}>
              <Avatar colorClasses={avatarColorClasses(member.color)} initials={member.name.substring(0, 2)} size={40} avatarId={memberAvatarId(team, member.id)} />
              {/* At least 8rem for the name: the removal question goes to its own line rather than squeeze it. */}
              <div className="flex flex-col flex-1 min-w-[8rem]">
                {editingMemberId === member.id ? (
                  <div className="space-y-2">
                    <div>
                      <label htmlFor={`member-name-${member.id}`} className={`${SECTION_LABEL} block mb-1`}>{t('dashboard.members.name')}</label>
                      <input
                        id={`member-name-${member.id}`}
                        type="text"
                        value={editingMemberName}
                        onChange={(e) => setEditingMemberName(e.target.value)}
                        className={`${FIELD} text-sm`}
                      />
                    </div>
                    <div>
                      <label htmlFor={`member-email-${member.id}`} className={`${SECTION_LABEL} block mb-1`}>{t('dashboard.members.email')}</label>
                      <input
                        id={`member-email-${member.id}`}
                        type="email"
                        value={editingMemberEmail}
                        onChange={(e) => setEditingMemberEmail(e.target.value)}
                        placeholder={t('dashboard.members.emailPlaceholder')}
                        className={`${FIELD} text-sm`}
                      />
                    </div>
                    {memberEditError && (
                      <div className={`${ERROR_NOTICE} text-xs`}>
                        {noticeText(memberEditError, t)}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-slate-900 truncate">{member.name}</span>
                    {/* The role words are lowercase in both dictionaries; the list used to show them in capitals. */}
                    <span className="text-xs text-slate-600 first-letter:uppercase">{t(`dashboard.members.role.${member.role}`)}</span>
                    {member.email && <span className="text-xs text-slate-600 truncate">{member.email}</span>}
                  </>
                )}
              </div>
              {isAdmin && (
                <div className="ml-auto flex items-center gap-1 shrink-0">
                  {editingMemberId === member.id ? (
                    <>
                      <button
                        onClick={handleSaveMemberEdit}
                        className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-emerald-700 hover:bg-emerald-50 transition"
                        title={t('dashboard.members.save')}
                        aria-label={t('dashboard.members.save')}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">check_circle</span>
                      </button>
                      <button
                        onClick={handleCancelMemberEdit}
                        className={ICON_BUTTON}
                        title={t('dashboard.members.cancelEdit')}
                        aria-label={t('dashboard.members.cancelEdit')}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">cancel</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleStartMemberEdit(member)}
                        className={ICON_BUTTON}
                        title={t('dashboard.members.edit')}
                        aria-label={t('dashboard.members.edit')}
                      >
                        <span className="material-symbols-outlined text-xl" aria-hidden="true">edit</span>
                      </button>
                      {member.id !== currentUser.id && (
                        <>
                          {memberPendingRemoval === member.id ? (
                            <div className="flex items-center gap-2 bg-rose-50 border border-rose-200 rounded-full pl-3 pr-1 py-1 text-xs font-semibold text-rose-800">
                              <span>{t('dashboard.members.removeConfirm')}</span>
                              <button
                                onClick={() => handleRemoveMember(member.id)}
                                className="bg-rose-700 text-white px-2.5 py-0.5 rounded-full hover:bg-rose-800"
                              >
                                {t('common.confirm')}
                              </button>
                              <button
                                onClick={() => setMemberPendingRemoval(null)}
                                className="px-1.5 py-0.5 rounded-full text-rose-800 hover:bg-rose-100"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setMemberPendingRemoval(member.id)}
                              className={DANGER_ICON_BUTTON}
                              title={t('dashboard.members.remove')}
                              aria-label={t('dashboard.members.remove')}
                            >
                              <span className="material-symbols-outlined text-xl" aria-hidden="true">person_remove</span>
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
            <div className={`${EMPTY_STATE} col-span-full`}>{t('dashboard.members.empty')}</div>
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
                className={`${PRIMARY_BUTTON} px-4 py-2 text-sm`}
              >
                <span className="material-symbols-outlined text-xl" aria-hidden="true">add</span> {t('dashboard.healthChecks.start')}
              </button>
            </div>
          )}

          {healthChecks.length === 0 ? (
            <div className={EMPTY_STATE}>{t('dashboard.healthChecks.empty')}</div>
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
                  <div key={group.templateId} className={`${CARD} mb-6`}>
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 rounded-t-xl">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{group.templateName}</div>
                        <div className="text-xs text-slate-600">
                          {/* `> 1`, not tp: the original rule, under which 0 reads singular. */}
                          {t(group.checks.length > 1 ? 'dashboard.healthChecks.sessionsPlural' : 'dashboard.healthChecks.sessionsSingular', { count: group.checks.length })}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => hasNewer && setHealthCheckOffsets(prev => ({ ...prev, [group.templateId]: Math.max(0, offset - 1) }))}
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition ${hasNewer ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200' : 'text-slate-400 cursor-not-allowed'}`}
                          title={t('dashboard.healthChecks.showNewer')}
                          disabled={!hasNewer}
                          aria-disabled={!hasNewer}
                          aria-label={t('dashboard.healthChecks.showNewer')}
                        >
                          <span className="material-symbols-outlined text-lg">chevron_left</span>
                        </button>
                        <button
                          onClick={() => hasOlder && setHealthCheckOffsets(prev => ({ ...prev, [group.templateId]: offset + 1 }))}
                          className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition ${hasOlder ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200' : 'text-slate-400 cursor-not-allowed'}`}
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
                                    className="block w-full text-xs font-semibold text-slate-900 truncate text-left leading-tight hover:text-indigo-700 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 rounded-sm"
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
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-indigo-700 hover:bg-indigo-50 transition"
                                aria-label={t('dashboard.healthChecks.newAria')}
                              >
                                <span className="material-symbols-outlined text-xl" aria-hidden="true">add</span>
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
                                      <div className="invisible group-hover/info:visible absolute left-full top-0 ml-2 mt-1 bg-white border border-slate-200 text-slate-900 text-xs rounded-xl p-3 shadow-lg w-72 pointer-events-none z-9999">
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
                                            className="h-full motion-safe:transition-all"
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
                                      <div className="invisible group-hover/cell:visible absolute left-1/2 bottom-full mb-2 -translate-x-1/2 bg-white border border-slate-200 text-slate-900 text-xs rounded-xl p-3 shadow-lg pointer-events-none min-w-[200px] z-50">
                                        <div className="space-y-1.5">
                                          {([5, 4, 3, 2, 1] as const).map(rating => {
                                            const count = distribution[rating] || 0;
                                            const percentage = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                                            // The digit's colour is measured, not assumed:
                                            // white failed on all five (utils/healthRatingColors.ts).
                                            const ratingBadge = HEALTH_RATING_BADGE[rating];
                                            const badgeBg = rating === 5 ? 'bg-emerald-100 text-emerald-700' : rating === 4 ? 'bg-emerald-50 text-emerald-700' : rating === 3 ? 'bg-amber-100 text-amber-700' : rating === 2 ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700';
                                            return (
                                              <div key={rating} className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 w-16">
                                                  <span className={`w-5 h-5 rounded-full ${ratingBadge.bg} ${ratingBadge.text} flex items-center justify-center text-xs font-bold`}>
                                                    {rating}
                                                  </span>
                                                  <span className={`px-1.5 py-0.5 rounded-sm text-xs font-bold ${badgeBg}`}>{count}</span>
                                                </div>
                                                <div className="flex-1 bg-slate-200 rounded-full h-2 overflow-hidden">
                                                  <div className={`h-full ${ratingBadge.bg} motion-safe:transition-all`} style={{ width: `${percentage}%` }}></div>
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
                    <div key={hc.id} className={`${LIST_ROW} p-4 sm:p-5 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3`}>
                      <div className="flex items-center grow min-w-0">
                        <div className="w-11 h-11 shrink-0 rounded-xl bg-cyan-50 text-cyan-700 flex items-center justify-center mr-4">
                          <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
                        </div>
                        <div className="grow min-w-0">
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
                                className={`${FIELD_BOX} text-lg font-semibold min-w-0`}
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the rename button it replaces is unmounted by this very click
                                autoFocus
                              />
                              <button
                                onClick={() => handleRenameHealthCheck(hc.id)}
                                className={`${PRIMARY_BUTTON} w-9 h-9 shrink-0`}
                                title={t('common.save')}
                                aria-label={t('dashboard.healthChecks.saveName')}
                              >
                                <span className="material-symbols-outlined text-xl" aria-hidden="true">check</span>
                              </button>
                              <button
                                onClick={() => {
                                  setEditingHealthCheckId(null);
                                  setEditingHealthCheckName('');
                                }}
                                className={ICON_BUTTON}
                                title={t('common.cancel')}
                                aria-label={t('dashboard.healthChecks.cancelRename')}
                              >
                                <span className="material-symbols-outlined text-xl" aria-hidden="true">close</span>
                              </button>
                            </div>
                          ) : (
                            <h3 className="font-semibold text-slate-900 text-lg leading-snug break-words">{hc.name}</h3>
                          )}
                          <div className="mt-1 text-xs text-slate-600 font-medium flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="tabular-nums">{hc.date}</span>
                            <span aria-hidden="true">·</span>
                            <span>{hc.templateName}</span>
                            <span aria-hidden="true">·</span>
                            <span>{tp('dashboard.healthChecks.participants', participantCount)}</span>
                            <span className={`${CHIP} uppercase tracking-wide ${sessionStatusChip(hcStatus)}`}>
                              {t(`dashboard.healthCheckStatus.${hcStatus}`)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-auto shrink-0">
                        {isAdmin && editingHealthCheckId !== hc.id && (
                          <>
                            <button
                              onClick={() => {
                                setEditingHealthCheckId(hc.id);
                                setEditingHealthCheckName(hc.name);
                              }}
                              className={ICON_BUTTON}
                              title={t('dashboard.healthChecks.rename')}
                              aria-label={t('dashboard.healthChecks.rename')}
                            >
                              <span className="material-symbols-outlined text-xl" aria-hidden="true">edit</span>
                            </button>
                            <button
                              onClick={() => setHealthCheckToDelete(hc)}
                              className={DANGER_ICON_BUTTON}
                              title={t('dashboard.deleteHealthCheck.title')}
                              aria-label={t('dashboard.deleteHealthCheck.title')}
                            >
                              <span className="material-symbols-outlined text-xl" aria-hidden="true">delete</span>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => onOpenHealthCheck(hc.id)}
                          className={`${SECONDARY_BUTTON} px-4 py-2 text-sm ml-1`}
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
              <h2 className="text-lg font-bold tracking-tight text-slate-900 mb-3">{t('dashboard.settings.teamSettings')}</h2>
              <div className={`${CARD} p-5 sm:p-6`}>
                {/* Team Name Section */}
                <div className="mb-6 pb-6 border-b border-slate-200">
                  <h3 className={SETTING_TITLE}>
                    <span className={SETTING_ICON} aria-hidden="true">badge</span>
                    {t('dashboard.settings.teamName')}
                  </h3>
                  <p className="text-sm text-slate-600 mb-3">
                    {tRich('dashboard.settings.currentTeamName', {
                      name: <span className="font-semibold text-slate-900">{team.name}</span>
                    })}
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      className={`${FIELD} text-sm`}
                      placeholder={t('dashboard.settings.newTeamNamePlaceholder')}
                    />
                    <button
                      onClick={handleRenameTeam}
                      disabled={!newTeamName.trim()}
                      className={`${PRIMARY_BUTTON} px-4 py-2 text-sm`}
                    >
                      {t('dashboard.settings.renameTeam')}
                    </button>
                    {teamRenameError && (
                      <p className={ERROR_TEXT}>
                        <span className="material-symbols-outlined text-sm! leading-none mr-1" aria-hidden="true">error</span>
                        {noticeText(teamRenameError, t)}
                      </p>
                    )}
                    {teamRenameSuccess && (
                      <p className={SUCCESS_TEXT}>
                        <span className="material-symbols-outlined text-sm! leading-none mr-1" aria-hidden="true">check_circle</span>
                        {noticeText(teamRenameSuccess, t)}
                      </p>
                    )}
                  </div>
                </div>

                {/* The off switch the one-time notice in the retro points at.
                    Team-scoped rather than per-user because it changes what the
                    round asks, not how one person sees it. */}
                <div className="mb-6 pb-6 border-b border-slate-200">
                  <h3 className={SETTING_TITLE}>
                    <span className={SETTING_ICON} aria-hidden="true">insights</span>
                    {t('dashboard.settings.impactTitle')}
                  </h3>
                  <p className="text-sm text-slate-600 mb-3">
                    {t('dashboard.settings.impactDescription')}
                  </p>
                  <label className="flex items-center gap-3 text-sm text-slate-900">
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

                {/* Its own component: it keeps a draft and commits it through the
                    shared email rule, instead of saving every keystroke as typed. */}
                <RecoveryEmailSetting team={team} onRefresh={onRefresh} />

                {/* Password Change Section */}
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <h3 className={SETTING_TITLE}>
                    <span className={SETTING_ICON} aria-hidden="true">lock</span>
                    {t('dashboard.settings.changePassword')}
                  </h3>
                  <p className="text-sm text-slate-600 mb-3">
                    {t('dashboard.settings.changePasswordDescription')}
                  </p>
                  <div className="space-y-3">
                    {needsCurrentPassword && (
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className={`${FIELD} text-sm`}
                        placeholder={t('dashboard.settings.currentPassword')}
                      />
                    )}
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className={`${FIELD} text-sm`}
                      placeholder={t('dashboard.settings.newPassword', { min: PASSWORD_MIN_LENGTH })}
                    />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className={`${FIELD} text-sm`}
                      placeholder={t('dashboard.settings.confirmPassword')}
                    />
                    <button
                      onClick={handleChangePassword}
                      disabled={!newPassword || !confirmPassword}
                      className={`${PRIMARY_BUTTON} px-4 py-2 text-sm`}
                    >
                      {t('dashboard.settings.changePassword')}
                    </button>
                    {passwordChangeError && (
                      <p className={ERROR_TEXT}>
                        <span className="material-symbols-outlined text-sm! leading-none mr-1" aria-hidden="true">error</span>
                        {noticeText(passwordChangeError, t)}
                      </p>
                    )}
                    {passwordChangeSuccess && (
                      <p className={SUCCESS_TEXT}>
                        <span className="material-symbols-outlined text-sm! leading-none mr-1" aria-hidden="true">check_circle</span>
                        {noticeText(passwordChangeSuccess, t)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Settings → Jira, the place every Jira reason line names:
                    the team's one token and where its issues are created. */}
                <JiraTeamSettings team={team} className="mt-6 pt-6 border-t border-slate-200" />
              </div>
            </div>
          )}

          {/* Health Check Templates (Custom Only) */}
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold tracking-tight text-slate-900">{t('dashboard.settings.hcTemplates')}</h2>
              {isAdmin && (
                <button
                  onClick={() => handleOpenTemplateEditor()}
                  className={`${SECONDARY_BUTTON} px-3.5 py-2 text-sm`}
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden="true">add</span> {t('dashboard.settings.createHcTemplate')}
                </button>
              )}
            </div>

            <div className="space-y-3">
              {healthCheckTemplates.filter(tpl => !tpl.isDefault).length === 0 ? (
                <div className={EMPTY_STATE}>
                  <span className="material-symbols-outlined text-4xl text-slate-400 mb-2" aria-hidden="true">dashboard_customize</span>
                  <p className="text-slate-700 font-medium">{t('dashboard.settings.noHcTemplates')}</p>
                  {isAdmin && <p className="text-sm text-slate-600 mt-1">{t('dashboard.settings.noHcTemplatesHint')}</p>}
                </div>
              ) : (
                healthCheckTemplates.filter(tpl => !tpl.isDefault).map(template => (
                  <div key={template.id} className={`${CARD} p-4`}>
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 flex items-center break-words">
                          {template.name}
                        </h3>
                        <p className="text-sm text-slate-600 mt-0.5">{tp('dashboard.settings.dimensionCount', template.dimensions.length)}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 -mr-1.5 -mt-1">
                        <button
                          onClick={() => toggleTemplateDetails(template.id)}
                          className={ICON_BUTTON}
                          title={expandedTemplates.includes(template.id) ? t('dashboard.settings.hideDetails') : t('dashboard.settings.viewDetails')}
                          aria-label={expandedTemplates.includes(template.id) ? t('dashboard.settings.hideDetails') : t('dashboard.settings.viewDetails')}
                        >
                          <span className="material-symbols-outlined" aria-hidden="true">{expandedTemplates.includes(template.id) ? 'expand_less' : 'expand_more'}</span>
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleOpenTemplateEditor(template)}
                              className={ICON_BUTTON}
                              title={t('dashboard.settings.editTemplate')}
                              aria-label={t('dashboard.settings.editTemplate')}
                            >
                              <span className="material-symbols-outlined text-xl" aria-hidden="true">edit</span>
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(template.id)}
                              className={DANGER_ICON_BUTTON}
                              title={t('dashboard.settings.deleteTemplate')}
                              aria-label={t('dashboard.settings.deleteTemplate')}
                            >
                              <span className="material-symbols-outlined text-xl" aria-hidden="true">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {template.dimensions.slice(0, 5).map(dim => (
                        <span key={dim.id} className={`${CHIP} bg-slate-100 text-slate-700`}>
                          {dim.name}
                        </span>
                      ))}
                      {template.dimensions.length > 5 && (
                        <span className="text-xs text-slate-600 self-center">{t('dashboard.settings.moreDimensions', { count: template.dimensions.length - 5 })}</span>
                      )}
                    </div>

                    {expandedTemplates.includes(template.id) && (
                      <div className="mt-4 space-y-2">
                        {template.dimensions.map(dim => (
                          <div key={dim.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                            <div className="font-semibold text-slate-900 text-sm">{dim.name}</div>
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
              <h2 className="text-lg font-bold tracking-tight text-slate-900">{t('dashboard.settings.retroTemplates')}</h2>
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
                  className={`${SECONDARY_BUTTON} px-3.5 py-2 text-sm`}
                >
                  <span className="material-symbols-outlined text-xl" aria-hidden="true">add</span> {t('dashboard.retroTemplate.title')}
                </button>
              )}
            </div>
            <div className="space-y-3">
              {(!team.customTemplates || team.customTemplates.length === 0) ? (
                <div className={EMPTY_STATE}>
                  <span className="material-symbols-outlined text-4xl text-slate-400 mb-2" aria-hidden="true">view_column</span>
                  <p className="text-slate-700 font-medium">{t('dashboard.settings.noRetroTemplates')}</p>
                  {isAdmin && <p className="text-sm text-slate-600 mt-1">{t('dashboard.settings.noRetroTemplatesHint')}</p>}
                </div>
              ) : (
                team.customTemplates.map((template, idx) => (
                  <div key={idx} className={`${CARD} p-4`}>
                    <div className="flex justify-between items-start gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-slate-900 break-words">{template.name}</h3>
                        <p className="text-sm text-slate-600 mt-0.5">{tp('dashboard.settings.columnCount', template.cols.length)}</p>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => {
                            // This one template, never a list: the clicked row
                            // (its position, guarded by its name) goes to
                            // POST /template/delete as its content. Sending
                            // this tab's whole team let a stale tab overwrite
                            // the retros and actions stored since, and sending
                            // the template list alone still erased every
                            // template saved elsewhere since (incident ISS).
                            dataService.deleteCustomTemplate(team.id, idx, template.name);
                            onRefresh();
                          }}
                          className={`${DANGER_ICON_BUTTON} -mr-1.5 -mt-1`}
                          title={t('dashboard.settings.deleteTemplate')}
                          aria-label={t('dashboard.settings.deleteTemplate')}
                        >
                          <span className="material-symbols-outlined text-xl" aria-hidden="true">delete</span>
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
          getSessionToken={dataService.getSessionToken}
          currentUserId={currentUser.id}
          currentUserName={currentUser.name}
          onSubmitFeedback={async (feedback): Promise<FeedbackSubmitResult> => {
            // The answer goes back to the form, which keeps the draft unless the
            // feedback was stored (services/feedbackSubmission.ts).
            const result = await submitTeamFeedback({
              teamId: team.id,
              password: dataService.getAuthenticatedPassword(),
              sessionToken: dataService.getSessionToken(),
              // Decision D3b: read again when that token is refused as
              // revoked and another tab's newer one was adopted meanwhile.
              getSessionToken: dataService.getSessionToken,
              feedback
            });
            if (result === 'sent') onRefresh();
            return result;
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
