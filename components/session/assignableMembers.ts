import { Team, User } from '../../types';
import { dataService } from '../../services/dataService';

/**
 * The members an action can be assigned to from inside a session.
 *
 * Deliberately derived from the *team roster*, never from the session
 * participants and never from `archivedMembers`:
 *
 * - a participant who is not (or no longer) a team member must not become
 *   assignable just by being in the room — actions outlive the session and are
 *   owned by the team record;
 * - an archived member must not come back as an assignment target.
 *
 * The freshest roster is the one `dataService` holds, because roster edits made
 * on the Dashboard land there first; the `team` prop is the fallback for when
 * the team is not in the cache. The returned array is a copy, so callers can
 * sort or filter it without mutating the cached roster.
 */
export const getAssignableMembers = (team: Team): User[] =>
  [...(dataService.getTeam(team.id)?.members ?? team.members)];
