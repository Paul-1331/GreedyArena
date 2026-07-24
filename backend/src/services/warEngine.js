import schedule from 'node-schedule';
import { prisma } from '../db/prisma.js';
import { checkAndFinishMatch } from './matchLifecycle.js';

/**
 * WarEngine — server-side match scheduler.
 * Handles automatic start/end for official (admin-scheduled) Wars,
 * and automatic end for casual matches that are already playing on startup.
 *
 * All timing authority lives here. Clients never tell the server when time is up.
 */
export const setupWarEngine = (io) => {
  // ── Schedule an official War ─────────────────────────────────────────
  const scheduleWar = (match) => {
    schedule.scheduleJob(`start_${match.id}`, match.scheduled_start_at, async () => {
      try {
        const current = await prisma.arena_matches.findUnique({
          where: { id: match.id },
          include: { quiz: true },
        });
        if (!current || current.status !== 'waiting') return;

        const now = new Date();
        const durationSeconds = current.quiz?.time_limit_seconds || 60;
        const endTime = new Date(now.getTime() + durationSeconds * 1000);

        await prisma.$transaction([
          prisma.arena_matches.update({
            where: { id: match.id },
            data: { status: 'playing', started_at: now },
          }),
          prisma.arena_participants.updateMany({
            where: { match_id: match.id },
            data: { question_started_at: now, player_phase: 'answering' },
          }),
        ]);

        io.to(match.id).emit('match_updated', { status: 'playing', startedAt: now });
        console.log(`[WarEngine] War ${match.id} started. Ends at ${endTime.toISOString()}`);

        scheduleMatchEnd(match.id, endTime, current.quiz_id);
      } catch (err) {
        console.error(`[WarEngine] Error starting war ${match.id}:`, err);
      }
    });
  };

  // ── Schedule a match end (shared by Wars and casual matches) ─────────
  const scheduleMatchEnd = async (matchId, endTime, quizId) => {
    schedule.scheduleJob(`end_${matchId}`, endTime, async () => {
      console.log(`[WarEngine] Match ${matchId} timer expired. Forcing finish...`);
      try {
        const totalQuestions = await prisma.quiz_questions.count({
          where: { quiz_id: quizId },
        });

        // Mark all non-finished participants as finished
        await prisma.arena_participants.updateMany({
          where: { match_id: matchId, player_phase: { not: 'finished' } },
          data: { player_phase: 'finished', finished_at: new Date() },
        });

        await checkAndFinishMatch(io, matchId, totalQuestions, true);
      } catch (err) {
        console.error(`[WarEngine] Error ending match ${matchId}:`, err);
      }
    });
  };

  // ── Cancel a War's scheduled jobs ────────────────────────────────────
  const cancelWar = (matchId) => {
    schedule.cancelJob(`start_${matchId}`);
    schedule.cancelJob(`end_${matchId}`);
    console.log(`[WarEngine] Cancelled scheduled jobs for match ${matchId}`);
  };

  // ── On startup: re-register all pending and active matches ───────────
  const init = async () => {
    try {
      // 1. Re-schedule official Wars that haven't started yet
      const upcomingWars = await prisma.arena_matches.findMany({
        where: { is_official: true, status: 'waiting', scheduled_start_at: { not: null } },
      });
      console.log(`[WarEngine] Found ${upcomingWars.length} upcoming wars to re-schedule`);
      upcomingWars.forEach(scheduleWar);

      // 2. Re-schedule end jobs for ALL playing matches (in case of server restart)
      const playingMatches = await prisma.arena_matches.findMany({
        where: { status: 'playing', started_at: { not: null } },
        include: { quiz: { select: { time_limit_seconds: true, id: true } } },
      });

      for (const m of playingMatches) {
        const timeLimit = m.quiz?.time_limit_seconds || 60;
        const endTime = new Date(new Date(m.started_at).getTime() + timeLimit * 1000);
        if (endTime > new Date()) {
          console.log(`[WarEngine] Re-scheduling end for playing match ${m.id}`);
          scheduleMatchEnd(m.id, endTime, m.quiz_id);
        } else {
          // Timer already expired while server was down — force finish immediately
          console.log(`[WarEngine] Match ${m.id} timer expired while offline. Finishing now.`);
          const totalQuestions = await prisma.quiz_questions.count({ where: { quiz_id: m.quiz_id } });
          await prisma.arena_participants.updateMany({
            where: { match_id: m.id, player_phase: { not: 'finished' } },
            data: { player_phase: 'finished', finished_at: new Date() },
          });
          await checkAndFinishMatch(io, m.id, totalQuestions, true);
        }
      }
    } catch (err) {
      console.error('[WarEngine] Init error:', err);
    }
  };

  init();

  return { scheduleWar, scheduleMatchEnd, cancelWar };
};
