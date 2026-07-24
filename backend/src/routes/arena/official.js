import express from 'express';
import { prisma } from '../../db/prisma.js';
import { requireAuth, optionalAuth, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

// GET /api/arena/official — public list of active/upcoming Wars
router.get('/official', optionalAuth, async (req, res) => {
  try {
    const matches = await prisma.arena_matches.findMany({
      where: { is_official: true, status: { in: ['waiting', 'countdown', 'playing'] } },
      orderBy: { scheduled_start_at: 'asc' },
      include: {
        quiz: { select: { title: true, category: true, difficulty: true } },
        _count: { select: { arena_participants: true } },
        arena_participants: req.user ? { where: { user_id: req.user.id }, select: { id: true } } : false,
      },
    });
    res.json(matches.map((m) => ({
      id: m.id, room_code: m.room_code, status: m.status,
      scheduled_start_at: m.scheduled_start_at, quiz_id: m.quiz_id,
      host_id: m.host_id, max_players: m.max_players, created_at: m.created_at,
      quizzes: m.quiz, participant_count: m._count.arena_participants,
      has_joined: req.user ? m.arena_participants.length > 0 : false,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/official-matches — admin list
router.get('/official-matches', requireAuth, async (req, res) => {
  try {
    const matches = await prisma.arena_matches.findMany({
      where: { is_official: true, status: { in: ['waiting', 'playing'] } },
      include: {
        quiz: { select: { title: true, category: true, difficulty: true, time_limit_seconds: true } },
        _count: { select: { arena_participants: true } },
        arena_participants: { where: { user_id: req.user.id }, select: { id: true } },
      },
      orderBy: { scheduled_start_at: 'asc' },
    });
    res.json(matches.map((m) => ({
      ...m,
      is_registered: m.arena_participants.length > 0,
      arena_participants: undefined,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/official-matches — admin creates a War
router.post('/official-matches', requireAuth, requireAdmin, async (req, res) => {
  const { quiz_id, scheduled_start_at, max_players, min_rating, max_rating, allow_unrated } = req.body;
  if (!quiz_id || !scheduled_start_at) return res.status(400).json({ error: 'Missing required fields' });
  try {
    const room_code = generateRoomCode();
    const match = await prisma.arena_matches.create({
      data: {
        quiz_id, host_id: req.user.id, room_code, status: 'waiting',
        is_official: true, scheduled_start_at: new Date(scheduled_start_at),
        max_players: max_players || 50, min_rating, max_rating,
        allow_unrated: allow_unrated ?? true, join_cutoff_ratio: 0.75,
      },
      select: { id: true, room_code: true, scheduled_start_at: true, quiz_id: true },
    });
    const warEngine = req.app.get('warEngine');
    if (warEngine) warEngine.scheduleWar(match);
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/arena/matches/:id — admin cancels a War
router.delete('/matches/:id', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'waiting') return res.status(400).json({ error: 'Can only cancel waiting wars' });
    const warEngine = req.app.get('warEngine');
    if (warEngine) warEngine.cancelWar(id);
    await prisma.arena_participants.deleteMany({ where: { match_id: id } });
    await prisma.arena_matches.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/register — register for a War
router.post('/matches/:id/register', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match || !match.is_official) return res.status(404).json({ error: 'War not found' });
    if (match.status !== 'waiting') return res.status(400).json({ error: 'War has already started' });
    const existing = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: id, user_id: req.user.id } },
    });
    if (!existing) {
      await prisma.arena_participants.create({
        data: { match_id: id, user_id: req.user.id, is_ready: true, player_phase: 'waiting' },
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
