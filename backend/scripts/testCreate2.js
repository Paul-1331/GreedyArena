import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) return console.log("No user found");
  
  try {
    const quiz = await prisma.quizzes.create({
      data: {
        title: "Test Quiz",
        description: "Test Desc",
        category: "Math",
        difficulty: "easy",
        time_limit_seconds: 60,
        status: "draft",
        slug: "test-quiz-1234",
        creator_id: user.id,
        quiz_questions: {
          create: [{
            question_text: "1+1?",
            question_type: "single_mcq",
            options: ["1", "2"],
            correct_answer: 1,
            order_index: 0
          }]
        }
      }
    });
    console.log("Success:", quiz);
  } catch (err) {
    console.error("Error creating quiz:", err);
  }
}

main().finally(() => prisma.$disconnect());
