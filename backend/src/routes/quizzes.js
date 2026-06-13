import express from 'express';
import { prisma } from '../db/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { slugify } from '../utils/slugify.js';

const router = express.Router();

// Helper: build correct_answer storage value (already done client-side, just pass through)
const buildQuestionData = (q, index) => ({
  question_text: q.question_text,
  question_type: q.question_type,
  options: q.question_type === 'numeric' ? [] : q.options,
  correct_answer: q.correct_answer,
  order_index: index,
  explanation: q.explanation || null,
});

// GET /api/quizzes — explore (approved only)
router.get('/', async (req, res) => {
  try {
    const quizzes = await prisma.quizzes.findMany({
      where: { status: 'approved' },
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { quiz_questions: true } } },
    });

    const result = quizzes.map((q) => ({
      id: q.id,
      slug: q.slug,
      title: q.title,
      description: q.description,
      category: q.category,
      difficulty: q.difficulty,
      created_at: q.created_at,
      time_limit_seconds: q.time_limit_seconds,
      questionCount: q._count.quiz_questions,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes/popular — home page, 6 most recent approved
router.get('/popular', async (req, res) => {
  try {
    const quizzes = await prisma.quizzes.findMany({
      where: { status: 'approved' },
      orderBy: { created_at: 'desc' },
      take: 6,
      include: { _count: { select: { quiz_questions: true } } },
    });

    const result = quizzes.map((q) => ({
      id: q.slug,
      title: q.title,
      description: q.description ?? '',
      category: q.category,
      difficulty: q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1),
      questionCount: q._count.quiz_questions,
      timeLimitSeconds: q.time_limit_seconds ?? 30,
      plays: 0,
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes/mine — creator's own quizzes (all statuses)
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const quizzes = await prisma.quizzes.findMany({
      where: { creator_id: req.user.id },
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { quiz_questions: true } } },
    });
    res.json(quizzes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes/review-queue?status=submitted|approved|rejected|all — admin only
router.get('/review-queue', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.query;

  try {
    let where;
    if (!status || status === 'submitted') {
      where = { status: 'submitted' };
    } else if (status === 'all') {
      where = {
        OR: [
          { status: { not: 'draft' } },
          { creator_id: req.user.id },
        ],
      };
    } else {
      where = { status }; // 'approved' | 'rejected'
    }

    const quizzes = await prisma.quizzes.findMany({
      where,
      orderBy: { created_at: 'asc' },
      select: {
        id: true, title: true, category: true, difficulty: true,
        status: true, description: true, created_at: true, creator_id: true,
      },
    });
    res.json(quizzes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes/by-id/:id — for edit form (owner or admin only)
router.get('/by-id/:id', requireAuth, async (req, res) => {
  try {
    const quiz = await prisma.quizzes.findUnique({
      where: { id: req.params.id },
      include: { quiz_questions: { orderBy: { order_index: 'asc' } } },
    });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const isOwner = quiz.creator_id === req.user.id;
    const isAdmin = req.user.roles.includes('admin');
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

    res.json(quiz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes/public-by-id/:id — single quiz with questions
router.get('/public-by-id/:id', async (req, res) => {
  try {
    const quiz = await prisma.quizzes.findUnique({
      where: { id: req.params.id },
      include: { quiz_questions: { orderBy: { order_index: 'asc' } } },
    });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    res.json(quiz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/quizzes/:slug — single quiz with questions (for playing)
router.get('/:slug', async (req, res) => {
  try {
    const quiz = await prisma.quizzes.findUnique({
      where: { slug: req.params.slug },
      include: { quiz_questions: { orderBy: { order_index: 'asc' } } },
    });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    res.json(quiz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quizzes — create (with questions)
router.post('/', requireAuth, async (req, res) => {
  const { title, description, category, difficulty, time_limit_seconds, status, questions } = req.body;

  if (!title || !category || !difficulty || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const slug = slugify(title);
    const quiz = await prisma.quizzes.create({
      data: {
        title,
        description,
        category,
        difficulty: difficulty.toLowerCase(),
        time_limit_seconds: Math.max(5, Math.min(10800, Number(time_limit_seconds) || 30)),
        status: status === 'submitted' ? 'submitted' : 'draft',
        slug,
        creator_id: req.user.id,
        quiz_questions: {
          create: questions.map((q, i) => buildQuestionData(q, i)),
        },
      },
      select: { id: true, slug: true },
    });

    res.json(quiz);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/quizzes/:id — edit (replace questions)
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { title, description, category, difficulty, time_limit_seconds, status, questions } = req.body;

  if (!title || !category || !difficulty || !Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const existing = await prisma.quizzes.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Quiz not found' });
    if (existing.creator_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your quiz' });
    }

    await prisma.$transaction([
      prisma.quiz_questions.deleteMany({ where: { quiz_id: id } }),
      prisma.quizzes.update({
        where: { id },
        data: {
          title,
          description,
          category,
          difficulty: difficulty.toLowerCase(),
          time_limit_seconds: Math.max(5, Math.min(10800, Number(time_limit_seconds) || 30)),
          status: status === 'submitted' ? 'submitted' : 'draft',
          quiz_questions: {
            create: questions.map((q, i) => buildQuestionData(q, i)),
          },
        },
      }),
    ]);

    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/quizzes/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const quiz = await prisma.quizzes.findUnique({ where: { id } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    const isOwner = quiz.creator_id === req.user.id;
    const isAdmin = req.user.roles.includes('admin');
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

    await prisma.quizzes.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quizzes/:id/withdraw — submitted/rejected -> draft
router.post('/:id/withdraw', requireAuth, async (req, res) => {
  try {
    const quiz = await prisma.quizzes.findUnique({ where: { id: req.params.id } });
    if (!quiz || quiz.creator_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });

    await prisma.quizzes.update({ where: { id: req.params.id }, data: { status: 'draft' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quizzes/:id/resubmit — draft/rejected -> submitted
router.post('/:id/resubmit', requireAuth, async (req, res) => {
  try {
    const quiz = await prisma.quizzes.findUnique({ where: { id: req.params.id } });
    if (!quiz || quiz.creator_id !== req.user.id) return res.status(403).json({ error: 'Not allowed' });

    await prisma.quizzes.update({ where: { id: req.params.id }, data: { status: 'submitted' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quizzes/:id/approve — admin
router.post('/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.quizzes.update({ where: { id: req.params.id }, data: { status: 'approved' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/quizzes/:id/reject — admin
router.post('/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.quizzes.update({ where: { id: req.params.id }, data: { status: 'rejected' } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;