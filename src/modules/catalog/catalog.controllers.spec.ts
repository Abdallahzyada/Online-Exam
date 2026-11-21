import { describe, expect, it, jest } from "@jest/globals";
import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import request from "supertest";
import { ZodError } from "zod";
import { AppError, NotFoundError } from "../../common/errors/app-error.js";
import { createDiplomaController } from "../diploma/diploma.controller.js";
import { createQuizController } from "../quiz/quiz.controller.js";
import { createCatalogRouter } from "./catalog.routes.js";

const ID = "507f1f77bcf86cd799439011";
const diplomaDoc = { _id: "d1", title: "T", description: "D", imageUrl: "u", isActive: true, quizzesCount: 1 };
const quizDoc = {
  _id: "q1", diplomaId: "d1", title: "T", description: "D", imageUrl: "u", category: "c", durationMinutes: 15,
  questionsCount: 2, passingScorePercentage: 50, totalPoints: 2, instructions: ["a"], isPublished: true
};
const meta = { page: 1, limit: 10, total: 1, totalPages: 1 };

function setup() {
  const diplomaService = {
    create: jest.fn<(i: unknown) => Promise<unknown>>().mockResolvedValue(diplomaDoc),
    list: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ items: [diplomaDoc], total: 1, meta }),
    getById: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(diplomaDoc),
    update: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(diplomaDoc),
    archive: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ ...diplomaDoc, isActive: false }),
    getQuizzes: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ items: [quizDoc], total: 1, meta })
  };
  const quizService = {
    create: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(quizDoc),
    getInstructions: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ id: "q1", title: "T" }),
    getById: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(quizDoc),
    update: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue(quizDoc),
    archive: jest.fn<(...a: unknown[]) => Promise<unknown>>().mockResolvedValue({ ...quizDoc, isPublished: false })
  };
  const pass: RequestHandler = (_req, _res, next) => next();
  const auth = {
    authenticate: pass, requireAdmin: pass,
    principal: (req: express.Request) => ({ role: req.header("x-role") === "admin" ? "admin" as const : "student" as const })
  };
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createCatalogRouter(auth, {
    diploma: createDiplomaController(auth, diplomaService as never),
    quiz: createQuizController(quizService as never)
  }));
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = error instanceof ZodError ? 400 : error instanceof AppError ? error.statusCode : 500;
    res.status(status).json({ success: false, error: { code: error instanceof AppError ? error.code : "ERR" } });
  };
  app.use(onError);
  return { app, diplomaService, quizService };
}

describe("catalog controllers", () => {
  it("returns public DTOs in the success envelope with pagination meta", async () => {
    const { app } = setup();
    const res = await request(app).get("/api/v1/diplomas");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: [{ id: "d1", title: "T", description: "D", imageUrl: "u", isActive: true, quizzesCount: 1 }],
      meta
    });
  });

  it("only honours includeInactive for admins", async () => {
    const { app, diplomaService } = setup();
    await request(app).get("/api/v1/diplomas?includeInactive=true").set("x-role", "student");
    expect(diplomaService.list).toHaveBeenLastCalledWith(1, 10, undefined, false);
    await request(app).get("/api/v1/diplomas?includeInactive=true").set("x-role", "admin");
    expect(diplomaService.list).toHaveBeenLastCalledWith(1, 10, undefined, true);
  });

  it("lets only admins see inactive diplomas by id", async () => {
    const { app, diplomaService } = setup();
    await request(app).get(`/api/v1/diplomas/${ID}`).set("x-role", "student");
    expect(diplomaService.getById).toHaveBeenLastCalledWith(ID, false);
    await request(app).get(`/api/v1/diplomas/${ID}`).set("x-role", "admin");
    expect(diplomaService.getById).toHaveBeenLastCalledWith(ID, true);
  });

  it("student quiz list never asks for drafts; admin list does", async () => {
    const { app, diplomaService } = setup();
    const student = await request(app).get(`/api/v1/diplomas/${ID}/quizzes?search=ht&category=Front-End`);
    expect(diplomaService.getQuizzes).toHaveBeenLastCalledWith(ID, { page: 1, limit: 10, search: "ht", category: "Front-End" });
    expect(student.body.data[0]).toMatchObject({ id: "q1", diplomaId: "d1" });
    await request(app).get(`/api/v1/admin/diplomas/${ID}/quizzes`);
    expect(diplomaService.getQuizzes).toHaveBeenLastCalledWith(ID, { page: 1, limit: 10, search: undefined, category: undefined }, true);
  });

  it("creates, updates and archives diplomas with the right status codes", async () => {
    const { app, diplomaService } = setup();
    const body = { title: "Frontend", description: "d", imageUrl: "https://x.io/a.png" };
    expect((await request(app).post("/api/v1/admin/diplomas").send(body)).status).toBe(201);
    expect(diplomaService.create).toHaveBeenCalledWith(body);
    expect((await request(app).patch(`/api/v1/admin/diplomas/${ID}`).send({ title: "Backend" })).status).toBe(200);
    const archived = await request(app).delete(`/api/v1/admin/diplomas/${ID}`);
    expect(archived.body.data.isActive).toBe(false);
  });

  it("creates, reads, edits/publishes and archives quizzes", async () => {
    const { app, quizService } = setup();
    const body = { title: "HTML", description: "d", imageUrl: "https://x.io/a.png", category: "c", durationMinutes: 15 };
    expect((await request(app).post(`/api/v1/admin/diplomas/${ID}/quizzes`).send(body)).status).toBe(201);
    expect((await request(app).get(`/api/v1/quizzes/${ID}`)).body.data).toEqual({ id: "q1", title: "T" });
    expect((await request(app).get(`/api/v1/admin/quizzes/${ID}`)).body.data.id).toBe("q1");
    await request(app).patch(`/api/v1/admin/quizzes/${ID}`).send({ isPublished: true });
    expect(quizService.update).toHaveBeenCalledWith(ID, { isPublished: true });
    expect((await request(app).delete(`/api/v1/admin/quizzes/${ID}`)).body.data.isPublished).toBe(false);
  });

  it("delegates service errors to the error handler", async () => {
    const { app, quizService } = setup();
    quizService.getInstructions.mockRejectedValue(new NotFoundError("Quiz"));
    const res = await request(app).get(`/api/v1/quizzes/${ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: { code: "NOT_FOUND" } });
  });
});
