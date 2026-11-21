// Seeds realistic catalog data (Diplomas + draft Quizzes). Safe to re-run: matches by title.
// Usage: npm run seed:catalog   (needs MONGO_URI in .env; builds first)
// Quizzes are seeded as DRAFTS: BR-07 forbids publishing before questions exist.
// Add questions (or import NDJSON) and then PATCH /api/v1/admin/quizzes/:id { "isPublished": true }.
import mongoose from 'mongoose';
import { DiplomaModel } from '../dist/modules/diploma/diploma.model.js';
import { QuizModel } from '../dist/modules/quiz/quiz.model.js';

const img = name => `https://placehold.co/600x400?text=${encodeURIComponent(name)}`;
const instructions = [
  'Read each question carefully before answering.',
  'The timer starts as soon as you press Start.',
  'You cannot go back after submitting.'
];

const catalog = [
  { title: 'Front-End Web Development', description: 'HTML, CSS, JavaScript and modern frameworks.', quizzes: [
    ['HTML', 'Front-End Quiz', 15], ['CSS', 'Front-End Quiz', 15], ['Bootstrap', 'Framework Quiz', 15],
    ['JavaScript', 'Front-End Quiz', 20], ['Angular', 'Framework Quiz', 20], ['React', 'Framework Quiz', 20]
  ] },
  { title: 'Back-End Web Development', description: 'Node.js, databases and API design.', quizzes: [
    ['Node.js', 'Back-End Quiz', 20], ['MongoDB', 'Database Quiz', 15]
  ] },
  { title: 'Android Development', description: 'Native Android apps with Kotlin.', quizzes: [['Kotlin', 'Mobile Quiz', 20]] },
  { title: 'Flutter Development', description: 'Cross-platform apps with Dart and Flutter.', quizzes: [['Dart', 'Mobile Quiz', 15]] },
  { title: 'UI & UX Design', description: 'Design principles, research and prototyping.', quizzes: [['Design Principles', 'Design Quiz', 15]] },
  { title: 'AI & ML Development', description: 'Machine learning foundations and practice.', quizzes: [['ML Basics', 'AI Quiz', 20]] }
];

const uri = process.env.MONGO_URI;
if (!uri) { console.error('MONGO_URI is not set'); process.exit(1); }

await mongoose.connect(uri);
try {
  let diplomasCreated = 0, quizzesCreated = 0;
  for (const entry of catalog) {
    let diploma = await DiplomaModel.findOne({ title: entry.title }).collation({ locale: 'en', strength: 2 });
    if (!diploma) {
      diploma = await DiplomaModel.create({ title: entry.title, description: entry.description, imageUrl: img(entry.title) });
      diplomasCreated += 1;
    }
    for (const [title, category, durationMinutes] of entry.quizzes) {
      const exists = await QuizModel.exists({ diplomaId: diploma._id, title, isArchived: { $ne: true } })
        .collation({ locale: 'en', strength: 2 });
      if (exists) continue;
      await QuizModel.create({
        diplomaId: diploma._id, title, category, durationMinutes, instructions,
        description: `${title} quiz`, imageUrl: img(title)
      });
      quizzesCreated += 1;
    }
  }
  console.log(`Catalog seed done: ${diplomasCreated} diplomas, ${quizzesCreated} draft quizzes created.`);
} finally {
  await mongoose.disconnect();
}
