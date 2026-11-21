import { QuizModel } from "./quiz.model.js";

export class QuizRepository {
  create(data: Record<string, unknown>) {
    return QuizModel.create(data);
  }

  findById(id: string) {
    return QuizModel.findById(id);
  }

  updateById(id: string, data: Record<string, unknown>) {
    return QuizModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true
    });
  }

  async listByDiploma(diplomaId: string, page: number, limit: number) {
    const filter = { diplomaId, isPublished: true };
    const [items, total] = await Promise.all([
      QuizModel.find(filter)
        .select("-__v")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      QuizModel.countDocuments(filter)
    ]);
    return { items, total };
  }

  countByDiploma(diplomaId: string) {
    return QuizModel.countDocuments({ diplomaId });
  }

  async deleteById(id: string) {
    return QuizModel.findByIdAndDelete(id);
  }

  async archiveById(id: string) {
    return QuizModel.findByIdAndUpdate(
      id,
      { isPublished: false },
      { new: true }
    );
  }
}
