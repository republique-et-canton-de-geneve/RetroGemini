import React, { useState, useEffect } from 'react';
import { Team } from '../types';

interface Props {
  superAdminPassword: string;
  onExit: () => void;
  onAccessTeam: (team: Team) => void;
}

const SuperAdmin: React.FC<Props> = ({ superAdminPassword, onExit, onAccessTeam }) => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    loadTeams();
  }, []);

  const loadTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/super-admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword })
      });
      if (!response.ok) {
        throw new Error('Failed to load teams');
      }
      const data = await response.json();
      setTeams(data.teams || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateEmail = async (teamId: string) => {
    setError('');
    setSuccessMessage('');
    try {
      const response = await fetch('/api/super-admin/update-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: superAdminPassword,
          teamId,
          facilitatorEmail: editEmail
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update email');
      }

      setSuccessMessage('Email updated successfully');
      setEditingTeamId(null);
      setEditEmail('');

      // Reload teams to get updated data
      await loadTeams();

      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update email');
    }
  };

  const startEditEmail = (team: Team) => {
    setEditingTeamId(team.id);
    setEditEmail(team.facilitatorEmail || '');
  };

  const cancelEdit = () => {
    setEditingTeamId(null);
    setEditEmail('');
    setError('');
  };

  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center">
              <span className="material-symbols-outlined mr-3 text-red-600">shield_person</span>
              Super Admin Dashboard
            </h1>
            <p className="text-slate-500 text-sm mt-1">Manage all teams and recovery emails</p>
          </div>
          <button
            onClick={onExit}
            className="bg-slate-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-slate-700 flex items-center"
          >
            <span className="material-symbols-outlined mr-2">logout</span>
            Exit Admin Mode
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4 flex items-center">
            <span className="material-symbols-outlined mr-2">error</span>
            {error}
          </div>
        )}

        {successMessage && (
          <div className="bg-green-50 text-green-700 p-4 rounded-lg mb-4 flex items-center">
            <span className="material-symbols-outlined mr-2">check_circle</span>
            {successMessage}
          </div>
        )}

        {loading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="text-slate-500 mt-4">Loading teams...</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white p-4">
              <h2 className="text-xl font-bold">Teams ({teams.length})</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-4 font-bold text-slate-700">Team Name</th>
                    <th className="text-left p-4 font-bold text-slate-700">Members</th>
                    <th className="text-left p-4 font-bold text-slate-700">Recovery Email</th>
                    <th className="text-left p-4 font-bold text-slate-700">Last Active</th>
                    <th className="text-right p-4 font-bold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-4">
                        <div className="font-bold text-slate-800">{team.name}</div>
                        <div className="text-xs text-slate-400">ID: {team.id}</div>
                      </td>
                      <td className="p-4 text-slate-600">
                        {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                      </td>
                      <td className="p-4">
                        {editingTeamId === team.id ? (
                          <div className="flex gap-2">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                              placeholder="email@example.com"
                              autoFocus
                            />
                            <button
                              onClick={() => handleUpdateEmail(team.id)}
                              className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="bg-slate-400 text-white px-3 py-1 rounded text-sm hover:bg-slate-500"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {team.facilitatorEmail ? (
                              <span className="text-slate-700">{team.facilitatorEmail}</span>
                            ) : (
                              <span className="text-slate-400 italic">Not configured</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-slate-600 text-sm">
                        {team.lastConnectionDate
                          ? new Date(team.lastConnectionDate).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          {editingTeamId !== team.id && (
                            <>
                              <button
                                onClick={() => startEditEmail(team)}
                                className="text-indigo-600 hover:text-indigo-800 px-3 py-1 rounded border border-indigo-600 hover:bg-indigo-50 text-sm font-medium"
                                title="Edit recovery email"
                              >
                                Edit Email
                              </button>
                              <button
                                onClick={() => onAccessTeam(team)}
                                className="bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 text-sm font-medium"
                                title="Access team dashboard"
                              >
                                Access Team
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {teams.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  <span className="material-symbols-outlined text-6xl mb-4 opacity-50">groups_off</span>
                  <p>No teams found</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperAdmin;
