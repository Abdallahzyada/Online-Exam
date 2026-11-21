import { Schema, model, type InferSchemaType } from "mongoose";

const quizSchema = new Schema(
  {
    diplomaId: {
      type: Schema.Types.ObjectId,
      ref: "Diploma",
      required: true,
      index: true
    },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    imageUrl: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    durationMinutes: { type: Number, required: true, min: 1 },
    questionsCount: { type: Number, default: 0, min: 0 },
    passingScorePercentage: { type: Number, default: 50, min: 0, max: 100 },
    totalPoints: { type: Number, default: 0, min: 0 },
    instructions: { type: [String], default: [] },
    isPublished: { type: Boolean, default: false, index: true },
    // Soft delete: history and attempt snapshots keep pointing at the quiz (BR-06).
    isArchived: { type: Boolean, default: false }
  },
  { timestamps: true, versionKey: false }
);

quizSchema.index({ diplomaId: 1, isPublished: 1, createdAt: -1 });
quizSchema.index({ title: "text", description: "text" });
// A title is unique inside one diploma (case-insensitive); archived quizzes free their title.
quizSchema.index(
  { diplomaId: 1, title: 1 },
  { unique: true, collation: { locale: "en", strength: 2 }, partialFilterExpression: { isArchived: false } }
);

export type QuizDocument = InferSchemaType<typeof quizSchema>;
export const QuizModel = model("Quiz", quizSchema);
