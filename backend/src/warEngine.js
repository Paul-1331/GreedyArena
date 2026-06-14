import schedule from 'node-schedule';
import { prisma } from './db/prisma.js';
import { computeMatchRatings } from './utils/glicko2.js';

export const setupWarEngine = (io) => {
  const scheduleWar = (match) => {
    // Schedule match start
    schedule.scheduleJob(`start_${match.id}`, match.scheduled_start_at, async () => {
      try {
        const currentMatch = await prisma.arena_matches.findUnique({
          where: { id: match.id },
          include: { quiz: true }
        });

        if (!currentMatch || currentMatch.status !== 'waiting') return;

        const now = new Date();
        const durationSeconds = currentMatch.quiz?.time_limit_seconds || 60;
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

        io.to(match.id).emit('match_updated', { status: 'playing' });
        console.log(`[WarEngine] War ${match.id} started. Ends at ${endTime.toISOString()}`);

        // Schedule match end
        schedule.scheduleJob(`end_${match.id}`, endTime, async () => {
          console.log(`[WarEngine] War ${match.id} ended. Computing ratings...`);
          try {
            // Update status
            await prisma.arena_matches.update({
              where: { id: match.id },
              data: { status: 'finished' }
            });

            // Update quiz to approved
            await prisma.quizzes.update({
              where: { id: match.quiz_id },
              data: { status: 'approved' }
            });

            // Compute ratings
            await computeRatingsForMatch(match.id, currentMatch.quiz_id);

            io.to(match.id).emit('match_finished');
          } catch (err) {
            console.error(`[WarEngine] Error ending war ${match.id}:`, err);
          }
        });
      } catch (err) {
        console.error(`[WarEngine] Error starting war ${match.id}:`, err);
      }
    });
  };

  const computeRatingsForMatch = async (matchId, quizId) => {
    try {
      const participants = await prisma.arena_participants.findMany({
        where: { match_id: matchId },
      });

      if (participants.length < 2) return; // Need at least 2 players

      const quiz = await prisma.quizzes.findUnique({
        where: { id: quizId },
        select: { creator_id: true }
      });

      // Filter out admin/creator
      const validParticipants = participants.filter(p => p.user_id !== quiz?.creator_id);
      if (validParticipants.length < 2) return;

      const playerIds = validParticipants.map(p => p.user_id);
      const pastRatings = await prisma.arena_ratings.findMany({
        where: { user_id: { in: playerIds } },
      });
      const ratingMap = new Map(pastRatings.map(r => [r.user_id, r]));

      const formattedPlayers = validParticipants.map(p => {
        const ratingInfo = ratingMap.get(p.user_id) || { rating: 1500, deviation: 350, volatility: 0.06 };
        return {
          id: p.user_id,
          rating: ratingInfo.rating,
          rd: ratingInfo.deviation,
          vol: ratingInfo.volatility,
          score: p.score,
        };
      });

      const updatedPlayers = computeMatchRatings(formattedPlayers);

      for (const newRating of updatedPlayers) {
        const uid = newRating.id;
        const participantInfo = validParticipants.find((p) => p.user_id === uid);
        const playerScore = participantInfo ? participantInfo.score : 0;
        
        // Count as win if they are top score? For simplicity just use rating engine.
        // The computeMatchRatings likely just returns rating.
        const isWinner = playerScore === Math.max(...validParticipants.map(p => p.score));

        const existing = ratingMap.get(uid);
        if (existing) {
          await prisma.arena_ratings.update({
            where: { user_id: uid },
            data: {
              rating: newRating.rating,
              deviation: newRating.deviation,
              volatility: newRating.volatility,
              matches_played: existing.matches_played + 1,
              wins: existing.wins + (isWinner ? 1 : 0),
              total_score: existing.total_score + playerScore,
            },
          });
        } else {
          await prisma.arena_ratings.create({
            data: {
              user_id: uid,
              rating: newRating.rating,
              deviation: newRating.deviation,
              volatility: newRating.volatility,
              matches_played: 1,
              wins: isWinner ? 1 : 0,
              total_score: playerScore,
            },
          });
        }
      }
    } catch (err) {
      console.error('[WarEngine] Failed to compute ratings:', err);
    }
  };

  // On startup, find all scheduled wars
  const init = async () => {
    try {
      const upcomingWars = await prisma.arena_matches.findMany({
        where: {
          is_official: true,
          status: 'waiting',
          scheduled_start_at: { not: null }
        }
      });
      console.log(`[WarEngine] Found ${upcomingWars.length} upcoming wars`);
      upcomingWars.forEach(scheduleWar);
    } catch (err) {
      console.error('[WarEngine] Init error:', err);
    }
  };

  init();

  return { scheduleWar };
};
