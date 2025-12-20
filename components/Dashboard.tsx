
import React, { useEffect, useState } from 'react';
import { Team, User, RetroSession, Column, HealthCheckSession, HealthCheckModel } from '../types';
import { dataService } from '../services/dataService';

interface Props {
  team: Team;
  currentUser: User;
  onOpenSession: (id: string) => void;
  onOpenHealthSession: (id: string) => void;
  onRefresh: () => void;
  onDeleteTeam?: () => void;
}

const Dashboard: React.FC<Props> = ({ team, currentUser, onOpenSession, onOpenHealthSession, onRefresh, onDeleteTeam }) => {
  const [tab, setTab] = useState<'ACTIONS' | 'RETROS' | 'HEALTH' | 'MEMBERS' | 'SETTINGS'>('ACTIONS');
  const [actionFilter, setActionFilter] = useState<'OPEN' | 'CLOSED' | 'ALL'>('OPEN');
  const [showNewRetroModal, setShowNewRetroModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [retroToDelete, setRetroToDelete] = useState<RetroSession | null>(null);
  const [memberPendingRemoval, setMemberPendingRemoval] = useState<string | null>(null);

  // Action Creation State
  const [newActionText, setNewActionText] = useState('');
  const [newActionAssignee, setNewActionAssignee] = useState<string>('');

  // Custom Template State in Modal
  const [isCreatingCustom, setIsCreatingCustom] = useState(false);
  const [customCols, setCustomCols] = useState<Column[]>([
      {id: '1', title: 'Start', color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'play_arrow', text: 'text-emerald-700', ring: 'focus:ring-emerald-200'},
      {id: '2', title: 'Stop', color: 'bg-rose-50', border: 'border-rose-400', icon: 'stop', text: 'text-rose-700', ring: 'focus:ring-rose-200'}
  ]);
  const [templateName, setTemplateName] = useState('');
  const [retroName, setRetroName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  // Health check state
  const [healthName, setHealthName] = useState('');
  const [healthModelId, setHealthModelId] = useState<string>('');
  const [selectedHealthId, setSelectedHealthId] = useState<string | null>(team.healthChecks?.[0]?.id || null);
  const [newModelName, setNewModelName] = useState('');
  const [newModelDescription, setNewModelDescription] = useState('');
  const [newModelDimensions, setNewModelDimensions] = useState<{ title: string; good: string; bad: string }[]>([
    { title: 'New dimension', good: '', bad: '' },
  ]);
  const [customTemplateName, setCustomTemplateName] = useState('');
  const [customTemplateColumns, setCustomTemplateColumns] = useState<string>('Start\nStop\nContinue');

  const archivedMembers = team.archivedMembers || [];
  const knownMembers = [...team.members, ...archivedMembers];
  const healthModels = dataService.getHealthModels(team.id);
  const healthChecks = team.healthChecks || [];
  const selectedHealthCheck: HealthCheckSession | undefined = healthChecks.find(h => h.id === selectedHealthId);
  const selectedHealthModel: HealthCheckModel | undefined = healthModels.find(m => m.id === (selectedHealthCheck?.modelId || healthModelId));

  useEffect(() => {
    if (!healthModelId && healthModels.length > 0) {
      setHealthModelId(healthModels[0].id);
    }
  }, [healthModelId, healthModels]);

  // Combine global actions and actions from all retros
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
      }))
  ];

  const filteredActions = allActions.filter(a => {
      if(actionFilter === 'OPEN') return !a.done;
      if(actionFilter === 'CLOSED') return a.done;
      return true;
  });

  const handleOpenNewRetroModal = () => {
    // Generate default name
    let defaultName = `Retrospective ${new Date().toLocaleDateString()}`;
    if (team.retrospectives.length > 0) {
        const lastRetroName = team.retrospectives[0].name;
        // Check for "Name X" pattern
        const match = lastRetroName.match(/^(.*?)(\d+)$/);
        if (match) {
            defaultName = `${match[1]}${parseInt(match[2]) + 1}`;
        }
    }
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

  const handleRemoveMember = (memberId: string) => {
    if (memberId === currentUser.id) return;
    dataService.removeMember(team.id, memberId);
    setMemberPendingRemoval(null);
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

  const handleStartHealth = () => {
    if (!isAdmin) return;
    const modelToUse = healthModelId || healthModels[0]?.id;
    if (!modelToUse) return;
    const finalName = healthName.trim() || `Health Check ${new Date().toLocaleDateString()}`;
    const session = dataService.createHealthCheck(team.id, finalName, modelToUse, isAnonymous);
    setHealthName('');
    setSelectedHealthId(session.id);
    onRefresh();
    onOpenHealthSession(session.id);
  };

  const handleAdvanceHealthPhase = (checkId: string) => {
    if (!isAdmin) return;
    dataService.advanceHealthPhase(team.id, checkId);
    onRefresh();
  };

  const handleSaveCustomModel = () => {
    if (!newModelName.trim()) return;
    const dimensions = newModelDimensions
      .filter(d => d.title.trim())
      .map((d, idx) => ({
        id: `${d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${idx}`,
        title: d.title.trim(),
        good: d.good.trim(),
        bad: d.bad.trim(),
      }));

    if (dimensions.length === 0) return;

    dataService.saveHealthModel(team.id, {
      name: newModelName.trim(),
      description: newModelDescription.trim(),
      dimensions,
      language: 'custom',
    });

    setNewModelName('');
    setNewModelDescription('');
    setNewModelDimensions([{ title: 'New dimension', good: '', bad: '' }]);
    onRefresh();
  };

  const handleAddCustomTemplate = () => {
    if (!customTemplateName.trim()) return;
    const entries = customTemplateColumns.split(/\n+/).map(s => s.trim()).filter(Boolean);
    if (entries.length === 0) return;
    const palette = ['bg-emerald-50', 'bg-rose-50', 'bg-sky-50', 'bg-amber-50', 'bg-indigo-50'];
    const templateColumns: Column[] = entries.map((title, idx) => ({
      id: `custom-${idx}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || idx}`,
      title,
      color: palette[idx % palette.length],
      border: palette[idx % palette.length].replace('bg-', 'border-'),
      icon: 'star',
      text: 'text-slate-700',
      ring: 'focus:ring-slate-200',
    }));

    dataService.saveTemplate(team.id, { name: customTemplateName.trim(), cols: templateColumns });
    setCustomTemplateName('');
    setCustomTemplateColumns('Start\nStop\nContinue');
    onRefresh();
  };

  const averageScore = (check: HealthCheckSession, dimensionId: string) => {
    const scores = check.responses
      .map(r => r.ratings[dimensionId]?.score)
      .filter((s): s is number => typeof s === 'number');
    if (scores.length === 0) return '–';
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return avg.toFixed(1);
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

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                <div className="font-bold text-indigo-700 mb-2 group-hover:text-retro-primary">Went Well / Improve / Ideas</div>
                                <p className="text-xs text-slate-500">Fast three-column retro.</p>
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
                                  <div key={idx} className="flex gap-2 mb-2">
                                      <input 
                                        value={c.title}
                                        onChange={(e) => {
                                            const newCols = [...customCols];
                                            newCols[idx].title = e.target.value;
                                            setCustomCols(newCols);
                                        }}
                                        className="flex-grow border border-slate-300 rounded p-2 text-sm bg-white text-slate-900"
                                      />
                                      <button onClick={() => setCustomCols(customCols.filter((_, i) => i !== idx))} className="text-red-500"><span className="material-symbols-outlined">delete</span></button>
                                  </div>
                              ))}
                              <button 
                                onClick={() => setCustomCols([...customCols, {id: Math.random().toString(), title: 'New Column', color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200'}])}
                                className="text-sm font-bold text-indigo-600 hover:underline"
                              >+ Add Column</button>
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

      <div className="flex border-b border-slate-200 mb-6">
        <button onClick={() => setTab('ACTIONS')} className={`dash-tab px-6 py-3 font-bold text-sm flex items-center transition ${tab === 'ACTIONS' ? 'active' : 'text-slate-500 hover:text-retro-primary'}`}>
            <span className="material-symbols-outlined mr-2">check_circle</span> Actions
        </button>
        <button onClick={() => setTab('RETROS')} className={`dash-tab px-6 py-3 font-bold text-sm flex items-center transition ${tab === 'RETROS' ? 'active' : 'text-slate-500 hover:text-retro-primary'}`}>
            <span className="material-symbols-outlined mr-2">history</span> Retrospectives
        </button>
        <button onClick={() => setTab('HEALTH')} className={`dash-tab px-6 py-3 font-bold text-sm flex items-center transition ${tab === 'HEALTH' ? 'active' : 'text-slate-500 hover:text-retro-primary'}`}>
            <span className="material-symbols-outlined mr-2">favorite</span> Health Checks
        </button>
        <button onClick={() => setTab('MEMBERS')} className={`dash-tab px-6 py-3 font-bold text-sm flex items-center transition ${tab === 'MEMBERS' ? 'active' : 'text-slate-500 hover:text-retro-primary'}`}>
            <span className="material-symbols-outlined mr-2">groups</span> Members
        </button>
        <button onClick={() => setTab('SETTINGS')} className={`dash-tab px-6 py-3 font-bold text-sm flex items-center transition ${tab === 'SETTINGS' ? 'active' : 'text-slate-500 hover:text-retro-primary'}`}>
            <span className="material-symbols-outlined mr-2">tune</span> Settings
        </button>
      </div>

      {tab === 'ACTIONS' && (
         <div className="max-w-4xl mx-auto">
             {/* Action Creator with Assignee */}
             <form onSubmit={handleCreateAction} className="mb-6 p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
                 <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Create Action</h3>
                 <div className="flex flex-col md:flex-row gap-2">
                    <input 
                        type="text" 
                        placeholder="What needs to be done?" 
                        className="flex-grow px-3 py-2 rounded border border-slate-300 focus:border-retro-primary outline-none bg-white text-slate-900"
                        value={newActionText}
                        onChange={(e) => setNewActionText(e.target.value)}
                    />
                    <select 
                        value={newActionAssignee}
                        onChange={(e) => setNewActionAssignee(e.target.value)}
                        className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-900 outline-none text-sm min-w-[150px]"
                    >
                        <option value="">Unassigned</option>
                        {team.members.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                    </select>
                    <button type="submit" disabled={!newActionText.trim()} className="bg-retro-primary text-white px-4 py-2 rounded font-bold hover:bg-retro-primaryHover disabled:opacity-50 transition">
                        Add
                    </button>
                 </div>
             </form>

            <div className="flex space-x-2 mb-4 text-sm font-medium">
                {(['OPEN', 'CLOSED', 'ALL'] as const).map(f => (
                    <button key={f} onClick={() => setActionFilter(f)} className={`px-3 py-1.5 rounded-full border transition ${actionFilter === f ? 'bg-indigo-50 border-retro-primary text-retro-primary' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                        {f.charAt(0) + f.slice(1).toLowerCase()}
                    </button>
                ))}
            </div>
            
            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                {filteredActions.length === 0 ? (
                    <div className="text-center text-slate-400 py-10">No actions found.</div>
                ) : (
                    filteredActions.map(action => (
                        <div key={action.id} className="flex items-center p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 group">
                            <button onClick={() => handleToggleAction(action.id)} className={`mr-4 transition ${action.done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-400'}`}>
                                <span className="material-symbols-outlined text-2xl">
                                    {action.done ? 'check_circle' : 'radio_button_unchecked'}
                                </span>
                            </button>
                            <div className="flex-grow mr-4">
                                <input
                                    defaultValue={action.text}
                                    onBlur={(e) => handleUpdateActionText(action.id, e.target.value)}
                                    onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                    className={`w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-2 py-1 focus:bg-white focus:border-retro-primary outline-none transition font-medium ${action.done ? 'line-through text-slate-400' : 'text-slate-700'}`}
                                />
                                <div className="flex items-center text-xs mt-1">
                                    {action.originRetro !== 'Dashboard' && <span className="text-slate-400 px-1 bg-slate-100 rounded mr-2">{action.originRetro}</span>}
                                    {action.contextText && <span className="text-indigo-400 italic truncate max-w-[200px]" title={action.contextText}>Re: {action.contextText}</span>}
                                </div>
                            </div>
                            <div className="flex items-center">
                                {action.assigneeId && !team.members.some(m => m.id === action.assigneeId) && (
                                    (() => {
                                        const archived = knownMembers.find(m => m.id === action.assigneeId);
                                        if (!archived) return null;
                                        return (
                                          <select
                                            value={action.assigneeId || ''}
                                            onChange={(e) => handleUpdateAssignee(action.id, e.target.value || null)}
                                            className="text-xs border border-slate-200 rounded p-1.5 bg-amber-50 text-amber-700 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-none"
                                          >
                                            <option value={archived.id}>{archived.name} (removed)</option>
                                            {team.members.map(m => (
                                                <option key={m.id} value={m.id}>{m.name}</option>
                                            ))}
                                            <option value="">Unassigned</option>
                                          </select>
                                        );
                                    })()
                                )}
                                {!action.assigneeId || team.members.some(m => m.id === action.assigneeId) ? (
                                <select
                                    value={action.assigneeId || ''}
                                    onChange={(e) => handleUpdateAssignee(action.id, e.target.value || null)}
                                    className="text-xs border border-slate-200 rounded p-1.5 bg-white text-slate-600 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-none"
                                >
                                    <option value="">Unassigned</option>
                                    {team.members.map(m => (
                                        <option key={m.id} value={m.id}>{m.name}</option>
                                    ))}
                                </select>
                                ) : null}
                            </div>
                        </div>
                    ))
                )}
            </div>
         </div>
      )}

      {tab === 'RETROS' && (
          <div>
              {team.retrospectives.length === 0 ? (
                  <div className="text-center text-slate-400 py-10">No retrospectives yet. Start one!</div>
              ) : (
                  team.retrospectives.map(retro => (
                    <div key={retro.id} className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 flex items-center justify-between mb-3 hover:shadow-md transition">
                        <div className="flex items-center">
                            <div className="w-12 h-12 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center mr-4">
                                <span className="material-symbols-outlined">event_note</span>
                            </div>
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg">{retro.name}</h3>
                                <div className="text-xs text-slate-500 font-medium uppercase tracking-wide flex items-center gap-2">
                                    <span>{retro.date}</span> •
                                    <span className={retro.status === 'IN_PROGRESS' ? 'text-green-600' : 'text-slate-400'}>
                                        {retro.status.replace('_', ' ')}
                                    </span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isAdmin && (
                              <button
                                onClick={() => setRetroToDelete(retro)}
                                className="p-2 text-slate-400 hover:text-amber-600 border border-transparent hover:border-amber-200 rounded"
                                title="Delete retrospective"
                              >
                                <span className="material-symbols-outlined">delete</span>
                              </button>
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

      {tab === 'HEALTH' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-4">
            {healthChecks.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm text-center text-slate-500">
                No health checks yet. Start one to begin tracking your team.
              </div>
            ) : (
              healthChecks.map(check => {
                const model = healthModels.find(m => m.id === check.modelId);
                return (
                  <div key={check.id} className={`bg-white border ${selectedHealthId === check.id ? 'border-retro-primary' : 'border-slate-200'} rounded-xl p-5 shadow-sm cursor-pointer`} onClick={() => setSelectedHealthId(check.id)}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-slate-800 text-lg">{check.name}</h3>
                        <p className="text-xs text-slate-500 uppercase tracking-wide">{check.date} • {model?.name}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`px-3 py-1 rounded-full text-xs font-bold ${check.phase === 'CLOSED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{check.phase}</span>
                        <button onClick={(e) => { e.stopPropagation(); onOpenHealthSession(check.id); }} className="text-retro-primary font-bold text-sm">
                          Open
                        </button>
                        {isAdmin && check.phase !== 'CLOSED' && (
                          <button onClick={(e) => { e.stopPropagation(); handleAdvanceHealthPhase(check.id); }} className="text-retro-primary font-bold text-sm">Advance phase</button>
                        )}
                      </div>
                    </div>
                    {model && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {model.dimensions.slice(0, 4).map(dim => (
                          <div key={dim.id} className="border border-slate-100 rounded-lg p-3">
                            <div className="flex items-center justify-between text-sm font-bold text-slate-700">
                              <span>{dim.title}</span>
                              <span className="text-retro-primary text-base">{averageScore(check, dim.id)}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-1">{dim.good}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm uppercase tracking-wide text-slate-500 font-bold mb-2">Start health check</h3>
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Health check name"
                  value={healthName}
                  onChange={(e) => setHealthName(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
                />
                <select
                  value={healthModelId}
                  onChange={(e) => setHealthModelId(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-slate-800 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
                  disabled={!isAdmin}
                >
                  {healthModels.map(model => (
                    <option key={model.id} value={model.id}>{model.name}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} disabled={!isAdmin} />
                  Anonymous answers
                </label>
                <button
                  onClick={handleStartHealth}
                  disabled={!isAdmin}
                  className="w-full bg-retro-primary text-white font-bold rounded-lg py-2 hover:bg-retro-primaryHover disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isAdmin ? 'Start' : 'Only facilitators can start'}
                </button>
                {!isAdmin && (
                  <p className="text-xs text-slate-500">A facilitator must start and drive phases, just like retrospectives.</p>
                )}
              </div>
            </div>

            {selectedHealthCheck && selectedHealthModel && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm uppercase tracking-wide text-slate-500 font-bold">Active health check</h3>
                  <span className="text-xs text-slate-500">Phase: {selectedHealthCheck.phase}</span>
                </div>
                <p className="text-sm text-slate-600">Open the dedicated health check page to invite participants, collect ratings, and guide phases.</p>
                <button
                  onClick={() => onOpenHealthSession(selectedHealthCheck.id)}
                  className="w-full bg-retro-primary text-white font-bold rounded-lg py-2 hover:bg-retro-primaryHover"
                >
                  Go to health check
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'MEMBERS' && (
        <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-3">
          {team.members.map((member) => (
            <div key={member.id} className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full ${member.color} text-white flex items-center justify-center font-bold uppercase`}>
                {member.name.substring(0, 2)}
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-bold text-slate-800">{member.name}</span>
                <span className="text-[11px] uppercase tracking-wide text-slate-400">{member.role}</span>
                {member.email && <span className="text-xs text-slate-500">{member.email}</span>}
              </div>
              {isAdmin && member.id !== currentUser.id && (
                <div className="ml-auto flex items-center gap-2">
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
                </div>
              )}
            </div>
          ))}
          {team.members.length === 0 && (
            <div className="text-center text-slate-400 py-10 col-span-full">No members yet.</div>
          )}
        </div>
      )}

      {tab === 'SETTINGS' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Custom health models</h3>
                <p className="text-sm text-slate-500">Create reusable checklists tailored to your team.</p>
              </div>
              <span className="text-xs text-slate-500">{healthModels.length} models</span>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                placeholder="Model name"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
              />
              <textarea
                placeholder="Short description (optional)"
                value={newModelDescription}
                onChange={(e) => setNewModelDescription(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
              />
              <div className="space-y-2">
                {newModelDimensions.map((dim, idx) => (
                  <div key={idx} className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={dim.title}
                        onChange={(e) => setNewModelDimensions(newModelDimensions.map((d, i) => i === idx ? { ...d, title: e.target.value } : d))}
                        className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                        placeholder="Dimension title"
                      />
                      <button onClick={() => setNewModelDimensions(newModelDimensions.filter((_, i) => i !== idx))} className="text-slate-400 hover:text-red-500" title="Remove dimension">
                        <span className="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                    <textarea
                      value={dim.good}
                      onChange={(e) => setNewModelDimensions(newModelDimensions.map((d, i) => i === idx ? { ...d, good: e.target.value } : d))}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                      placeholder="What good looks like"
                    />
                    <textarea
                      value={dim.bad}
                      onChange={(e) => setNewModelDimensions(newModelDimensions.map((d, i) => i === idx ? { ...d, bad: e.target.value } : d))}
                      className="w-full border border-slate-300 rounded px-2 py-1 text-xs"
                      placeholder="What bad looks like"
                    />
                  </div>
                ))}
                <button
                  onClick={() => setNewModelDimensions([...newModelDimensions, { title: 'New dimension', good: '', bad: '' }])}
                  className="text-retro-primary text-sm font-bold"
                >
                  + Add dimension
                </button>
              </div>
              <button onClick={handleSaveCustomModel} className="w-full bg-retro-primary text-white font-bold rounded-lg py-2 hover:bg-retro-primaryHover">Save model</button>

              <div className="pt-3 border-t border-slate-100">
                <h4 className="text-xs uppercase text-slate-500 font-bold mb-2">Existing models</h4>
                <ul className="divide-y divide-slate-100">
                  {healthModels.map(model => (
                    <li key={model.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-800">{model.name}</span>
                        {model.isCustom && <span className="text-xs text-emerald-600 font-bold">Custom</span>}
                      </div>
                      {model.description && <p className="text-xs text-slate-500">{model.description}</p>}
                      <p className="text-[11px] text-slate-400">{model.dimensions.length} dimensions</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-800">Retro templates</h3>
                <p className="text-sm text-slate-500">Capture your favorite formats.</p>
              </div>
              <span className="text-xs text-slate-500">{team.customTemplates.length} custom</span>
            </div>
            <input
              type="text"
              placeholder="Template name"
              value={customTemplateName}
              onChange={(e) => setCustomTemplateName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
            />
            <textarea
              value={customTemplateColumns}
              onChange={(e) => setCustomTemplateColumns(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
              placeholder={'One column per line (e.g.\nStart\nStop\nContinue)'}
            />
            <button onClick={handleAddCustomTemplate} className="w-full bg-retro-primary text-white font-bold rounded-lg py-2 hover:bg-retro-primaryHover">Save template</button>

            <div className="pt-3 border-t border-slate-100 space-y-2">
              <h4 className="text-xs uppercase text-slate-500 font-bold">Custom templates</h4>
              {team.customTemplates.length === 0 ? (
                <p className="text-slate-500 text-sm">No custom templates yet.</p>
              ) : (
                team.customTemplates.map(t => (
                  <div key={t.name} className="border border-slate-100 rounded-lg p-3">
                    <div className="font-semibold text-slate-800">{t.name}</div>
                    <p className="text-xs text-slate-500">{t.cols.length} columns</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
