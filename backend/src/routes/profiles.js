import express from 'express';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET /api/profiles/me — full profile data
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        display_name: true,
        avatar_url: true,
        name_changes_remaining: true,
        created_at: true,
      },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/profiles/me/name — update display name
router.put('/me/name', requireAuth, async (req, res) => {
  const { display_name } = req.body;
  const trimmed = (display_name ?? '').trim();

  if (trimmed.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
  if (trimmed.length > 30) return res.status(400).json({ error: 'Name must be 30 characters or less' });

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (user.name_changes_remaining <= 0) {
      return res.status(400).json({ error: "You've used all your name changes" });
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        display_name: trimmed,
        name_changes_remaining: user.name_changes_remaining - 1,
      },
      select: { display_name: true, name_changes_remaining: true },
    });

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profiles/me/stats
router.get('/me/stats', requireAuth, async (req, res) => {
  try {
    const [quizzesCreated, attempts, rating] = await Promise.all([
      prisma.quizzes.count({ where: { creator_id: req.user.id } }),
      prisma.quiz_attempts.findMany({
        where: { user_id: req.user.id },
        select: { score: true, total_questions: true },
      }),
      prisma.arena_ratings.findUnique({ where: { user_id: req.user.id } }),
    ]);

    const totalScore = attempts.reduce((s, a) => s + a.score, 0);
    const totalQs = attempts.reduce((s, a) => s + a.total_questions, 0);

    res.json({
      quizzesCreated,
      quizzesTaken: attempts.length,
      avgAccuracy: totalQs > 0 ? Math.round((totalScore / totalQs) * 100) : 0,
      glickoRating: Math.round(rating?.rating ?? 1500),
      glickoDeviation: Math.round(rating?.deviation ?? 350),
      officialMatches: rating?.matches_played ?? 0,
      officialWins: rating?.wins ?? 0,
      officialScore: rating?.total_score ?? 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profiles/me/quiz-history
router.get('/me/quiz-history', requireAuth, async (req, res) => {
  try {
    const attempts = await prisma.quiz_attempts.findMany({
      where: { user_id: req.user.id },
      orderBy: { created_at: 'desc' },
      take: 50,
      include: { quiz: { select: { id: true, title: true, category: true, difficulty: true } } },
    });

    const result = attempts.map((a) => ({
      id: a.id,
      score: a.score,
      total_questions: a.total_questions,
      completed_at: a.completed_at,
      created_at: a.created_at,
      quiz_id: a.quiz_id,
      answers: a.answers,
      quiz: a.quiz,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/profiles/me/arena-history
router.get('/me/arena-history', requireAuth, async (req, res) => {
  try {
    const participations = await prisma.arena_participants.findMany({
      where: { user_id: req.user.id },
      orderBy: { joined_at: 'desc' },
      take: 50,
      include: {
        match: {
          select: {
            id: true, room_code: true, status: true, quiz_id: true,
            started_at: true, finished_at: true, is_official: true,
            quiz: { select: { title: true } },
          },
        },
      },
    });

    if (!participations.length) return res.json([]);

    const matchIds = [...new Set(participations.map((p) => p.match_id))];
    const allParticipants = await prisma.arena_participants.findMany({
      where: { match_id: { in: matchIds } },
      select: { match_id: true, user_id: true, score: true, answers: true },
    });

    const matchInfo = new Map();
    matchIds.forEach((mid) => {
      const players = allParticipants.filter(
        (p) => p.match_id === mid && (p.answers ?? []).length > 0
      );
      const sorted = [...players].sort((a, b) => b.score - a.score);
      matchInfo.set(mid, {
        playerCount: players.length,
        winnerId: sorted.length >= 2 ? sorted[0].user_id : null,
      });
    });

    const result = participations.map((p) => {
      const info = matchInfo.get(p.match_id);
      return {
        match_id: p.match_id,
        score: p.score,
        answers: p.answers,
        finished_at: p.finished_at,
        joined_at: p.joined_at,
        match: {
          room_code: p.match.room_code,
          status: p.match.status,
          quiz_id: p.match.quiz_id,
          is_official: p.match.is_official,
        },
        quizTitle: p.match.quiz?.title ?? 'Unknown Quiz',
        playerCount: info?.playerCount ?? 0,
        isWinner: info?.winnerId === req.user.id,
        answeredCount: (p.answers ?? []).length,
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;