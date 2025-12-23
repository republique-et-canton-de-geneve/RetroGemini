import React, { useState } from 'react';
import { TeamFeedback as TeamFeedbackType } from '../types';

interface TeamFeedbackProps {
  teamId: string;
  teamName: string;
  currentUserId: string;
  currentUserName: string;
  feedbacks: TeamFeedbackType[];
  onSubmitFeedback: (feedback: Omit<TeamFeedbackType, 'id' | 'submittedAt' | 'isRead' | 'status'>) => void;
}

const TeamFeedback: React.FC<TeamFeedbackProps> = ({
  teamId,
  teamName,
  currentUserId,
  currentUserName,
  feedbacks,
  onSubmitFeedback
}) => {
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<'bug' | 'feature'>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setUploading(true);
    const newImages: string[] = [];

    Array.from(files).forEach((file, index) => {
      // Limit to 5 images and max 2MB per image
      if (images.length + newImages.length >= 5) {
        alert('Maximum 5 images allowed');
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        alert(`Image ${file.name} is too large. Maximum 2MB per image.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          newImages.push(event.target.result as string);
          if (index === files.length - 1) {
            setImages([...images, ...newImages]);
            setUploading(false);
          }
        }
      };
      reader.onerror = () => {
        alert('Error reading file');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      alert('Please fill in all fields');
      return;
    }

    onSubmitFeedback({
      teamId,
      teamName,
      type,
      title: title.trim(),
      description: description.trim(),
      images: images.length > 0 ? images : undefined,
      submittedBy: currentUserId,
      submittedByName: currentUserName
    });

    // Reset form
    setTitle('');
    setDescription('');
    setImages([]);
    setShowForm(false);
  };

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: TeamFeedbackType['status']) => {
    const badges = {
      pending: { text: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
      in_progress: { text: 'In Progress', color: 'bg-blue-100 text-blue-800' },
      resolved: { text: 'Resolved', color: 'bg-green-100 text-green-800' },
      rejected: { text: 'Rejected', color: 'bg-red-100 text-red-800' }
    };
    const badge = badges[status];
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  const getTypeBadge = (feedbackType: 'bug' | 'feature') => {
    return feedbackType === 'bug' ? (
      <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
        <span className="material-symbols-outlined text-xs align-middle mr-1">bug_report</span>
        Bug
      </span>
    ) : (
      <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800">
        <span className="material-symbols-outlined text-xs align-middle mr-1">new_releases</span>
        Feature
      </span>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Team Feedback</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          New Feedback
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Submit Feedback</h3>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="bug"
                    checked={type === 'bug'}
                    onChange={(e) => setType(e.target.value as 'bug' | 'feature')}
                    className="mr-2"
                  />
                  <span className="material-symbols-outlined text-red-600 mr-1">bug_report</span>
                  Bug
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="feature"
                    checked={type === 'feature'}
                    onChange={(e) => setType(e.target.value as 'bug' | 'feature')}
                    className="mr-2"
                  />
                  <span className="material-symbols-outlined text-purple-600 mr-1">new_releases</span>
                  Feature Request
                </label>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Brief summary"
                maxLength={100}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Describe the issue or feature request..."
                rows={5}
                maxLength={2000}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Images (max 5, 2MB per image)
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                disabled={uploading || images.length >= 5}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              {uploading && <p className="text-sm text-slate-500 mt-2">Uploading images...</p>}

              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={img} alt={`Upload ${idx + 1}`} className="w-20 h-20 object-cover rounded" />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                Submit
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setTitle('');
                  setDescription('');
                  setImages([]);
                }}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="space-y-4">
        {feedbacks.length === 0 ? (
          <div className="bg-slate-50 rounded-lg p-8 text-center text-slate-500">
            No feedback submitted yet
          </div>
        ) : (
          feedbacks.map((feedback) => (
            <div key={feedback.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-2">
                  {getTypeBadge(feedback.type)}
                  {getStatusBadge(feedback.status)}
                </div>
                <span className="text-sm text-slate-500">{formatDate(feedback.submittedAt)}</span>
              </div>

              <h3 className="text-lg font-semibold text-slate-800 mb-2">{feedback.title}</h3>
              <p className="text-slate-600 mb-3 whitespace-pre-wrap">{feedback.description}</p>

              {feedback.images && feedback.images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {feedback.images.map((img, idx) => (
                    <img
                      key={idx}
                      src={img}
                      alt={`Feedback ${idx + 1}`}
                      className="w-32 h-32 object-cover rounded cursor-pointer hover:opacity-80"
                      onClick={() => window.open(img, '_blank')}
                    />
                  ))}
                </div>
              )}

              <div className="text-sm text-slate-500">
                Submitted on {formatDate(feedback.submittedAt).split(',')[0]}
              </div>

              {feedback.adminNotes && (
                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded">
                  <p className="text-sm font-medium text-amber-800 mb-1">Admin note:</p>
                  <p className="text-sm text-amber-700">{feedback.adminNotes}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default TeamFeedback;
