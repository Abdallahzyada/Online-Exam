import { DiplomaModel } from "./diploma.model.js";

export class DiplomaRepository {
  create(data: { title: string; description: string; imageUrl: string }) {
    return DiplomaModel.create(data);
  }

  findById(id: string) {
    return DiplomaModel.findById(id);
  }

  findByTitle(title: string) {
    return DiplomaModel.findOne({
      title: new RegExp(`^${escapeRegex(title)}$`, "i"),
    });
  }

  updateById(id: string, data: Record<string, unknown>) {
    return DiplomaModel.findByIdAndUpdate(id, data, {
      new: true,
      runValidators: true,
    });
  }

  async list(options: {
    page: number;
    limit: number;
    search?: string;
    includeInactive: boolean;
  }) {
    const filter: Record<string, unknown> = {};
    if (!options.includeInactive) filter.isActive = true;
    if (options.search) {
      filter.$or = [
        { title: { $regex: escapeRegex(options.search), $options: "i" } },
        { description: { $regex: escapeRegex(options.search), $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      DiplomaModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit)
        .lean(),
      DiplomaModel.countDocuments(filter),
    ]);

    return { items, total };
  }

  async incrementQuizCount(id: string, amount: number) {
    return DiplomaModel.updateOne(
      { _id: id },
      { $inc: { quizzesCount: amount } },
    );
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
