export const calculatePoints = (isCorrect, timeTakenMs, maxTimeMs) => {
  if (!isCorrect) return 0;
  const speedRatio = Math.max(0, 1 - timeTakenMs / maxTimeMs);
  return Math.round(10 + speedRatio * 10);
};

export const isAnswerCorrect = (questionType, correctAnswer, userAnswer) => {
  if (questionType === 'single_mcq') return userAnswer === correctAnswer;
  if (questionType === 'multi_select') {
    const correct = [...(correctAnswer ?? [])].sort((a, b) => a - b);
    const selected = [...(Array.isArray(userAnswer) ? userAnswer : [])].sort((a, b) => a - b);
    return correct.length === selected.length && correct.every((v, i) => v === selected[i]);
  }
  if (questionType === 'numeric') return Number(userAnswer) === Number(correctAnswer);
  return false;
};

export const getCorrectAnswer = (q) => {
  const ca = q.correct_answer;
  if (Array.isArray(ca)) return ca;
  if (typeof ca === 'number') return ca;
  return 0;
};