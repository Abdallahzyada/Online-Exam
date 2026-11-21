import { Schema, model, type InferSchemaType } from "mongoose";

const diplomaSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    imageUrl: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true, index: true },
    // Number of PUBLISHED quizzes (what a student can actually open).
    quizzesCount: { type: Number, default: 0, min: 0 }
  },
  { timestamps: true, versionKey: false }
);

// Case-insensitive uniqueness, so "HTML" and "html" cannot both exist (matches the service check).
diplomaSchema.index({ title: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
diplomaSchema.index({ isActive: 1, createdAt: -1 });

export type DiplomaDocument = InferSchemaType<typeof diplomaSchema>;
export const DiplomaModel = model("Diploma", diplomaSchema);
