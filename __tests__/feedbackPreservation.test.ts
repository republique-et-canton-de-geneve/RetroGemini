import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Tests for Feature 3: Preserve feedback when a team is deleted.
 *
 * When a team is deleted, its feedbacks should be moved to an
 * orphanedFeedbacks array in the persisted data, not destroyed.
 * All feedback-related endpoints should also search orphanedFeedbacks.
 */

describe('Feedback preservation on team deletion', () => {
  const dataStoreSource = readFileSync(
    join(__dirname, '..', 'server', 'services', 'dataStore.js'),
    'utf-8'
  );
  const teamRoutesSource = readFileSync(
    join(__dirname, '..', 'server', 'routes', 'teamRoutes.js'),
    'utf-8'
  );
  const feedbackRoutesSource = readFileSync(
    join(__dirname, '..', 'server', 'routes', 'feedbackRoutes.js'),
    'utf-8'
  );
  const superAdminRoutesSource = readFileSync(
    join(__dirname, '..', 'server', 'routes', 'superAdminRoutes.js'),
    'utf-8'
  );

  describe('Data normalization', () => {
    it('should initialize orphanedFeedbacks in normalizePersistedData', () => {
      // normalizePersistedData should set orphanedFeedbacks = [] if missing
      expect(dataStoreSource).toContain("normalized.orphanedFeedbacks");
      expect(dataStoreSource).toContain("Array.isArray(normalized.orphanedFeedbacks)");
    });
  });

  describe('Team deletion handler', () => {
    it('should preserve feedbacks before removing the team', () => {
      // The team deletion handler should copy feedbacks to orphanedFeedbacks
      // before splicing the team from the array
      const deleteSection = teamRoutesSource.substring(
        teamRoutesSource.indexOf("app.post('/api/team/:teamId/delete'"),
        teamRoutesSource.indexOf("app.get('/api/team/exists")
      );

      // Should reference teamFeedbacks and orphanedFeedbacks
      expect(deleteSection).toContain('teamFeedbacks');
      expect(deleteSection).toContain('orphanedFeedbacks');
      expect(deleteSection).toContain('feedbacksToPreserve');

      // The preservation should happen BEFORE the splice
      const preserveIndex = deleteSection.indexOf('feedbacksToPreserve');
      const spliceIndex = deleteSection.indexOf('teams.splice');
      expect(preserveIndex).toBeLessThan(spliceIndex);
    });
  });

  describe('Feedback loading endpoints', () => {
    it('should include orphaned feedbacks in /api/feedbacks/all', () => {
      const feedbacksAllSection = feedbackRoutesSource.substring(
        feedbackRoutesSource.indexOf("app.post('/api/feedbacks/all'"),
        feedbackRoutesSource.indexOf("app.post('/api/feedbacks/comment'")
      );

      expect(feedbacksAllSection).toContain('orphanedFeedbacks');
      expect(feedbacksAllSection).toContain('orphaned');
    });

    it('should include orphaned feedbacks in /api/super-admin/feedbacks', () => {
      const superAdminFeedbacksSection = superAdminRoutesSource.substring(
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/feedbacks'"),
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/update-email'")
      );

      expect(superAdminFeedbacksSection).toContain('orphanedFeedbacks');
      expect(superAdminFeedbacksSection).toContain('orphaned');
    });
  });

  describe('Feedback operations on orphaned feedbacks', () => {
    it('should check orphaned feedbacks in team comment endpoint', () => {
      const commentSection = feedbackRoutesSource.substring(
        feedbackRoutesSource.indexOf("app.post('/api/feedbacks/comment'"),
        feedbackRoutesSource.indexOf("app.post('/api/feedbacks/comment/delete'")
      );

      expect(commentSection).toContain('orphanedFeedbacks');
    });

    it('should check orphaned feedbacks in team comment delete endpoint', () => {
      const commentDeleteSection = feedbackRoutesSource.substring(
        feedbackRoutesSource.indexOf("app.post('/api/feedbacks/comment/delete'"),
        feedbackRoutesSource.indexOf("app.post('/api/feedbacks/delete'")
      );

      expect(commentDeleteSection).toContain('orphanedFeedbacks');
    });

    it('should check orphaned feedbacks in super-admin feedback update endpoint', () => {
      const updateSection = superAdminRoutesSource.substring(
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/feedbacks/update'"),
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/feedbacks/delete'")
      );

      expect(updateSection).toContain('orphanedFeedbacks');
    });

    it('should check orphaned feedbacks in super-admin feedback delete endpoint', () => {
      const deleteSection = superAdminRoutesSource.substring(
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/feedbacks/delete'"),
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/feedbacks/comment'")
      );

      expect(deleteSection).toContain('orphanedFeedbacks');
    });

    it('should check orphaned feedbacks in super-admin feedback comment endpoint', () => {
      const commentSection = superAdminRoutesSource.substring(
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/feedbacks/comment'"),
        superAdminRoutesSource.indexOf("app.post('/api/super-admin/update-password'")
      );

      expect(commentSection).toContain('orphanedFeedbacks');
    });
  });

  describe('Feedback preservation data flow', () => {
    it('should copy teamId and teamName from the deleted team', () => {
      expect(teamRoutesSource).toContain('teamId: f.teamId || deletedTeam.id');
      expect(teamRoutesSource).toContain('teamName: f.teamName || deletedTeam.name');
    });
  });
});
