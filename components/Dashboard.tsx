
import React, { useState, useMemo, useEffect } from 'react';
import { Team, User, RetroSession, Column, HealthCheckSession, HealthCheckTemplate, HealthCheckDimension, TeamFeedback as TeamFeedbackType } from '../types';
import { dataService } from '../services/dataService';
import { ColorPicker } from './ColorPicker';
import { IconPicker } from './IconPicker';
import TeamFeedback from './TeamFeedback';
import DashboardActionsTab from './dashboard/DashboardActionsTab';
import DashboardTabs, { DashboardTab } from './dashboard/DashboardTabs';
import { getSuggestedName } from './dashboard/dashboardUtils';
import { groupHealthChecksByTemplate } from './dashboard/healthCheckUtils';

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
  const [memberEditError, setMemberEditError] = useState('');
  const [editingRetroId, setEditingRetroId] = useState<string | null>(null);
  const [editingRetroName, setEditingRetroName] = useState('');
  const [editingHealthCheckId, setEditingHealthCheckId] = useState<string | null>(null);
  const [editingHealthCheckName, setEditingHealthCheckName] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

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
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordChangeError, setPasswordChangeError] = useState('');
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState('');

  // Settings State - Team Rename
  const [newTeamName, setNewTeamName] = useState('');
  const [teamRenameError, setTeamRenameError] = useState('');
  const [teamRenameSuccess, setTeamRenameSuccess] = useState('');

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

  // Action Creation State
  const [newActionText, setNewActionText] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState<string>('');

  // Custom Template State in Modal
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customCols, setCustomCols] = useState<Column[]>([
      {id: '1', title: 'Start', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#10B981'},
      {id: '2', title: 'Stop', color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#F43F5E'}
  ]);
  const [templateName, setTemplateName] = useState('');
  const [retroName, setRetroName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showRetroTemplateBuilder, setShowRetroTemplateBuilder] = useState(false);
  const [retroTemplateName, setRetroTemplateName] = useState('');
  const [retroTemplateCols, setRetroTemplateCols] = useState<Column[]>([
    {id: '1', title: 'Column 1', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200', customColor: '#10B981'},
    {id: '2', title: 'Column 2', color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200', customColor: '#F43F5E'}
  ]);
  const [colorPickerOpen, setColorPickerOpen] = useState<string | null>(null); // Column ID with open color picker
  const [iconPickerOpen, setIconPickerOpen] = useState<string | null>(null); // Column ID with open icon picker

  const archivedMembers = team.archivedMembers || [];
  const knownMembers = [...team.members, ...archivedMembers];

  // Combine global actions, retro actions, and health check actions
  const allActions = [
      ...team.globalActions.map(a => ({...a, originRetro: 'Dashboard', contextText: ''})),
      ...team.retrospectives.flatMap(r => r.actions
        .filter(a => a.type !== 'proposal')
        .map(a => {
          let contextText = '';
          if (a.linkedTicketId) {
              const t = r.tickets.find(x => x.id === a.linkedTicketId);
              if(t) contextText = t.text;
              else {
                  const g = r.groups.find(x => x.id === a.linkedTicketId);
                  if(g) contextText = `Group: ${g.title}`;
              }
          }
          return {...a, originRetro: r.name, contextText };
      })),
      ...(team.healthChecks || []).flatMap(hc => hc.actions
        .filter(a => a.type !== 'proposal')
        .map(a => ({...a, originRetro: hc.name, contextText: '' })))
  ];

  const filteredActions = allActions.filter(a => {
      if(actionFilter === 'OPEN') return !a.done;
      if(actionFilter === 'CLOSED') return a.done;
      return true;
  });

  const handleOpenNewRetroModal = () => {
    // Generate default name
    const defaultName = getSuggestedName(
      team.retrospectives[0]?.name,
      `Retrospective ${new Date().toLocaleDateString()}`
    );
    setRetroName(defaultName);
    setIsAnonymous(false);
    setShowNewRetroModal(true);
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
    setMemberEditError('');
  };

  const handleCancelMemberEdit = () => {
    setEditingMemberId(null);
    setEditingMemberName('');
    setEditingMemberEmail('');
    setMemberEditError('');
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
      setMemberEditError(err.message || 'Unable to update member');
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
    const finalName = retroName.trim() || `Retrospective ${new Date().toLocaleDateString()}`;
    const session = dataService.createSession(team.id, finalName, safeCols, { isAnonymous });
    
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
      `Health Check ${new Date().toLocaleDateString()}`
    );
    setHealthCheckName(defaultName);
    setSelectedTemplateId(preselectedTemplateId || healthCheckTemplates[0]?.id || '');
    setIsHealthCheckAnonymous(false);
    setShowNewHealthCheckModal(true);
  };

  const handleStartHealthCheck = () => {
    if (!selectedTemplateId) return;
    const finalName = healthCheckName.trim() || `Health Check ${new Date().toLocaleDateString()}`;
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
  const handleChangePassword = () => {
    setPasswordChangeError('');
    setPasswordChangeSuccess('');

    if (newPassword.length < 4) {
      setPasswordChangeError('Password must be at least 4 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordChangeError('Passwords do not match');
      return;
    }

    try {
      dataService.changeTeamPassword(team.id, newPassword);
      setPasswordChangeSuccess('Password changed successfully');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPasswordChangeSuccess(''), 3000);
    } catch (err: any) {
      setPasswordChangeError(err.message || 'Failed to change password');
    }
  };

  // Settings Handlers - Team Rename
  const handleRenameTeam = () => {
    setTeamRenameError('');
    setTeamRenameSuccess('');

    if (!newTeamName.trim()) {
      setTeamRenameError('Team name cannot be empty');
      return;
    }

    if (newTeamName.trim() === team.name) {
      setTeamRenameError('New name is the same as current name');
      return;
    }

    try {
      dataService.renameTeam(team.id, newTeamName.trim());
      setTeamRenameSuccess('Team renamed successfully');
      setNewTeamName('');
      onRefresh();
      setTimeout(() => setTeamRenameSuccess(''), 3000);
    } catch (err: any) {
      setTeamRenameError(err.message || 'Failed to rename team');
    }
  };

  const addDimension = () => {
    setNewTemplateDimensions([...newTemplateDimensions, {
      id: Math.random().toString(36).substr(2, 9),
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
    if (score >= 3.5) return 'text-emerald-600';
    if (score >= 2.5) return 'text-amber-600';
    if (score >= 1.5) return 'text-orange-600';
    return 'text-rose-600';
  };

  return (
    <div id="main-scroller" className="flex-grow container mx-auto p-6 max-w-6xl overflow-y-auto">
      {/* Delete Team Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">warning</span>
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Delete Team</h2>
              <p className="text-slate-500 text-sm">
                This action is <strong className="text-red-600">irreversible</strong>. All retrospectives,
                actions, and team data will be permanently deleted.
              </p>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-red-700 mb-3">
                To confirm deletion, type the team name: <strong>{team.name}</strong>
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="Type team name here"
                className="w-full border border-red-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                autoFocus
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => { setShowDeleteModal(false); setDeleteConfirmText(''); }}
                className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-lg font-bold hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTeam}
                disabled={deleteConfirmText !== team.name}
                className="flex-1 bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                Delete Team
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Retro Confirmation */}
      {retroToDelete && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">archive</span>
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Delete retrospective</h2>
              <p className="text-slate-500 text-sm">
                Actions from <strong>{retroToDelete.name}</strong> will be kept in the global backlog.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setRetroToDelete(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-lg font-bold hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteRetro}
                className="flex-1 bg-amber-500 text-white py-3 rounded-lg font-bold hover:bg-amber-600 transition"
              >
                Delete retro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Retro Modal */}
      {showNewRetroModal && (
          <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-2xl font-bold text-slate-800">Start New Retrospective</h2>
                      <button onClick={() => setShowNewRetroModal(false)} className="text-slate-400 hover:text-slate-600"><span className="material-symbols-outlined">close</span></button>
                  </div>
                  
                  <div className="mb-6">
                      <label className="block text-sm font-bold text-slate-700 mb-1">Session Name</label>
                      <input 
                        type="text" 
                        value={retroName} 
                        onChange={(e) => setRetroName(e.target.value)} 
                        className="w-full border border-slate-300 rounded p-2 bg-white text-slate-900 font-medium"
                      />
                  </div>
                  
                  {!isCreatingCustom ? (
                      <div className="space-y-6">
                        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                          <div>
                            <div className="text-sm font-bold text-slate-700">Anonymous mode</div>
                            <p className="text-xs text-slate-500">Hide author names on tickets for this retro.</p>
                          </div>
                          <button
                            onClick={() => setIsAnonymous(!isAnonymous)}
                            className={`w-12 h-6 rounded-full relative transition ${isAnonymous ? 'bg-indigo-600' : 'bg-slate-300'}`}
                            aria-label="Toggle anonymous mode"
                          >
                            <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition ${isAnonymous ? 'translate-x-6' : ''}`}></span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-80 overflow-y-auto pr-2">
                            <button onClick={() => handleStartRetro(dataService.getPresets()['start_stop_continue'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Start, Stop, Continue</div>
                                <p className="text-xs text-slate-500">The classic format.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['4l'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">4 L's</div>
                                <p className="text-xs text-slate-500">Liked, Learned, Lacked, Longed For.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['mad_sad_glad'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Mad / Sad / Glad</div>
                                <p className="text-xs text-slate-500">Capture the full range of feelings.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['sailboat'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Sailboat</div>
                                <p className="text-xs text-slate-500">Wind, anchors, rocks, and goals.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['went_well'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">What Went Well</div>
                                <p className="text-xs text-slate-500">Well, not well, try next, puzzles.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['kalm'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">KALM</div>
                                <p className="text-xs text-slate-500">Keep, Add, Less, More.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['daki'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">DAKI</div>
                                <p className="text-xs text-slate-500">Drop, Add, Keep, Improve.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['starfish'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Starfish</div>
                                <p className="text-xs text-slate-500">Stop, Less, Keep, More, Start.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['rose_thorn_bud'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Rose, Thorn, Bud</div>
                                <p className="text-xs text-slate-500">Positives, challenges, potential.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['hot_air_balloon'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Hot Air Balloon</div>
                                <p className="text-xs text-slate-500">Fire, sandbags, storms, sunny skies.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['speed_car'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Speed Car</div>
                                <p className="text-xs text-slate-500">Engine, parachute, abyss, bridge.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['lean_coffee'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Lean Coffee</div>
                                <p className="text-xs text-slate-500">To discuss, discussing, discussed.</p>
                            </button>
                            <button onClick={() => handleStartRetro(dataService.getPresets()['three_little_pigs'])} className="p-4 border border-slate-200 rounded-xl hover:border-retro-primary hover:bg-indigo-50 transition text-left group">
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Three Little Pigs</div>
                                <p className="text-xs text-slate-500">Straw, stick, brick houses, wolf.</p>
                            </button>
                        </div>

                        {team.customTemplates.length > 0 && (
                            <div>
                                <h3 className="text-sm font-bold text-slate-400 uppercase mb-3">Saved Templates</h3>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    {team.customTemplates.map((t, idx) => (
                                        <button key={idx} onClick={() => handleStartRetro(t.cols)} className="p-3 border border-slate-200 rounded-lg hover:border-retro-primary hover:bg-indigo-50 text-sm font-bold text-slate-700">
                                            {t.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="border-t border-slate-100 pt-4 text-center">
                            <button onClick={() => setIsCreatingCustom(true)} className="text-retro-primary font-bold hover:underline flex items-center justify-center w-full py-2">
                                <span className="material-symbols-outlined mr-2">edit</span> Create Custom Template
                            </button>
                        </div>
                      </div>
                  ) : (
                      <div className="space-y-4">
                          <div>
                              <label className="block text-sm font-bold text-slate-700 mb-1">Template Name (Optional, to save)</label>
                              <input 
                                value={templateName}
                                onChange={(e) => setTemplateName(e.target.value)}
                                className="w-full border border-slate-300 rounded p-2 bg-white text-slate-900"
                                placeholder="e.g. Sprint Review Special"
                              />
                          </div>
                          <div>
                              <label className="block text-sm font-bold text-slate-700 mb-2">Columns</label>
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
                                          title="Pick icon"
                                        >
                                          <span
                                            className="material-symbols-outlined text-xl"
                                            style={{ color: c.customColor || '#64748B' }}
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
                                          title="Pick color"
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
                                        className="flex-grow border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                                        placeholder={`Column ${idx + 1}`}
                                      />
                                      {customCols.length > 2 && (
                                        <button
                                          onClick={() => {
                                            setCustomCols(customCols.filter((_, i) => i !== idx));
                                            if (colorPickerOpen === c.id) setColorPickerOpen(null);
                                            if (iconPickerOpen === c.id) setIconPickerOpen(null);
                                          }}
                                          className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded transition-colors"
                                        >
                                          <span className="material-symbols-outlined">delete</span>
                                        </button>
                                      )}
                                  </div>
                              ))}
                              <button
                                onClick={() => setCustomCols([...customCols, {id: Math.random().toString(), title: '', color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#64748B'}])}
                                className="text-sm font-bold text-indigo-600 hover:underline flex items-center gap-1"
                              >
                                <span className="material-symbols-outlined text-lg">add</span>
                                Add Column
                              </button>
                          </div>
                          <div className="flex justify-between pt-4 border-t border-slate-100 mt-4">
                              <button onClick={() => setIsCreatingCustom(false)} className="text-slate-500">Back</button>
                              <button onClick={() => handleStartRetro(customCols)} className="bg-retro-primary text-white px-6 py-2 rounded-lg font-bold hover:bg-retro-primaryHover">Start Retro</button>
                          </div>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* New Health Check Modal */}
      {showNewHealthCheckModal && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-800">Start Health Check</h2>
              <button onClick={() => setShowNewHealthCheckModal(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Session Name</label>
                <input
                  type="text"
                  value={healthCheckName}
                  onChange={(e) => setHealthCheckName(e.target.value)}
                  className="w-full border border-slate-300 rounded p-2 bg-white text-slate-900 font-medium"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Template</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => setSelectedTemplateId(e.target.value)}
                  className="w-full border border-slate-300 rounded p-2 bg-white text-slate-900"
                >
                  {healthCheckTemplates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.dimensions.length} dimensions)</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <div className="text-sm font-bold text-slate-700">Anonymous mode</div>
                  <p className="text-xs text-slate-500">Hide participant names during the session.</p>
                </div>
                <button
                  onClick={() => setIsHealthCheckAnonymous(!isHealthCheckAnonymous)}
                  className={`w-12 h-6 rounded-full relative transition ${isHealthCheckAnonymous ? 'bg-indigo-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition ${isHealthCheckAnonymous ? 'translate-x-6' : ''}`}></span>
                </button>
              </div>

              <button
                onClick={handleStartHealthCheck}
                disabled={!selectedTemplateId}
                className="w-full bg-cyan-600 text-white py-3 rounded-lg font-bold hover:bg-cyan-700 disabled:opacity-50 transition"
              >
                Start Health Check
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Health Check Confirmation */}
      {healthCheckToDelete && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-3xl">archive</span>
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-2">Delete health check</h2>
              <p className="text-slate-500 text-sm">
                Actions from <strong>{healthCheckToDelete.name}</strong> will be kept in the global backlog.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setHealthCheckToDelete(null)}
                className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-lg font-bold hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteHealthCheck}
                className="flex-1 bg-amber-500 text-white py-3 rounded-lg font-bold hover:bg-amber-600 transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Editor Modal */}
      {showTemplateEditor && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-800">
                {editingTemplate ? 'Edit Template' : 'Create Template'}
              </h2>
              <button onClick={() => setShowTemplateEditor(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Template Name</label>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="e.g., Team Wellness Check"
                  className="w-full border border-slate-300 rounded p-2 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Dimensions</label>
                <div className="space-y-4">
                  {newTemplateDimensions.map((dim, idx) => (
                    <div key={dim.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                      <div className="flex justify-between items-start mb-3">
                        <span className="text-xs font-bold text-slate-400">Dimension {idx + 1}</span>
                        {newTemplateDimensions.length > 1 && (
                          <button onClick={() => removeDimension(idx)} className="text-red-500 hover:text-red-700">
                            <span className="material-symbols-outlined text-sm">delete</span>
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        placeholder="Dimension name"
                        value={dim.name}
                        onChange={(e) => updateDimension(idx, 'name', e.target.value)}
                        className="w-full border border-slate-300 rounded p-2 mb-2 bg-white text-slate-900 font-medium"
                      />
                      <textarea
                        placeholder="Good description (what it looks like when things are good)"
                        value={dim.goodDescription}
                        onChange={(e) => updateDimension(idx, 'goodDescription', e.target.value)}
                        className="w-full border border-slate-300 rounded p-2 mb-2 bg-white text-slate-900 text-sm resize-none h-16"
                      />
                      <textarea
                        placeholder="Bad description (what it looks like when things are bad)"
                        value={dim.badDescription}
                        onChange={(e) => updateDimension(idx, 'badDescription', e.target.value)}
                        className="w-full border border-slate-300 rounded p-2 bg-white text-slate-900 text-sm resize-none h-16"
                      />
                    </div>
                  ))}
                </div>
                <button
                  onClick={addDimension}
                  className="mt-3 text-sm font-bold text-indigo-600 hover:underline flex items-center"
                >
                  <span className="material-symbols-outlined mr-1 text-sm">add</span>
                  Add Dimension
                </button>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  onClick={() => setShowTemplateEditor(false)}
                  className="px-4 py-2 text-slate-500 hover:text-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={!newTemplateName.trim() || newTemplateDimensions.every(d => !d.name.trim())}
                  className="bg-indigo-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-indigo-700 disabled:opacity-50"
                >
                  Save Template
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRetroTemplateBuilder && (
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-slate-800">Create Retro Template</h2>
              <button onClick={() => setShowRetroTemplateBuilder(false)} className="text-slate-400 hover:text-slate-600">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Template Name</label>
                <input
                  type="text"
                  value={retroTemplateName}
                  onChange={(e) => setRetroTemplateName(e.target.value)}
                  placeholder="e.g. Sprint Review Special"
                  className="w-full border border-slate-300 rounded p-2 bg-white text-slate-900"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Columns</label>
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
                          title="Pick icon"
                        >
                          <span
                            className="material-symbols-outlined text-2xl"
                            style={{ color: c.customColor || '#64748B' }}
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
                          title="Pick color"
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
                        className="flex-grow border border-slate-300 rounded-lg p-2 text-sm bg-white text-slate-900 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
                        placeholder={`Column ${idx + 1}`}
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
                          className="text-red-500 hover:text-red-700 p-2 hover:bg-red-50 rounded transition-colors"
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
                      id: Math.random().toString(),
                      title: `Column ${retroTemplateCols.length + 1}`,
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
                  Add Column
                </button>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button onClick={() => setShowRetroTemplateBuilder(false)} className="px-4 py-2 rounded border border-slate-200 text-slate-600">Cancel</button>
                <button onClick={handleSaveRetroTemplate} className="px-4 py-2 rounded bg-retro-primary text-white font-bold hover:bg-retro-primaryHover">Save Template</button>
              </div>
            </div>
          </div>
        </div>
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
            <h1 className="text-3xl font-bold text-slate-800">{team.name} Dashboard</h1>
            <p className="text-slate-500">Manage actions and track team progress.</p>
          </div>
          {isAdmin && (
            <div className="flex gap-2 mt-4 md:mt-0">
                <button onClick={handleOpenNewRetroModal} className="bg-retro-primary text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-retro-primaryHover shadow-lg transition">
                    <span className="material-symbols-outlined mr-2">add</span> New Retrospective
                </button>
                <button
                    onClick={() => setShowDeleteModal(true)}
                    className="bg-white border border-red-300 text-red-600 px-3 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-red-50 hover:border-red-400 shadow-sm transition"
                    title="Delete Team"
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
              {team.retrospectives.length === 0 ? (
                  <div className="text-center text-slate-400 py-10">No retrospectives yet. Start one!</div>
              ) : (
                  team.retrospectives.map(retro => (
                    <div key={retro.id} className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between mb-3 hover:shadow-md transition">
                        <div className="flex items-center flex-grow">
                            <div className="w-12 h-12 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center mr-4">
                                <span className="material-symbols-outlined">event_note</span>
                            </div>
                            <div className="flex-grow">
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
                                            className="border border-indigo-500 rounded px-2 py-1 text-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-200"
                                            autoFocus
                                        />
                                        <button
                                            onClick={() => handleRenameRetro(retro.id)}
                                            className="p-1.5 text-white bg-indigo-600 hover:bg-indigo-700 rounded"
                                            title="Save"
                                        >
                                            <span className="material-symbols-outlined text-base">check</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setEditingRetroId(null);
                                                setEditingRetroName('');
                                            }}
                                            className="p-1.5 text-slate-600 hover:text-slate-800 rounded"
                                            title="Cancel"
                                        >
                                            <span className="material-symbols-outlined text-base">close</span>
                                        </button>
                                    </div>
                                ) : (
                                    <h3 className="font-bold text-slate-800 text-lg">{retro.name}</h3>
                                )}
                                <div className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2">
                                    <span>{retro.date}</span> •
                                    <span className={retro.status === 'IN_PROGRESS' ? 'text-green-600' : 'text-slate-400'}>
                                        {retro.status.replace('_', ' ')}
                                    </span>
                                </div>
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
                                  className="p-2 text-slate-400 hover:text-indigo-600 border border-transparent hover:border-indigo-200 rounded"
                                  title="Rename retrospective"
                                >
                                  <span className="material-symbols-outlined">edit</span>
                                </button>
                                <button
                                  onClick={() => setRetroToDelete(retro)}
                                  className="p-2 text-slate-400 hover:text-amber-600 border border-transparent hover:border-amber-200 rounded"
                                  title="Delete retrospective"
                                >
                                  <span className="material-symbols-outlined">delete</span>
                                </button>
                              </>
                            )}
                            <button
                                onClick={() => onOpenSession(retro.id)}
                                className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded font-bold text-sm hover:border-retro-primary hover:text-retro-primary transition"
                            >
                                {retro.status === 'IN_PROGRESS' ? 'Resume' : 'View Summary'}
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
            <div key={member.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${member.color} text-white flex items-center justify-center font-bold uppercase`}>
                {member.name.substring(0, 2)}
              </div>
              <div className="flex flex-col flex-1">
                {editingMemberId === member.id ? (
                  <div className="space-y-2">
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Name</label>
                      <input
                        type="text"
                        value={editingMemberName}
                        onChange={(e) => setEditingMemberName(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1">Email</label>
                      <input
                        type="email"
                        value={editingMemberEmail}
                        onChange={(e) => setEditingMemberEmail(e.target.value)}
                        placeholder="email@example.com"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-800 focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100 outline-none"
                      />
                    </div>
                    {memberEditError && (
                      <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded px-2 py-1">
                        {memberEditError}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <span className="text-sm font-bold text-slate-800">{member.name}</span>
                    <span className="text-[11px] uppercase tracking-wide text-slate-400">{member.role}</span>
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
                        className="text-emerald-600 hover:text-emerald-700"
                        title="Save member"
                      >
                        <span className="material-symbols-outlined">check_circle</span>
                      </button>
                      <button
                        onClick={handleCancelMemberEdit}
                        className="text-slate-400 hover:text-slate-600"
                        title="Cancel edit"
                      >
                        <span className="material-symbols-outlined">cancel</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => handleStartMemberEdit(member)}
                        className="text-slate-300 hover:text-indigo-500"
                        title="Edit member"
                      >
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      {member.id !== currentUser.id && (
                        <>
                          {memberPendingRemoval === member.id ? (
                            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-full px-3 py-1 text-xs font-semibold text-red-700">
                              <span>Remove?</span>
                              <button
                                onClick={() => handleRemoveMember(member.id)}
                                className="bg-red-600 text-white px-2 py-0.5 rounded-full hover:bg-red-700"
                              >
                                Confirm
                              </button>
                              <button
                                onClick={() => setMemberPendingRemoval(null)}
                                className="text-red-600 hover:text-red-700"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setMemberPendingRemoval(member.id)}
                              className="text-slate-300 hover:text-red-500"
                              title="Remove member"
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
            <div className="text-center text-slate-400 py-10 col-span-full">No members yet.</div>
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
                <span className="material-symbols-outlined mr-2">add</span> START HEALTH CHECK
              </button>
            </div>
          )}

          {healthChecks.length === 0 ? (
            <div className="text-center text-slate-400 py-10">No health checks yet. Start one to track team health over time!</div>
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
                  <div key={group.templateId} className="bg-white border border-slate-200 rounded-xl shadow-sm mb-6">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                      <div>
                        <div className="text-sm font-bold text-slate-700">{group.templateName}</div>
                        <div className="text-xs text-slate-500">{group.checks.length} session{group.checks.length > 1 ? 's' : ''}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => hasNewer && setHealthCheckOffsets(prev => ({ ...prev, [group.templateId]: Math.max(0, offset - 1) }))}
                          className={`p-1 rounded transition ${hasNewer ? 'text-slate-500 hover:text-cyan-600 hover:bg-cyan-50' : 'text-slate-300 cursor-not-allowed'}`}
                          title="Show newer"
                          disabled={!hasNewer}
                          aria-disabled={!hasNewer}
                        >
                          <span className="material-symbols-outlined text-lg">chevron_left</span>
                        </button>
                        <button
                          onClick={() => hasOlder && setHealthCheckOffsets(prev => ({ ...prev, [group.templateId]: offset + 1 }))}
                          className={`p-1 rounded transition ${hasOlder ? 'text-slate-500 hover:text-cyan-600 hover:bg-cyan-50' : 'text-slate-300 cursor-not-allowed'}`}
                          title="Show older"
                          disabled={!hasOlder}
                          aria-disabled={!hasOlder}
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
                              Dimension
                            </th>
                            {visibleChecks.map((hc) => {
                              const participantCount = Object.keys(hc.ratings).length;
                              return (
                                <th key={hc.id} className="px-3 py-2 text-left w-24">
                                  <button
                                    type="button"
                                    onClick={() => onOpenHealthCheck(hc.id)}
                                    className="block w-full text-xs font-bold text-slate-700 truncate text-left leading-tight hover:text-cyan-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 rounded"
                                    title={`Open ${hc.name}`}
                                  >
                                    {hc.name}
                                  </button>
                                  <div className="text-[9px] text-slate-400">{hc.date}</div>
                                  <div className="text-[9px] text-slate-400">
                                    <span className="material-symbols-outlined text-[10px] align-middle">people</span> {participantCount}
                                  </div>
                                </th>
                              );
                            })}
                            <th className="px-3 py-2 text-left w-16">
                              <button
                                onClick={() => handleOpenNewHealthCheckModal(group.templateId)}
                                className="text-cyan-600 hover:text-cyan-700 flex flex-col items-start justify-center w-full"
                              >
                                <span className="material-symbols-outlined text-xl">add</span>
                              </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dimensions.map((dim) => (
                            <tr key={dim.id} className="border-b border-slate-200 relative z-0 hover:z-[9999]">
                              <td className="px-3 py-2 text-xs font-medium text-slate-700 sticky left-0 bg-white border-r border-slate-200 w-48 z-30">
                                <div className="flex items-center gap-1">
                                  <span className="truncate" title={dim.name}>{dim.name}</span>
                                  {(dim.goodDescription || dim.badDescription) && (
                                    <div className="relative inline-block group/info">
                                      <span className="material-symbols-outlined text-xs text-slate-400 cursor-help hover:text-slate-600">info</span>
                                      <div className="invisible group-hover/info:visible absolute left-full top-0 ml-2 mt-1 bg-white border-2 border-slate-300 text-slate-800 text-xs rounded-lg p-3 shadow-2xl w-72 pointer-events-none z-[9999]">
                                        {dim.goodDescription && (
                                          <div className="mb-2 bg-emerald-50 border border-emerald-200 rounded-lg p-2">
                                            <div className="font-bold text-emerald-700 mb-1">Good</div>
                                            <div className="text-slate-700">{dim.goodDescription}</div>
                                          </div>
                                        )}
                                        {dim.badDescription && (
                                          <div className="bg-rose-50 border border-rose-200 rounded-lg p-2">
                                            <div className="font-bold text-rose-700 mb-1">Bad</div>
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
                                  return <td key={hc.id} className="px-3 py-2 text-center text-slate-400 text-xs border-r border-slate-200 w-24">-</td>;
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
                                    <div className="relative w-full h-8 rounded overflow-hidden border border-slate-300 flex items-center justify-center">
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
                                          {score.toFixed(1)}
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
                                            const badgeBg = rating === 5 ? 'bg-emerald-100 text-emerald-700' : rating === 4 ? 'bg-emerald-50 text-emerald-600' : rating === 3 ? 'bg-amber-100 text-amber-700' : rating === 2 ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700';
                                            return (
                                              <div key={rating} className="flex items-center gap-2">
                                                <div className="flex items-center gap-1 w-16">
                                                  <span className={`w-5 h-5 rounded-full ${bgColor} text-white flex items-center justify-center text-xs font-bold`}>
                                                    {rating}
                                                  </span>
                                                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${badgeBg}`}>{count}</span>
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
                  return (
                    <div key={hc.id} className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between hover:shadow-md transition">
                      <div className="flex items-center flex-grow">
                        <div className="w-12 h-12 rounded bg-cyan-50 text-cyan-600 flex items-center justify-center mr-4">
                          <span className="material-symbols-outlined">monitoring</span>
                        </div>
                        <div className="flex-grow">
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
                                className="border border-cyan-500 rounded px-2 py-1 text-lg font-bold text-slate-800 outline-none focus:ring-2 focus:ring-cyan-200"
                                autoFocus
                              />
                              <button
                                onClick={() => handleRenameHealthCheck(hc.id)}
                                className="p-1.5 text-white bg-cyan-600 hover:bg-cyan-700 rounded"
                                title="Save"
                              >
                                <span className="material-symbols-outlined text-base">check</span>
                              </button>
                              <button
                                onClick={() => {
                                  setEditingHealthCheckId(null);
                                  setEditingHealthCheckName('');
                                }}
                                className="p-1.5 text-slate-600 hover:text-slate-800 rounded"
                                title="Cancel"
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
                            <span>{participantCount} participants</span> •
                            <span className={hc.status === 'IN_PROGRESS' ? 'text-green-600' : 'text-slate-400'}>
                              {hc.status.replace('_', ' ')}
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
                              className="p-2 text-slate-400 hover:text-cyan-600 border border-transparent hover:border-cyan-200 rounded"
                              title="Rename health check"
                            >
                              <span className="material-symbols-outlined">edit</span>
                            </button>
                            <button
                              onClick={() => setHealthCheckToDelete(hc)}
                              className="p-2 text-slate-400 hover:text-amber-600 border border-transparent hover:border-amber-200 rounded"
                              title="Delete health check"
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => onOpenHealthCheck(hc.id)}
                          className="bg-white border border-slate-200 text-slate-600 px-4 py-2 rounded font-bold text-sm hover:border-cyan-500 hover:text-cyan-600 transition"
                        >
                          {hc.status === 'IN_PROGRESS' ? 'Resume' : 'View Results'}
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
              <h2 className="text-xl font-bold text-slate-800 mb-4">Team Settings</h2>
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                {/* Team Name Section */}
                <div className="mb-6 pb-6 border-b border-slate-200">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center">
                    <span className="material-symbols-outlined mr-2 text-slate-500">badge</span>
                    Team Name
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    Current team name: <span className="font-semibold text-slate-700">{team.name}</span>
                  </p>
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={newTeamName}
                      onChange={(e) => setNewTeamName(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                      placeholder="Enter new team name"
                    />
                    <button
                      onClick={handleRenameTeam}
                      disabled={!newTeamName.trim()}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Rename Team
                    </button>
                    {teamRenameError && (
                      <p className="text-xs text-red-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">error</span>
                        {teamRenameError}
                      </p>
                    )}
                    {teamRenameSuccess && (
                      <p className="text-xs text-green-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">check_circle</span>
                        {teamRenameSuccess}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center">
                    <span className="material-symbols-outlined mr-2 text-slate-500">email</span>
                    Recovery Email
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    This email will be used to recover your password if forgotten. It is separate from participant emails.
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
                      placeholder="facilitator@example.com"
                    />
                  </div>
                  {!team.facilitatorEmail && (
                    <p className="text-xs text-amber-600 mt-2 flex items-center">
                      <span className="material-symbols-outlined text-xs mr-1">warning</span>
                      No email configured - you won't be able to recover your password
                    </p>
                  )}
                </div>

                {/* Password Change Section */}
                <div className="mt-6 pt-6 border-t border-slate-200">
                  <h3 className="font-bold text-slate-700 mb-2 flex items-center">
                    <span className="material-symbols-outlined mr-2 text-slate-500">lock</span>
                    Change Password
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    Change the team password. All members will need to use the new password to log in.
                  </p>
                  <div className="space-y-3">
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                      placeholder="New password (min 4 characters)"
                    />
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg p-2 text-sm"
                      placeholder="Confirm new password"
                    />
                    <button
                      onClick={handleChangePassword}
                      disabled={!newPassword || !confirmPassword}
                      className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Change Password
                    </button>
                    {passwordChangeError && (
                      <p className="text-xs text-red-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">error</span>
                        {passwordChangeError}
                      </p>
                    )}
                    {passwordChangeSuccess && (
                      <p className="text-xs text-green-600 flex items-center">
                        <span className="material-symbols-outlined text-xs mr-1">check_circle</span>
                        {passwordChangeSuccess}
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
              <h2 className="text-xl font-bold text-slate-800">Health Check Templates</h2>
              {isAdmin && (
                <button
                  onClick={() => handleOpenTemplateEditor()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-indigo-700"
                >
                  <span className="material-symbols-outlined mr-2">add</span> Create Health Check Template
                </button>
              )}
            </div>

            <div className="space-y-3">
              {healthCheckTemplates.filter(t => !t.isDefault).length === 0 ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                  <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">dashboard_customize</span>
                  <p className="text-slate-500">No custom health check templates yet.</p>
                  {isAdmin && <p className="text-sm text-slate-400 mt-1">Create one to tailor health checks to your team's needs.</p>}
                </div>
              ) : (
                healthCheckTemplates.filter(t => !t.isDefault).map(template => (
                  <div key={template.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-slate-800 flex items-center">
                          {template.name}
                        </h3>
                        <p className="text-sm text-slate-500 mt-1">{template.dimensions.length} dimensions</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleTemplateDetails(template.id)}
                          className="text-slate-400 hover:text-slate-600"
                          title={expandedTemplates.includes(template.id) ? 'Hide details' : 'View details'}
                        >
                          <span className="material-symbols-outlined">{expandedTemplates.includes(template.id) ? 'expand_less' : 'expand_more'}</span>
                        </button>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => handleOpenTemplateEditor(template)}
                              className="text-slate-400 hover:text-indigo-600"
                              title="Edit template"
                            >
                              <span className="material-symbols-outlined">edit</span>
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(template.id)}
                              className="text-slate-400 hover:text-red-500"
                              title="Delete template"
                            >
                              <span className="material-symbols-outlined">delete</span>
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {template.dimensions.slice(0, 5).map(dim => (
                        <span key={dim.id} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
                          {dim.name}
                        </span>
                      ))}
                      {template.dimensions.length > 5 && (
                        <span className="text-xs text-slate-400">+{template.dimensions.length - 5} more</span>
                      )}
                    </div>

                    {expandedTemplates.includes(template.id) && (
                      <div className="mt-4 space-y-2">
                        {template.dimensions.map(dim => (
                          <div key={dim.id} className="border border-slate-200 rounded-lg p-3 bg-slate-50">
                            <div className="font-bold text-slate-800 text-sm">{dim.name}</div>
                            <div className="text-xs text-emerald-700 mt-1"><strong className="text-emerald-600">👍</strong> {dim.goodDescription}</div>
                            <div className="text-xs text-rose-700 mt-1"><strong className="text-rose-600">👎</strong> {dim.badDescription}</div>
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
              <h2 className="text-xl font-bold text-slate-800">Retrospective Templates</h2>
              {isAdmin && (
                <button
                  onClick={() => {
                    setRetroTemplateName('');
                    setRetroTemplateCols([
                      {id: '1', title: 'Column 1', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'},
                      {id: '2', title: 'Column 2', color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200'}
                    ]);
                    setShowRetroTemplateBuilder(true);
                  }}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center hover:bg-indigo-700"
                >
                  <span className="material-symbols-outlined mr-2">add</span> Create Retro Template
                </button>
              )}
            </div>
            <div className="space-y-3">
              {(!team.customTemplates || team.customTemplates.length === 0) ? (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center">
                  <span className="material-symbols-outlined text-4xl text-slate-300 mb-2">view_column</span>
                  <p className="text-slate-500">No custom retrospective templates yet.</p>
                  {isAdmin && <p className="text-sm text-slate-400 mt-1">Create one to tailor retrospectives to your team's workflow.</p>}
                </div>
              ) : (
                team.customTemplates.map((template, idx) => (
                  <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-bold text-slate-800">{template.name}</h3>
                        <p className="text-sm text-slate-500 mt-1">{template.cols.length} columns</p>
                      </div>
                      {isAdmin && (
                        <button
                          onClick={() => {
                            const newTemplates = (team.customTemplates || []).filter((_, i) => i !== idx);
                            dataService.updateTeam({ ...team, customTemplates: newTemplates });
                            onRefresh();
                          }}
                          className="text-slate-400 hover:text-red-500"
                          title="Delete template"
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
                  feedback
                })
              });
              if (response.ok) {
                const data = await response.json();
                onRefresh();
                // Send notification email to admin (fire-and-forget)
                fetch('/api/notify-new-feedback', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ feedback: data.feedback })
                }).catch(() => {});
              }
            } catch (err) {
              console.error('Failed to create feedback', err);
            }
          }}
          onRefresh={onRefresh}
        />
      )}
    </div>
  );
};

export default Dashboard;
