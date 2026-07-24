import express from 'express';
import { prisma } from '../../db/prisma.js';
import { requireAuth, optionalAuth, requireAdmin } from '../../middleware/auth.js';
import { checkAndFinishMatch } from '../../services/matchLifecycle.js';

const router = express.Router();

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

// GET /api/arena/active — user's current active match
router.get('/active', requireAuth, async (req, res) => {
  try {
    const participation = await prisma.arena_participants.findFirst({
      where: { user_id: req.user.id },
      include: {
        match: {
          select: {
            id: true, room_code: true, status: true, is_official: true,
            quiz: { select: { title: true } },
          },
        },
      },
    });
    if (!participation) return res.json(null);
    const match = participation.match;
    if (!['waiting', 'countdown', 'playing'].includes(match.status)) return res.json(null);
    res.json({
      id: match.id, room_code: match.room_code, status: match.status,
      is_official: match.is_official, quizzes: { title: match.quiz.title },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches — create friendly match
router.post('/matches', requireAuth, async (req, res) => {
  const { quiz_id } = req.body;
  if (!quiz_id) return res.status(400).json({ error: 'quiz_id required' });
  try {
    const room_code = generateRoomCode();
    const match = await prisma.arena_matches.create({
      data: {
        quiz_id, host_id: req.user.id, room_code, status: 'waiting',
        arena_participants: { create: { user_id: req.user.id, is_ready: true } },
      },
      select: { id: true, room_code: true },
    });
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/join — join via room code
router.post('/matches/join', requireAuth, async (req, res) => {
  const { room_code } = req.body;
  if (!room_code) return res.status(400).json({ error: 'room_code required' });
  try {
    const match = await prisma.arena_matches.findUnique({
      where: { room_code: room_code.toUpperCase().trim() },
      include: { _count: { select: { arena_participants: true } } },
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (!match.is_official && match.status !== 'waiting') return res.status(400).json({ error: 'Match has already started' });
    if (match.is_official && !['waiting', 'playing'].includes(match.status)) return res.status(400).json({ error: 'War has already finished' });
    if (match._count.arena_participants >= match.max_players) return res.status(400).json({ error: 'Match is full' });

    const existing = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: match.id, user_id: req.user.id } },
    });
    if (!existing) {
      await prisma.arena_participants.create({
        data: {
          match_id: match.id, user_id: req.user.id,
          is_ready: match.is_official,
          player_phase: (match.is_official && match.status === 'playing') ? 'answering' : 'waiting',
          question_started_at: (match.is_official && match.status === 'playing') ? new Date() : null,
        },
      });
    }
    res.json({ id: match.id, status: match.status, max_players: match.max_players });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/matches/:id
router.get('/matches/:id', requireAuth, async (req, res) => {
  try {
    const match = await prisma.arena_matches.findUnique({
      where: { id: req.params.id },
      include: { quiz: { select: { id: true, title: true, category: true, difficulty: true, time_limit_seconds: true } } },
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    const { quiz, ...rest } = match;
    res.json({ ...rest, quizzes: quiz });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/matches/:id/participants
router.get('/matches/:id/participants', requireAuth, async (req, res) => {
  try {
    const participants = await prisma.arena_participants.findMany({
      where: { match_id: req.params.id },
      orderBy: { joined_at: 'asc' },
      include: { user: { select: { display_name: true, avatar_url: true } } },
    });
    res.json(participants.map((p) => ({
      id: p.id, user_id: p.user_id, is_ready: p.is_ready, joined_at: p.joined_at,
      profiles: { display_name: p.user.display_name, avatar_url: p.user.avatar_url },
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/ready
router.post('/matches/:id/ready', requireAuth, async (req, res) => {
  try {
    const participant = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: req.params.id, user_id: req.user.id } },
    });
    if (!participant) return res.status(404).json({ error: 'Not in match' });
    const updated = await prisma.arena_participants.update({
      where: { id: participant.id },
      data: { is_ready: !participant.is_ready },
    });
    req.app.get('io').to(req.params.id).emit('participants_updated');
    res.json({ is_ready: updated.is_ready });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/leave
router.post('/matches/:id/leave', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    await prisma.arena_participants.deleteMany({ where: { match_id: id, user_id: req.user.id } });
    if (match.host_id === req.user.id && match.status === 'waiting') {
      await prisma.arena_matches.delete({ where: { id } });
    }
    req.app.get('io').to(id).emit('participants_updated');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/start — host starts (waiting → countdown)
router.post('/matches/:id/start', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.host_id !== req.user.id) return res.status(403).json({ error: 'Only host can start' });
    await prisma.arena_matches.update({ where: { id }, data: { status: 'countdown', started_at: new Date() } });
    req.app.get('io').to(id).emit('match_updated', { status: 'countdown' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/begin-playing — countdown → playing (triggers server-side timer)
router.post('/matches/:id/begin-playing', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({
      where: { id },
      include: { quiz: { select: { time_limit_seconds: true, id: true } } },
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'countdown') return res.json({ status: match.status });

    const now = new Date();
    await prisma.$transaction([
      prisma.arena_matches.update({ where: { id }, data: { status: 'playing', started_at: now } }),
      prisma.arena_participants.updateMany({ where: { match_id: id }, data: { question_started_at: now, player_phase: 'answering' } }),
    ]);

    const io = req.app.get('io');
    io.to(id).emit('match_updated', { status: 'playing', startedAt: now });

    // Delegate end scheduling to WarEngine (handles all match types)
    const warEngine = req.app.get('warEngine');
    const timeLimit = match.quiz?.time_limit_seconds || 60;
    const endTime = new Date(now.getTime() + timeLimit * 1000);
    warEngine.scheduleMatchEnd(id, endTime, match.quiz_id);

    res.json({ status: 'playing', startedAt: now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/join-official — late join for official wars
router.post('/matches/:id/join-official', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (!match.is_official) return res.status(400).json({ error: 'Not an official match' });
    const existing = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: id, user_id: req.user.id } },
    });
    if (!existing) {
      await prisma.arena_participants.create({
        data: {
          match_id: id, user_id: req.user.id, is_ready: true,
          question_started_at: match.status === 'playing' ? new Date() : null,
          player_phase: 'answering',
        },
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
