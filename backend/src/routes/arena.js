import express from 'express';
import { prisma } from '../db/prisma.js';
import { requireAuth, optionalAuth, requireAdmin } from '../middleware/auth.js';
import {
  calculatePoints,
  isAnswerCorrect,
  getCorrectAnswer,
} from '../utils/quizLogic.js';
import { computeMatchRatings } from '../utils/glicko2.js';

const router = express.Router();

// GET /api/arena/official
router.get('/official', optionalAuth, async (req, res) => {
  try {
    const matches = await prisma.arena_matches.findMany({
      where: {
        is_official: true,
        status: { in: ['waiting', 'countdown', 'playing'] }
      },
      orderBy: { scheduled_start_at: 'asc' },
      include: {
        quiz: { select: { title: true, category: true, difficulty: true } },
        _count: { select: { arena_participants: true } },
        arena_participants: req.user ? {
          where: { user_id: req.user.id },
          select: { id: true }
        } : false
      }
    });

    const result = matches.map(m => ({
      id: m.id,
      room_code: m.room_code,
      status: m.status,
      scheduled_start_at: m.scheduled_start_at,
      quiz_id: m.quiz_id,
      host_id: m.host_id,
      max_players: m.max_players,
      created_at: m.created_at,
      quizzes: m.quiz,
      participant_count: m._count.arena_participants,
      has_joined: req.user ? m.arena_participants.length > 0 : false
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

async function checkAndFinishMatch(io, matchId, totalQuestions) {
  const match = await prisma.arena_matches.findUnique({ where: { id: matchId } });
  if (!match || match.status === 'finished') return;

  const participants = await prisma.arena_participants.findMany({
    where: { match_id: matchId },
    select: { user_id: true, score: true, player_phase: true, answers: true },
  });

  const allDone = participants.every((p) => {
    const answers = p.answers ?? [];
    return p.player_phase === 'finished' || answers.length >= totalQuestions;
  });

  if (!allDone) return;

  await prisma.arena_matches.update({
    where: { id: matchId },
    data: { status: 'finished', finished_at: new Date() },
  });

  // Glicko-2 rating updates — official matches with 2+ participants only
  if (match.is_official && participants.length >= 2) {
    try {
      const userIds = participants.map((p) => p.user_id);
      const existingRatings = await prisma.arena_ratings.findMany({
        where: { user_id: { in: userIds } },
      });
      const ratingMap = new Map(existingRatings.map((r) => [r.user_id, r]));

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
    } catch (err) {
      console.error('Failed to update ratings:', err);
    }
  }

  io.to(matchId).emit('match_finished');
}

// GET /api/arena/active — user's current active match
router.get('/active', requireAuth, async (req, res) => {
  try {
    const participation = await prisma.arena_participants.findFirst({
      where: { user_id: req.user.id },
      include: {
        match: {
          select: {
            id: true,
            room_code: true,
            status: true,
            is_official: true,
            quiz: { select: { title: true } },
          },
        },
      },
    });

    if (!participation) return res.json(null);

    const match = participation.match;
    if (!['waiting', 'countdown', 'playing'].includes(match.status)) {
      return res.json(null);
    }

    res.json({
      id: match.id,
      room_code: match.room_code,
      status: match.status,
      is_official: match.is_official,
      quizzes: { title: match.quiz.title },
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
        quiz_id,
        host_id: req.user.id,
        room_code,
        status: 'waiting',
        arena_participants: {
          create: { user_id: req.user.id, is_ready: true },
        },
      },
      select: { id: true, room_code: true },
    });
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/official-matches — create official match (admin)
router.post('/official-matches', requireAuth, requireAdmin, async (req, res) => {
  const { quiz_id, scheduled_start_at, max_players, min_rating, max_rating, allow_unrated } = req.body;
  if (!quiz_id || !scheduled_start_at) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const room_code = generateRoomCode();
    const match = await prisma.arena_matches.create({
      data: {
        quiz_id,
        host_id: req.user.id,
        room_code,
        status: 'waiting',
        is_official: true,
        scheduled_start_at: new Date(scheduled_start_at),
        max_players: max_players || 50,
        min_rating,
        max_rating,
        allow_unrated: allow_unrated ?? true,
        join_cutoff_ratio: 0.75,
      },
      select: { id: true, room_code: true, scheduled_start_at: true, quiz_id: true },
    });
    const warEngine = req.app.get('warEngine');
    if (warEngine) {
      warEngine.scheduleWar(match);
    }
    res.json(match);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/official-matches — list active and upcoming official matches
router.get('/official-matches', async (req, res) => {
  try {
    const matches = await prisma.arena_matches.findMany({
      where: {
        is_official: true,
        status: { in: ['waiting', 'playing'] },
      },
      include: {
        quiz: { select: { title: true, category: true, difficulty: true, time_limit_seconds: true } },
        _count: { select: { arena_participants: true } },
      },
      orderBy: { scheduled_start_at: 'asc' },
    });
    res.json(matches);
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
    
    // For casual matches, must be waiting. For official wars, can join while playing!
    if (!match.is_official && match.status !== 'waiting') {
      return res.status(400).json({ error: 'Match has already started' });
    }
    if (match.is_official && !['waiting', 'playing'].includes(match.status)) {
      return res.status(400).json({ error: 'War has already finished' });
    }

    if (match._count.arena_participants >= match.max_players) {
      return res.status(400).json({ error: 'Match is full' });
    }

    // TODO: Add rating checks here if min_rating / max_rating are set

    const existing = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: match.id, user_id: req.user.id } },
    });

    if (!existing) {
      await prisma.arena_participants.create({
        data: { 
          match_id: match.id, 
          user_id: req.user.id,
          // If joining an official war late, they are automatically answering
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

// GET /api/arena/matches/:id — match + quiz details
router.get('/matches/:id', requireAuth, async (req, res) => {
  try {
    const match = await prisma.arena_matches.findUnique({
      where: { id: req.params.id },
      include: {
        quiz: {
          select: { id: true, title: true, category: true, difficulty: true, time_limit_seconds: true },
        },
      },
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
      include: {
        user: { select: { display_name: true, avatar_url: true } },
      },
    });

    const result = participants.map((p) => ({
      id: p.id,
      user_id: p.user_id,
      is_ready: p.is_ready,
      joined_at: p.joined_at,
      profiles: {
        display_name: p.user.display_name,
        avatar_url: p.user.avatar_url,
      },
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/ready — toggle ready
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

    const io = req.app.get('io');
    io.to(req.params.id).emit('participants_updated');

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

    await prisma.arena_participants.deleteMany({
      where: { match_id: id, user_id: req.user.id },
    });

    if (match.host_id === req.user.id && match.status === 'waiting') {
      await prisma.arena_matches.delete({ where: { id } });
    }

    const io = req.app.get('io');
    io.to(id).emit('participants_updated');

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/start — host starts (waiting -> countdown)
router.post('/matches/:id/start', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.host_id !== req.user.id) return res.status(403).json({ error: 'Only host can start' });

    await prisma.arena_matches.update({
      where: { id },
      data: { status: 'countdown', started_at: new Date() },
    });

    const io = req.app.get('io');
    io.to(id).emit('match_updated', { status: 'countdown' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/begin-playing — countdown -> playing
router.post('/matches/:id/begin-playing', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });
    if (match.status !== 'countdown') {
      return res.json({ status: match.status });
    }

    const now = new Date();
    await prisma.$transaction([
      prisma.arena_matches.update({
        where: { id },
        data: { status: 'playing', started_at: now },
      }),
      prisma.arena_participants.updateMany({
        where: { match_id: id },
        data: { question_started_at: now, player_phase: 'answering' },
      }),
    ]);

    const io = req.app.get('io');
    io.to(id).emit('match_updated', { status: 'playing' });

    res.json({ status: 'playing' });
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
      const now = new Date();
      await prisma.arena_participants.create({
        data: {
          match_id: id,
          user_id: req.user.id,
          is_ready: true,
          question_started_at: match.status === 'playing' ? now : null,
          player_phase: 'answering',
        },
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/matches/:id/play-state
router.get('/matches/:id/play-state', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const match = await prisma.arena_matches.findUnique({
      where: { id },
      include: { quiz: { select: { time_limit_seconds: true } } },
    });
    if (!match) return res.status(404).json({ error: 'Match not found' });

    if (match.status === 'finished') {
      return res.json({ status: 'finished' });
    }
    if (match.status !== 'playing') {
      return res.json({ status: match.status });
    }

    const participant = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: id, user_id: req.user.id } },
    });
    if (!participant) {
      if (match.is_official) {
        return res.json({ status: match.status, isSpectator: true, isOfficial: true });
      }
      return res.status(403).json({ error: 'Not in this match' });
    }

    const questions = await prisma.quiz_questions.findMany({
      where: { quiz_id: match.quiz_id },
      orderBy: { order_index: 'asc' },
    });
    const totalQuestions = questions.length;
    if (totalQuestions === 0) {
      return res.json({ status: 'playing', noQuestions: true });
    }

    const questionTimeSeconds = match.quiz.time_limit_seconds ?? 30;
    const globalTimeTotal = totalQuestions * questionTimeSeconds;

    const globalElapsedSec = (Date.now() - new Date(match.started_at).getTime()) / 1000;
    const globalRemaining = Math.max(0, globalTimeTotal - globalElapsedSec);

    const savedAnswers = participant.answers ?? [];

    // Finished: global time up, or all questions answered, or already marked finished
    if (globalRemaining <= 0 || participant.player_phase === 'finished' || savedAnswers.length >= totalQuestions) {
      if (participant.player_phase !== 'finished') {
        await prisma.arena_participants.update({
          where: { id: participant.id },
          data: { player_phase: 'finished', finished_at: new Date() },
        });
        await checkAndFinishMatch(req.app.get('io'), id, totalQuestions);
      }
      return res.json({
        status: 'playing',
        finished: true,
        myScore: participant.score,
        globalTimeLeft: 0,
        globalTimeTotal,
        totalQuestions,
      });
    }

    const currentIndex = Math.min(Math.max(participant.current_question_index, 0), totalQuestions - 1);
    const phase = participant.player_phase; // 'answering' | 'revealed'

    const currentQuestion = questions[currentIndex];
    const responseQuestion = {
      id: currentQuestion.id,
      question_text: currentQuestion.question_text,
      question_type: currentQuestion.question_type,
      options: currentQuestion.options,
      explanation: currentQuestion.explanation,
    };

    if (phase === 'revealed') {
      responseQuestion.correct_answer = currentQuestion.correct_answer;
    }

    res.json({
      status: 'playing',
      finished: false,
      currentIndex,
      totalQuestions,
      phase,
      question: responseQuestion,
      questionTimeSeconds,
      globalTimeLeft: Math.ceil(globalRemaining),
      globalTimeTotal,
      myScore: participant.score,
      myAnswers: savedAnswers,
      isOfficial: match.is_official,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/answer
router.post('/matches/:id/answer', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { selected, timeTakenMs } = req.body;

  try {
    const match = await prisma.arena_matches.findUnique({
      where: { id },
      include: { quiz: { select: { time_limit_seconds: true } } },
    });
    if (!match || match.status !== 'playing') {
      return res.status(400).json({ error: 'Match not in playing state' });
    }

    const participant = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: id, user_id: req.user.id } },
    });
    if (!participant) return res.status(403).json({ error: 'Not in this match' });

    if (participant.player_phase !== 'answering') {
      return res.status(400).json({ error: 'Already answered this question' });
    }

    const questionTimeSeconds = match.quiz.time_limit_seconds ?? 30;
    const questions = await prisma.quiz_questions.findMany({
      where: { quiz_id: match.quiz_id },
      orderBy: { order_index: 'asc' },
    });
    const totalQuestions = questions.length;
    const globalTimeTotal = totalQuestions * questionTimeSeconds;
    const globalElapsedSec = (Date.now() - new Date(match.started_at).getTime()) / 1000;

    if (globalElapsedSec >= globalTimeTotal) {
      await prisma.arena_participants.update({
        where: { id: participant.id },
        data: { player_phase: 'finished', finished_at: new Date() },
      });
      await checkAndFinishMatch(req.app.get('io'), id, totalQuestions);
      return res.status(400).json({ error: 'Global time has expired' });
    }

    const currentIndex = Math.min(Math.max(participant.current_question_index, 0), totalQuestions - 1);
    const currentQuestion = questions[currentIndex];

    const correct = getCorrectAnswer(currentQuestion);
    const isCorrect = isAnswerCorrect(currentQuestion.question_type, correct, selected);

    const clampedTimeTakenMs = Math.max(0, Math.min(Number(timeTakenMs) || 0, questionTimeSeconds * 1000));
    const points = calculatePoints(isCorrect, clampedTimeTakenMs, questionTimeSeconds * 1000);

    const newAnswer = {
      question_id: currentQuestion.id,
      selected,
      is_correct: isCorrect,
      time_taken_ms: clampedTimeTakenMs,
      points,
    };

    const savedAnswers = participant.answers ?? [];
    const updatedAnswers = [...savedAnswers, newAnswer];
    const newScore = participant.score + points;
    const totalTimeMs = updatedAnswers.reduce((s, a) => s + a.time_taken_ms, 0);

    await prisma.arena_participants.update({
      where: { id: participant.id },
      data: {
        score: newScore,
        total_time_ms: totalTimeMs,
        answers: updatedAnswers,
        player_phase: 'revealed',
      },
    });

    const io = req.app.get('io');
    io.to(id).emit('score_updated');

    res.json({
      isCorrect,
      points,
      correctAnswer: correct,
      newScore,
      explanation: currentQuestion.explanation,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/next
router.post('/matches/:id/next', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match || match.status !== 'playing') {
      return res.status(400).json({ error: 'Match not in playing state' });
    }

    const participant = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: id, user_id: req.user.id } },
    });
    if (!participant) return res.status(403).json({ error: 'Not in this match' });
    if (participant.player_phase !== 'revealed') {
      return res.status(400).json({ error: 'Current question not yet revealed' });
    }

    const totalQuestions = await prisma.quiz_questions.count({ where: { quiz_id: match.quiz_id } });
    const nextIndex = participant.current_question_index + 1;

    if (nextIndex >= totalQuestions) {
      await prisma.arena_participants.update({
        where: { id: participant.id },
        data: { player_phase: 'finished', finished_at: new Date(), current_question_index: nextIndex },
      });

      await checkAndFinishMatch(req.app.get('io'), id, totalQuestions);

      return res.json({ finished: true });
    }

    await prisma.arena_participants.update({
      where: { id: participant.id },
      data: {
        current_question_index: nextIndex,
        player_phase: 'answering',
        question_started_at: new Date(),
      },
    });

    res.json({ finished: false, nextIndex });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/arena/matches/:id/finish — global timer expired client-side
router.post('/matches/:id/finish', requireAuth, async (req, res) => {
  const { id } = req.params;

  try {
    const match = await prisma.arena_matches.findUnique({ where: { id } });
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const participant = await prisma.arena_participants.findUnique({
      where: { match_id_user_id: { match_id: id, user_id: req.user.id } },
    });
    if (!participant) return res.status(403).json({ error: 'Not in this match' });

    if (participant.player_phase !== 'finished') {
      await prisma.arena_participants.update({
        where: { id: participant.id },
        data: { player_phase: 'finished', finished_at: new Date() },
      });
    }

    const totalQuestions = await prisma.quiz_questions.count({ where: { quiz_id: match.quiz_id } });
    await checkAndFinishMatch(req.app.get('io'), id, totalQuestions);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    const active = participants.filter((p) => (p.answers ?? []).length > 0);

    const standings = active.map((p, idx) => ({
      id: p.id,
      user_id: p.user_id,
      score: p.score,
      total_time_ms: p.total_time_ms,
      answers: p.answers,
      rank: idx + 1,
      display_name: p.user.display_name ?? 'Player',
      avatar_url: p.user.avatar_url,
    }));

    let ratingChanges = null;
    if (match.is_official && standings.length >= 2) {
      const userIds = standings.map((s) => s.user_id);
      const ratings = await prisma.arena_ratings.findMany({
        where: { user_id: { in: userIds } },
      });
      ratingChanges = ratings.map((r) => ({
        user_id: r.user_id,
        rating: r.rating,
        deviation: r.deviation,
        volatility: r.volatility,
      }));
    }

    res.json({
      match: {
        id: match.id,
        is_official: match.is_official,
        quiz_id: match.quiz_id,
        quizzes: { title: match.quiz.title, category: match.quiz.category },
      },
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

// GET /api/arena/leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const ratings = await prisma.arena_ratings.findMany({
      where: { matches_played: { gt: 0 } },
      orderBy: { rating: 'desc' },
      take: 100,
      include: { user: { select: { display_name: true, avatar_url: true } } },
    });

    const result = ratings.map((r, idx) => ({
      rank: idx + 1,
      user_id: r.user_id,
      display_name: r.user.display_name ?? 'Player',
      avatar_url: r.user.avatar_url,
      rating: Math.round(r.rating),
      matches_played: r.matches_played,
      wins: r.wins,
      total_score: r.total_score,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/arena/history
router.get('/history', requireAuth, async (req, res) => {
  try {
    const participations = await prisma.arena_participants.findMany({
      where: { user_id: req.user.id },
      include: {
        match: {
          include: { quiz: { select: { title: true, category: true } } },
        },
      },
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
        const rank = allParticipants.findIndex((ap) => ap.user_id === req.user.id) + 1;

        return {
          match_id: p.match_id,
          quiz_title: p.match.quiz.title,
          category: p.match.quiz.category,
          is_official: p.match.is_official,
          score: p.score,
          rank,
          total_participants: allParticipants.length,
          finished_at: p.match.finished_at,
        };
      })
    );

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;