import express from 'express';
import { prisma } from '../db/prisma.js';
import crypto from 'crypto';
import { optionalAuth } from '../middleware/auth.js';

const router = express.Router();

// In-memory store for active quiz sessions
const activeSessions = new Map();

// POST /api/play/start
router.post('/start', optionalAuth, async (req, res) => {
  const { quizId } = req.body;
  try {
    const quiz = await prisma.quizzes.findUnique({
      where: { id: quizId }
    });
    
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
    
    const timeLimit = quiz.time_limit_seconds || 30; // default total time
    const sessionId = crypto.randomUUID();
    const startTime = Date.now();
    
    activeSessions.set(sessionId, {
      quizId,
      startTime,
      timeLimit,
      userId: req.user?.id || null
    });
    
    res.json({ sessionId, timeLimit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/play/:sessionId/timer
router.get('/:sessionId/timer', (req, res) => {
  const { sessionId } = req.params;
  const session = activeSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  const sendTime = () => {
    const session = activeSessions.get(sessionId);
    if (!session) {
      res.write(`data: ${JSON.stringify({ timeLeft: 0 })}\n\n`);
      res.end();
      return;
    }
    const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
    const timeLeft = Math.max(0, session.timeLimit - elapsed);
    res.write(`data: ${JSON.stringify({ timeLeft })}\n\n`);
    
    if (timeLeft <= 0) {
      clearInterval(interval);
      activeSessions.delete(sessionId);
      res.end();
    }
  };
  
  sendTime();
  const interval = setInterval(sendTime, 1000);
  
  req.on('close', () => {
    clearInterval(interval);
  });
});

// POST /api/play/:sessionId/submit
router.post('/:sessionId/submit', optionalAuth, async (req, res) => {
  const { sessionId } = req.params;
  const { answers: rawAnswers, quizId: fallbackQuizId } = req.body;
  
  try {
    const session = activeSessions.get(sessionId);
    const quizId = session ? session.quizId : fallbackQuizId; 
    
    if (!quizId) return res.status(400).json({ error: 'Missing quiz context' });

    // Fetch actual quiz questions to calculate score securely
    const quiz = await prisma.quizzes.findUnique({
      where: { id: quizId },
      include: { quiz_questions: true }
    });
    
    if (!quiz) return res.status(404).json({ error: 'Quiz not found' });

    let calculatedScore = 0;
    const processedAnswers = [];

    // Helper to compare answers securely
    const isAnswerCorrect = (type, correct, user) => {
      if (type === 'single_mcq') return Number(user) === Number(correct);
      if (type === 'multi_select' || type === 'multi_mcq') {
        if (!Array.isArray(user) || !Array.isArray(correct)) return false;
        if (user.length !== correct.length) return false;
        const sortedUser = [...user].sort();
        const sortedCorrect = [...correct].sort();
        return sortedCorrect.every((v, i) => v === sortedUser[i]);
      }
      if (type === 'numeric') return Number(user) === Number(correct);
      return false;
    };

    const answersList = Array.isArray(rawAnswers) ? rawAnswers : [];
    
    // Evaluate each submitted answer against the database truth
    for (const ans of answersList) {
      const q = quiz.quiz_questions.find((qq) => qq.id === ans.questionId);
      if (q) {
        const type = q.question_type || 'single_mcq';
        let dbCorrect = q.correct_answer;
        if ((type === 'multi_mcq' || type === 'multi_select') && !Array.isArray(dbCorrect)) {
          dbCorrect = [dbCorrect]; // normalize fallback
        }
        
        const isCorrect = isAnswerCorrect(type, dbCorrect, ans.selected);
        if (isCorrect) calculatedScore++;
        
        processedAnswers.push({
          questionId: ans.questionId,
          selected: ans.selected,
          correct: dbCorrect,
          isCorrect: isCorrect
        });
      }
    }

    if (session) activeSessions.delete(sessionId);

    const finalUserId = req.user?.id;
    if (finalUserId) {
      await prisma.quiz_attempts.create({
        data: {
          quiz_id: quizId,
          user_id: finalUserId,
          score: calculatedScore,
          total_questions: quiz.quiz_questions.length,
          answers: processedAnswers,
          completed_at: new Date()
        }
      });
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
