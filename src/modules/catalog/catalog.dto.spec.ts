import { describe, expect, it } from "@jest/globals";
import { createDiplomaSchema, updateDiplomaSchema, toDiplomaDto } from "../diploma/diploma.dto.js";
import { createQuizSchema, diplomaQuizzesSchema, updateQuizSchema, toQuizDto } from "../quiz/quiz.dto.js";

const quizBody = {
  title: "HTML", description: "d", imageUrl: "https://x.io/a.png", category: "Front-End", durationMinutes: 15
};

describe("catalog DTO validation", () => {
  it("accepts only http(s) image URLs", () => {
    const body = (imageUrl: string) => createDiplomaSchema.shape.body.safeParse({ title: "Ab", description: "d", imageUrl });
    expect(body("https://x.io/a.png").success).toBe(true);
    expect(body("javascript:alert(1)").success).toBe(false);
    expect(body("ftp://x.io/a.png").success).toBe(false);
    expect(body("nope").success).toBe(false);
  });

  it("rejects unknown fields (strict) and empty PATCH bodies", () => {
    expect(createDiplomaSchema.shape.body.safeParse({ title: "Ab", description: "d", imageUrl: "https://x.io/a", role: "admin" }).success).toBe(false);
    expect(updateDiplomaSchema.shape.body.safeParse({}).success).toBe(false);
    expect(updateQuizSchema.shape.body.safeParse({}).success).toBe(false);
  });

  it("rejects malformed ids", () => {
    expect(updateDiplomaSchema.shape.params.safeParse({ diplomaId: "123" }).success).toBe(false);
    expect(createQuizSchema.shape.params.safeParse({ diplomaId: "507f1f77bcf86cd799439011" }).success).toBe(true);
  });

  it("applies quiz defaults and integer rules", () => {
    const parsed = createQuizSchema.shape.body.parse(quizBody);
    expect(parsed.passingScorePercentage).toBe(50);
    expect(parsed.instructions).toEqual([]);
    expect(createQuizSchema.shape.body.safeParse({ ...quizBody, durationMinutes: 0 }).success).toBe(false);
    expect(createQuizSchema.shape.body.safeParse({ ...quizBody, passingScorePercentage: 50.5 }).success).toBe(false);
  });

  it("lets PATCH publish a quiz", () => {
    expect(updateQuizSchema.shape.body.parse({ isPublished: true })).toEqual({ isPublished: true });
  });

  it("coerces and bounds pagination, and accepts search + category", () => {
    const q = diplomaQuizzesSchema.shape.query.parse({ page: "2", limit: "5", search: " ht ", category: "Front-End" });
    expect(q).toEqual({ page: 2, limit: 5, search: "ht", category: "Front-End" });
    expect(diplomaQuizzesSchema.shape.query.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("maps documents to public DTOs without Mongoose internals", () => {
    const diploma = toDiplomaDto({ _id: "d1", title: "T", description: "D", imageUrl: "u", isActive: true, quizzesCount: 2, __v: 0 } as never);
    expect(diploma).toMatchObject({ id: "d1", quizzesCount: 2 });
    expect(diploma).not.toHaveProperty("_id");
    const quiz = toQuizDto({
      _id: "q1", diplomaId: "d1", title: "T", description: "D", imageUrl: "u", category: "c", durationMinutes: 1,
      questionsCount: 0, passingScorePercentage: 50, totalPoints: 0, instructions: ["a"], isPublished: false
    });
    expect(quiz).toMatchObject({ id: "q1", diplomaId: "d1", instructions: ["a"] });
    expect(quiz).not.toHaveProperty("_id");
  });
});
