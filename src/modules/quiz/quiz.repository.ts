import { QuizModel } from "./quiz.model.js";

export interface QuizListOptions {
  page: number;
  limit: number;
  search?: string | undefined;
  category?: string | undefined;
  /** Admin view: include drafts (unpublished quizzes). Archived quizzes are never listed. */
  includeUnpublished: boolean;
}

export class QuizRepository {
  create(data: Record<string, unknown>) {
    return QuizModel.create(data);
  }

  findById(id: string) {
    return QuizModel.findById(id);
  }

  findByTitleInDiploma(diplomaId: string, title: string) {
    return QuizModel.findOne({
      diplomaId,
      isArchived: { $ne: true },
      title: new RegExp(`^${escapeRegex(title)}$`, "i")
    });
  }

  updateById(id: string, data: Record<string, unknown>) {
    return QuizModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true
    });
  }

  async listByDiploma(diplomaId: string, options: QuizListOptions) {
    const filter: Record<string, unknown> = { diplomaId, isArchived: { $ne: true } };
    if (!options.includeUnpublished) filter.isPublished = true;
    if (options.category) {
      filter.category = new RegExp(`^${escapeRegex(options.category)}$`, "i");
    }
    if (options.search) {
      filter.$or = [
        { title: { $regex: escapeRegex(options.search), $options: "i" } },
        { description: { $regex: escapeRegex(options.search), $options: "i" } }
      ];
    }
    const [items, total] = await Promise.all([
      QuizModel.find(filter)
        .select("-__v")
        .sort({ createdAt: -1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit)
        .lean(),
      QuizModel.countDocuments(filter)
    ]);
    return { items, total };
  }

  /** Used when a diploma is archived: students must stop seeing / starting its quizzes. */
  unpublishAllByDiploma(diplomaId: string) {
    return QuizModel.updateMany({ diplomaId, isPublished: true }, { $set: { isPublished: false } });
  }

  /** Soft delete: unpublished + hidden, never removed (attempt history stays valid). */
  archiveById(id: string) {
    return QuizModel.findByIdAndUpdate(
      id,
      { isPublished: false, isArchived: true },
      { new: true }
    );
  }

  /**
   * Atomic counter sync for the Question module (Eng 3):
   * call with +1/+points on add, -1/-points on delete, and the difference on a points edit.
   * Returns the updated quiz so the caller can react to questionsCount reaching 0.
   */
  applyQuestionDelta(id: string, questionsDelta: number, pointsDelta: number) {
    return QuizModel.findByIdAndUpdate(
      id,
      { $inc: { questionsCount: questionsDelta, totalPoints: pointsDelta } },
      { new: true }
    );
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
