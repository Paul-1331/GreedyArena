import { prisma } from '../db/prisma.js';
import { computeRatingsForMatch } from './ratingService.js';

/**
 * Check if all participants have finished (or time expired), then close the match.
 * Uses a conditional updateMany to prevent race conditions — only one concurrent
 * call can win the update. If count === 0, another call already closed it.
 *
 * @param {import('socket.io').Server} io
 * @param {string} matchId
 * @param {number} totalQuestions
 * @param {boolean} force - skip the "all done?" check (e.g. global timer expired)
 */
export async function checkAndFinishMatch(io, matchId, totalQuestions, force = false) {
  if (!force) {
    const participants = await prisma.arena_participants.findMany({
      where: { match_id: matchId },
      select: { player_phase: true, answers: true },
    });

    const allDone = participants.every((p) => {
      const answers = p.answers ?? [];
      return p.player_phase === 'finished' || answers.length >= totalQuestions;
    });

    if (!allDone) return;
  }

  // Atomic conditional update — prevents duplicate finish + rating computation
  const updated = await prisma.arena_matches.updateMany({
    where: { id: matchId, status: { not: 'finished' } },
    data: { status: 'finished', finished_at: new Date() },
  });

  // If count === 0, the match was already finished by another concurrent call
  if (updated.count === 0) return;

  // Fetch the match to check if official
  const match = await prisma.arena_matches.findUnique({
    where: { id: matchId },
    select: { is_official: true, quiz_id: true },
  });

  if (match?.is_official) {
    try {
      await computeRatingsForMatch(matchId);
    } catch (err) {
      console.error(`[matchLifecycle] Rating computation failed for match ${matchId}:`, err);
    }
  }

  io.to(matchId).emit('match_finished');
}
