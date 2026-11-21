import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { DiplomaModel } from "../diploma/diploma.model.js";
import { DiplomaRepository } from "../diploma/diploma.repository.js";
import { QuizModel } from "../quiz/quiz.model.js";
import { QuizRepository } from "../quiz/quiz.repository.js";
import { isDuplicateKeyError } from "../../common/utils/mongo-errors.js";

/** Chainable stand-in for a Mongoose query: find().select().sort().skip().limit().lean() */
function chain(result: unknown) {
  const q: Record<string, unknown> = {};
  for (const name of ["select", "sort", "skip", "limit"]) q[name] = jest.fn(() => q);
  q.lean = jest.fn(async () => result);
  return q;
}

type Stub = jest.Mock<(...args: unknown[]) => unknown>;
/** Loosely-typed spy on a Mongoose static (their generics are not worth fighting in unit tests). */
function stub(model: object, method: string, result: unknown): Stub {
  return jest.spyOn(model as Record<string, (...args: unknown[]) => unknown>, method)
    .mockImplementation(() => result) as unknown as Stub;
}

afterEach(() => { jest.restoreAllMocks(); });

describe("DiplomaRepository", () => {
  const repo = new DiplomaRepository();

  it("passes data through create / findById / updateById (validators on)", () => {
    const create = stub(DiplomaModel, "create", {});
    const findById = stub(DiplomaModel, "findById", {});
    const update = stub(DiplomaModel, "findByIdAndUpdate", {});
    repo.create({ title: "T", description: "D", imageUrl: "u" });
    repo.findById("1");
    repo.updateById("1", { title: "X" });
    expect(create).toHaveBeenCalledWith({ title: "T", description: "D", imageUrl: "u" });
    expect(findById).toHaveBeenCalledWith("1");
    expect(update).toHaveBeenCalledWith("1", { title: "X" }, { new: true, runValidators: true });
  });

  it("finds by title case-insensitively with regex characters escaped", () => {
    const findOne = stub(DiplomaModel, "findOne", {});
    repo.findByTitle("C++ (Pro)");
    const { title } = findOne.mock.calls[0]![0] as { title: RegExp };
    expect(title.flags).toContain("i");
    expect(title.test("c++ (pro)")).toBe(true);
    expect(title.test("C Pro")).toBe(false);
  });

  it("lists active diplomas only, with escaped search, sorting and paging", async () => {
    const q = chain([{ id: 1 }]);
    const find = stub(DiplomaModel, "find", q);
    stub(DiplomaModel, "countDocuments", 7);
    const result = await repo.list({ page: 3, limit: 5, search: "a.b", includeInactive: false });
    const filter = find.mock.calls[0]![0] as { isActive: boolean; $or: Array<Record<string, { $regex: string }>> };
    expect(filter.isActive).toBe(true);
    expect(filter.$or[0]!.title!.$regex).toBe("a\\.b");
    expect(q.skip).toHaveBeenCalledWith(10);
    expect(q.limit).toHaveBeenCalledWith(5);
    expect(result).toEqual({ items: [{ id: 1 }], total: 7 });
  });

  it("includes inactive diplomas when asked and skips the search filter when absent", async () => {
    const find = stub(DiplomaModel, "find", chain([]));
    stub(DiplomaModel, "countDocuments", 0);
    await repo.list({ page: 1, limit: 10, includeInactive: true });
    expect(find.mock.calls[0]![0]).toEqual({});
  });

  it("increments the published-quiz counter atomically", () => {
    const updateOne = stub(DiplomaModel, "updateOne", {});
    repo.incrementQuizCount("1", -1);
    expect(updateOne).toHaveBeenCalledWith({ _id: "1" }, { $inc: { quizzesCount: -1 } });
  });
});

describe("QuizRepository", () => {
  const repo = new QuizRepository();

  it("passes data through create / findById / updateById", () => {
    const create = stub(QuizModel, "create", {});
    const findById = stub(QuizModel, "findById", {});
    const update = stub(QuizModel, "findByIdAndUpdate", {});
    repo.create({ a: 1 });
    repo.findById("1");
    repo.updateById("1", { a: 2 });
    expect(create).toHaveBeenCalledWith({ a: 1 });
    expect(findById).toHaveBeenCalledWith("1");
    expect(update).toHaveBeenCalledWith("1", { a: 2 }, { new: true, runValidators: true });
  });

  it("looks up a title inside one diploma, ignoring archived quizzes", () => {
    const findOne = stub(QuizModel, "findOne", {});
    repo.findByTitleInDiploma("d1", "HTML");
    const filter = findOne.mock.calls[0]![0] as { diplomaId: string; isArchived: unknown; title: RegExp };
    expect(filter.diplomaId).toBe("d1");
    expect(filter.isArchived).toEqual({ $ne: true });
    expect(filter.title.test("html")).toBe(true);
  });

  it("students: lists published, non-archived quizzes only", async () => {
    const find = stub(QuizModel, "find", chain([]));
    stub(QuizModel, "countDocuments", 0);
    await repo.listByDiploma("d1", { page: 1, limit: 10, includeUnpublished: false });
    expect(find.mock.calls[0]![0]).toEqual({ diplomaId: "d1", isArchived: { $ne: true }, isPublished: true });
  });

  it("admins: includes drafts; category and search filters are escaped", async () => {
    const find = stub(QuizModel, "find", chain([]));
    stub(QuizModel, "countDocuments", 0);
    await repo.listByDiploma("d1", { page: 2, limit: 10, includeUnpublished: true, category: "Front-End", search: "c++" });
    const filter = find.mock.calls[0]![0] as Record<string, unknown> & { category: RegExp; $or: Array<Record<string, { $regex: string }>> };
    expect(filter).not.toHaveProperty("isPublished");
    expect(filter.category.test("front-end")).toBe(true);
    expect(filter.$or[0]!.title!.$regex).toBe("c\\+\\+");
  });

  it("unpublishes every published quiz of a diploma", () => {
    const updateMany = stub(QuizModel, "updateMany", {});
    repo.unpublishAllByDiploma("d1");
    expect(updateMany).toHaveBeenCalledWith({ diplomaId: "d1", isPublished: true }, { $set: { isPublished: false } });
  });

  it("archives by soft delete only", () => {
    const update = stub(QuizModel, "findByIdAndUpdate", {});
    repo.archiveById("1");
    expect(update).toHaveBeenCalledWith("1", { isPublished: false, isArchived: true }, { new: true });
  });

  it("syncs question counters with one atomic $inc and returns the new document", () => {
    const update = stub(QuizModel, "findByIdAndUpdate", {});
    repo.applyQuestionDelta("1", 1, 3);
    expect(update).toHaveBeenCalledWith("1", { $inc: { questionsCount: 1, totalPoints: 3 } }, { new: true });
  });
});

describe("isDuplicateKeyError", () => {
  it("recognises E11000 only", () => {
    expect(isDuplicateKeyError({ code: 11000 })).toBe(true);
    expect(isDuplicateKeyError({ code: 1 })).toBe(false);
    expect(isDuplicateKeyError(null)).toBe(false);
    expect(isDuplicateKeyError("x")).toBe(false);
  });
});
