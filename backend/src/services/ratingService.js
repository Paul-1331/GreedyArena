import { prisma } from '../db/prisma.js';
import { computeMatchRatings } from '../utils/glicko2.js';

/**
 * Compute and persist Glicko-2 ratings for all participants in a finished match.
 * Only called for official matches with 2+ players.
 */
export async function computeRatingsForMatch(matchId) {
  const participants = await prisma.arena_participants.findMany({
    where: { match_id: matchId },
    select: { user_id: true, score: true },
  });

  if (participants.length < 2) return;

  const playerIds = participants.map((p) => p.user_id);
  const pastRatings = await prisma.arena_ratings.findMany({
    where: { user_id: { in: playerIds } },
  });
  const ratingMap = new Map(pastRatings.map((r) => [r.user_id, r]));

  // Build input format expected by computeMatchRatings
  const ratingInputs = participants.map((p) => {
    const existing = ratingMap.get(p.user_id);
    return {
      user_id: p.user_id,
      score: p.score,
      rating: {
        rating: existing?.rating ?? 1500,
        deviation: existing?.deviation ?? 350,
        volatility: existing?.volatility ?? 0.06,
      },
    };
  });

  // Returns Map<userId, { rating, deviation, volatility }>
  const newRatings = computeMatchRatings(ratingInputs);

  const sortedByScore = [...participants].sort((a, b) => b.score - a.score);
  const winnerId = sortedByScore[0].user_id;

  for (const [uid, newRating] of newRatings) {
    const existing = ratingMap.get(uid);
    const playerScore = participants.find((p) => p.user_id === uid)?.score ?? 0;
    const isWinner = uid === winnerId;

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
}
