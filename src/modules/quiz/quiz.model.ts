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
    isPublished: { type: Boolean, default: false, index: true }
  },
  { timestamps: true, versionKey: false }
);

quizSchema.index({ diplomaId: 1, isPublished: 1, createdAt: -1 });
quizSchema.index({ title: "text", description: "text" });

export type QuizDocument = InferSchemaType<typeof quizSchema>;
export const QuizModel = model("Quiz", quizSchema);
