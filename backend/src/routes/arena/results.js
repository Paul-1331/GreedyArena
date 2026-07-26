import express from 'express';
import { prisma } from '../../db/prisma.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

// GET /api/arena/matches/:id/results
router.get('/matches/:id/results', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({
      where: { id },
      include: { quiz: { select: { title: true, category: true } } },
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const participants = await prisma.arena_participants.findMany({
      where: { match_id: id },
      orderBy: [{ score: 'desc' }, { total_time_ms: 'asc' }],
      include: { user: { select: { display_name: true, avatar_url: true } } },
    });

    // Include everyone who played (even score=0), exclude ghost records with no answers
    // that were created but the player disconnected before answering anything.
    const active = participants.filter((p) => (p.answers ?? []).length > 0);

    // If nobody answered at all (e.g. all players wandered off before the first question),
    // fall back to all participants so the results page still renders meaningfully.
    const ranked = (active.length > 0 ? active : participants);
    const standings = ranked.map((p, idx) => ({
      id: p.id, user_id: p.user_id, score: p.score, total_time_ms: p.total_time_ms,
      answers: p.answers, rank: idx + 1,
      display_name: p.user.display_name ?? 'Player', avatar_url: p.user.avatar_url,
    }));

    let ratingChanges = null;
    if (match.is_official && standings.length >= 2) {
      const ratings = await prisma.arena_ratings.findMany({
        where: { user_id: { in: standings.map((s) => s.user_id) } },
      });
      ratingChanges = ratings.map((r) => ({
        user_id: r.user_id, rating: r.rating, deviation: r.deviation, volatility: r.volatility,
      }));
    }

    res.json({
      match: { id: match.id, is_official: match.is_official, quiz_id: match.quiz_id, quizzes: match.quiz },
      standings,
      ratingChanges,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/matches/:id/review
router.get('/matches/:id/review', requireAuth, async (req, res) => {
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id: req.params.id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const questions = await prisma.quiz_questions.findMany({
      where: { quiz_id: match.quiz_id },
      orderBy: { order_index: 'asc' },
    });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/matches/:id/live-leaderboard — used for initial seed on mount
router.get('/matches/:id/live-leaderboard', requireAuth, async (req, res) => {
  try {
    const participants = await prisma.arena_participants.findMany({
      where: { match_id: req.params.id },
      include: { user: { select: { display_name: true, avatar_url: true } } },
    });
    res.json(participants.map((p) => ({
      user_id: p.user_id,
      display_name: p.user?.display_name || 'Player',
      avatar_url: p.user?.avatar_url || null,
      score: p.score,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/leaderboard — global ratings
router.get('/leaderboard', async (req, res) => {
  try {
    const ratings = await prisma.arena_ratings.findMany({
      where: { matches_played: { gt: 0 } },
      orderBy: { rating: 'desc' },
      take: 100,
      include: { user: { select: { display_name: true, avatar_url: true } } },
    });
    res.json(ratings.map((r, idx) => ({
      rank: idx + 1, user_id: r.user_id,
      display_name: r.user.display_name ?? 'Player', avatar_url: r.user.avatar_url,
      rating: Math.round(r.rating), matches_played: r.matches_played,
      wins: r.wins, total_score: r.total_score,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/history — user's match history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const participations = await prisma.arena_participants.findMany({
      where: { user_id: req.user.id },
      include: { match: { include: { quiz: { select: { title: true, category: true } } } } },
      orderBy: { joined_at: 'desc' },
      take: 50,
    });
    const finished = participations.filter((p) => p.match.status === 'finished');
    const result = await Promise.all(
      finished.map(async (p) => {
        const allParticipants = await prisma.arena_participants.findMany({
          where: { match_id: p.match_id },
          orderBy: [{ score: 'desc' }, { total_time_ms: 'asc' }],
          select: { user_id: true },
        });
        const rankIdx = allParticipants.findIndex((ap) => ap.user_id === req.user.id);
        // rankIdx === -1 means the user's record was deleted (e.g. host left mid-game)
        // — skip this match from history to avoid showing Rank #0
        if (rankIdx === -1) return null;
        return {
          match_id: p.match_id, quiz_title: p.match.quiz.title,
          category: p.match.quiz.category, is_official: p.match.is_official,
          score: p.score, rank: rankIdx + 1, total_participants: allParticipants.length,
          finished_at: p.match.finished_at,
        };
      })
    );
    res.json(result.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
