/**
 * Arena Socket — the entire real-time gameplay engine.
 *
 * Responsibilities:
 *  - Authenticate every socket connection via JWT cookie
 *  - Handle join_match: push full personalized game state to reconnecting players
 *  - Handle submit_answer: evaluate server-side, ack result, broadcast score
 *  - Handle next_question: advance player, push next question to their socket
 *  - Room management (join_room / leave_room for lobby)
 *
 * The server is the single source of truth.
 * timeTakenMs is computed from participant.question_started_at — never trusted from client.
 * Match end is triggered by the WarEngine scheduler — never by client.
 */

import jwt from 'jsonwebtoken';
import { parse as parseCookie } from 'cookie';
import { prisma } from '../db/prisma.js';
import { calculatePoints, isAnswerCorrect, getCorrectAnswer } from '../utils/quizLogic.js';
import { checkAndFinishMatch } from '../services/matchLifecycle.js';

export const setupArenaSocket = (io) => {
  // ── Authentication Middleware ──────────────────────────────────────────
  io.use((socket, next) => {
    try {
      const raw = socket.handshake.headers.cookie || '';
      const cookies = parseCookie(raw);
      const token = cookies.token;
      if (!token) return next(new Error('Not authenticated'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;

    // ── join_match ────────────────────────────────────────────────────────
    // Called on mount and on reconnect. Always pushes current state.
    socket.on('join_match', async ({ matchId }, ack) => {
      if (!matchId) return ack?.({ error: 'matchId required' });
      try {
        socket.join(matchId);
        socket.matchId = matchId;

        const match = await prisma.arena_matches.findUnique({
          where: { id: matchId },
          include: { quiz: { select: { time_limit_seconds: true, title: true } } },
        });
        if (!match) return ack?.({ error: 'Match not found' });

        const participant = await prisma.arena_participants.findUnique({
          where: { match_id_user_id: { match_id: matchId, user_id: userId } },
        });

        // Spectator (not a participant in an official match)
        if (!participant) {
          if (match.is_official) {
            socket.emit('game_state', { status: match.status, isSpectator: true, isOfficial: true });
          }
          return ack?.({ ok: true });
        }

        const gameState = await buildGameState(match, participant);
        socket.emit('game_state', gameState);
        ack?.({ ok: true });
      } catch (err) {
        console.error('[Socket] join_match error:', err);
        ack?.({ error: 'Server error' });
      }
    });

    // ── submit_answer ─────────────────────────────────────────────────────
    socket.on('submit_answer', async ({ selected }, ack) => {
      const matchId = socket.matchId;
      if (!matchId) return ack?.({ error: 'Not in a match' });

      try {
        const [match, participant] = await Promise.all([
          prisma.arena_matches.findUnique({
            where: { id: matchId },
            include: { quiz: { select: { time_limit_seconds: true } } },
          }),
          prisma.arena_participants.findUnique({
            where: { match_id_user_id: { match_id: matchId, user_id: userId } },
          }),
        ]);

        if (!match || match.status !== 'playing') return ack?.({ error: 'Match not in playing state' });
        if (!participant) return ack?.({ error: 'Not in this match' });

        // ── Idempotency guard ─────────────────────────────────────────────
        if (participant.player_phase !== 'answering') return ack?.({ error: 'Already answered' });

        const questions = await prisma.quiz_questions.findMany({
          where: { quiz_id: match.quiz_id },
          orderBy: { order_index: 'asc' },
        });
        const totalQuestions = questions.length;
        const globalTimeTotal = match.quiz.time_limit_seconds ?? (totalQuestions * 30);
        const globalElapsedSec = (Date.now() - new Date(match.started_at).getTime()) / 1000;

        if (globalElapsedSec >= globalTimeTotal) {
          await prisma.arena_participants.update({
            where: { id: participant.id },
            data: { player_phase: 'finished', finished_at: new Date() },
          });
          await checkAndFinishMatch(io, matchId, totalQuestions);
          return ack?.({ error: 'Time expired' });
        }

        const currentIndex = Math.min(Math.max(participant.current_question_index, 0), totalQuestions - 1);
        const currentQuestion = questions[currentIndex];
        const questionTimeSeconds = globalTimeTotal / totalQuestions;

        // ── Server-side timeTakenMs — client never computes this ──────────
        const questionStartedAt = participant.question_started_at
          ? new Date(participant.question_started_at).getTime()
          : new Date(match.started_at).getTime();
        const timeTakenMs = Math.max(0, Math.min(Date.now() - questionStartedAt, questionTimeSeconds * 1000));

        const correctAnswer = getCorrectAnswer(currentQuestion);
        const isCorrect = isAnswerCorrect(currentQuestion.question_type, correctAnswer, selected);
        const points = calculatePoints(isCorrect, timeTakenMs, questionTimeSeconds * 1000);

        const newAnswer = {
          question_id: currentQuestion.id,
          selected,
          is_correct: isCorrect,
          time_taken_ms: timeTakenMs,
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
            player_phase: 'revealed',            // blocks re-submission
          },
        });

        // Ack result to this player only
        ack?.({
          isCorrect,
          points,
          correctAnswer,
          newScore,
          explanation: currentQuestion.explanation ?? null,
        });

        // Broadcast live score to the entire room
        io.to(matchId).emit('score_update', { userId, newScore });

      } catch (err) {
        console.error('[Socket] submit_answer error:', err);
        ack?.({ error: 'Server error' });
      }
    });

    // ── next_question ─────────────────────────────────────────────────────
    socket.on('next_question', async (_, ack) => {
      const matchId = socket.matchId;
      if (!matchId) return ack?.({ error: 'Not in a match' });

      try {
        const [match, participant] = await Promise.all([
          prisma.arena_matches.findUnique({
            where: { id: matchId },
            include: { quiz: { select: { time_limit_seconds: true } } },
          }),
          prisma.arena_participants.findUnique({
            where: { match_id_user_id: { match_id: matchId, user_id: userId } },
          }),
        ]);

        if (!match || match.status !== 'playing') return ack?.({ error: 'Match not playing' });
        if (!participant) return ack?.({ error: 'Not in match' });
        if (participant.player_phase !== 'revealed') return ack?.({ error: 'Answer not yet revealed' });

        const questions = await prisma.quiz_questions.findMany({
          where: { quiz_id: match.quiz_id },
          orderBy: { order_index: 'asc' },
        });
        const totalQuestions = questions.length;
        const nextIndex = participant.current_question_index + 1;
        const now = new Date();

        if (nextIndex >= totalQuestions) {
          await prisma.arena_participants.update({
            where: { id: participant.id },
            data: { player_phase: 'finished', finished_at: now, current_question_index: nextIndex },
          });
          await checkAndFinishMatch(io, matchId, totalQuestions);
          return ack?.({ finished: true });
        }

        await prisma.arena_participants.update({
          where: { id: participant.id },
          data: { current_question_index: nextIndex, player_phase: 'answering', question_started_at: now },
        });

        const globalTimeTotal = match.quiz.time_limit_seconds ?? (totalQuestions * 30);
        const globalElapsedSec = (Date.now() - new Date(match.started_at).getTime()) / 1000;
        const globalTimeLeft = Math.max(0, Math.ceil(globalTimeTotal - globalElapsedSec));

        const nextQ = questions[nextIndex];
        // Push the next question directly to this player's socket
        socket.emit('question', {
          currentIndex: nextIndex,
          totalQuestions,
          phase: 'answering',
          question: {
            id: nextQ.id,
            question_text: nextQ.question_text,
            question_type: nextQ.question_type,
            options: nextQ.options,
            explanation: nextQ.explanation,
          },
          globalTimeLeft,
          myScore: participant.score,
        });

        ack?.({ finished: false });
      } catch (err) {
        console.error('[Socket] next_question error:', err);
        ack?.({ error: 'Server error' });
      }
    });

    // ── Lobby room management (unchanged behaviour) ────────────────────────
    socket.on('join_room', (matchId) => { socket.join(matchId); });
    socket.on('leave_room', (matchId) => { socket.leave(matchId); });

    socket.on('disconnect', () => {
      // All state is in PostgreSQL — player reconnects via join_match and gets state back
    });
  });
};

// ── Build personalised game state for a player on (re)connect ──────────────
async function buildGameState(match, participant) {
  if (match.status === 'finished')  return { status: 'finished' };
  if (match.status === 'waiting')   return { status: 'waiting' };
  if (match.status === 'countdown') return { status: 'countdown' };
  if (match.status !== 'playing')   return { status: match.status };

  const questions = await prisma.quiz_questions.findMany({
    where: { quiz_id: match.quiz_id },
    orderBy: { order_index: 'asc' },
  });
  const totalQuestions = questions.length;
  const globalTimeTotal = match.quiz.time_limit_seconds ?? (totalQuestions * 30);
  const globalElapsedSec = (Date.now() - new Date(match.started_at).getTime()) / 1000;
  const globalTimeLeft = Math.max(0, Math.ceil(globalTimeTotal - globalElapsedSec));
  const savedAnswers = participant.answers ?? [];
  const isFinished = participant.player_phase === 'finished'
    || savedAnswers.length >= totalQuestions
    || globalTimeLeft <= 0;

  if (isFinished) {
    return {
      status: 'playing', finished: true, myScore: participant.score,
      // Include startedAt + real remaining time so the client's countdown
      // keeps ticking correctly even after a page refresh.
      startedAt: match.started_at,
      globalTimeLeft, globalTimeTotal, totalQuestions, isOfficial: match.is_official,
    };
  }

  const currentIndex = Math.min(Math.max(participant.current_question_index, 0), totalQuestions - 1);
  const currentQ = questions[currentIndex];
  const phase = participant.player_phase;

  const questionData = {
    id: currentQ.id,
    question_text: currentQ.question_text,
    question_type: currentQ.question_type,
    options: currentQ.options,
    explanation: currentQ.explanation,
  };
  if (phase === 'revealed') {
    questionData.correct_answer = getCorrectAnswer(currentQ);
  }

  return {
    status: 'playing', finished: false,
    startedAt: match.started_at,      // client uses this for display arithmetic only
    currentIndex, totalQuestions, phase,
    question: questionData,
    globalTimeLeft, globalTimeTotal,
    myScore: participant.score,
    myAnswers: savedAnswers,
    isOfficial: match.is_official,
  };
}