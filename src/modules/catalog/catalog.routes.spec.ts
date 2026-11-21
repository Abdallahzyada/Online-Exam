import { describe, expect, it, jest } from "@jest/globals";
import express from "express";
import type { ErrorRequestHandler, RequestHandler } from "express";
import request from "supertest";
import { ZodError } from "zod";
import { AppError, ForbiddenError, UnauthorizedError } from "../../common/errors/app-error.js";
import { createCatalogRouter } from "./catalog.routes.js";
import type { CatalogControllers } from "./catalog.routes.js";

const ID = "507f1f77bcf86cd799439011";
const handler = (status: number, body: unknown = { ok: true }): RequestHandler =>
  jest.fn<RequestHandler>((_req, res) => { res.status(status).json({ success: true, data: body }); }) as unknown as RequestHandler;

function makeApp() {
  const auth = {
    authenticate: ((req, _res, next) => next(req.header("x-role") ? undefined : new UnauthorizedError())) as RequestHandler,
    requireAdmin: ((req, _res, next) => next(req.header("x-role") === "admin" ? undefined : new ForbiddenError())) as RequestHandler,
    principal: (req: express.Request) => ({ role: req.header("x-role") === "admin" ? "admin" as const : "student" as const })
  };
  const controllers = {
    diploma: {
      createDiploma: handler(201), listDiplomas: handler(200), getDiploma: handler(200),
      updateDiploma: handler(200), archiveDiploma: handler(200),
      listDiplomaQuizzes: handler(200, "student-list"), listDiplomaQuizzesAdmin: handler(200, "admin-list")
    },
    quiz: {
      createQuiz: handler(201), getQuizInstructions: handler(200), getQuizAdmin: handler(200),
      updateQuiz: handler(200), archiveQuiz: handler(200)
    }
  } as unknown as CatalogControllers;
  const app = express();
  app.use(express.json());
  app.use("/api/v1", createCatalogRouter(auth, controllers));
  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const status = error instanceof ZodError ? 400 : error instanceof AppError ? error.statusCode : 500;
    res.status(status).json({ success: false, error: { code: error instanceof AppError ? error.code : "ERR" } });
  };
  app.use(onError);
  return app;
}

const diplomaBody = { title: "Frontend", description: "d", imageUrl: "https://x.io/a.png" };

describe("catalog routes (contract, RBAC, validation)", () => {
  const app = makeApp();

  it("requires a token on every catalog route (401)", async () => {
    for (const path of ["/api/v1/diplomas", `/api/v1/diplomas/${ID}/quizzes`, `/api/v1/quizzes/${ID}`]) {
      expect((await request(app).get(path)).status).toBe(401);
    }
    expect((await request(app).post("/api/v1/admin/diplomas").send(diplomaBody)).status).toBe(401);
  });

  it("lets students browse the catalog", async () => {
    expect((await request(app).get("/api/v1/diplomas?search=web&page=1&limit=5").set("x-role", "student")).status).toBe(200);
    expect((await request(app).get(`/api/v1/diplomas/${ID}`).set("x-role", "student")).status).toBe(200);
    const list = await request(app).get(`/api/v1/diplomas/${ID}/quizzes`).set("x-role", "student");
    expect(list.body.data).toBe("student-list");
    expect((await request(app).get(`/api/v1/quizzes/${ID}`).set("x-role", "student")).status).toBe(200);
  });

  it("forbids students on every admin route (403)", async () => {
    const student = (r: request.Test) => r.set("x-role", "student");
    const calls = [
      student(request(app).post("/api/v1/admin/diplomas").send(diplomaBody)),
      student(request(app).patch(`/api/v1/admin/diplomas/${ID}`).send({ title: "Ab" })),
      student(request(app).delete(`/api/v1/admin/diplomas/${ID}`)),
      student(request(app).get(`/api/v1/admin/diplomas/${ID}/quizzes`)),
      student(request(app).post(`/api/v1/admin/diplomas/${ID}/quizzes`).send({})),
      student(request(app).get(`/api/v1/admin/quizzes/${ID}`)),
      student(request(app).patch(`/api/v1/admin/quizzes/${ID}`).send({ isPublished: true })),
      student(request(app).delete(`/api/v1/admin/quizzes/${ID}`)),
    ];
    for (const response of await Promise.all(calls)) expect(response.status).toBe(403);
  });

  it("serves the admin contract with the canonical envelope", async () => {
    const admin = (r: request.Test) => r.set("x-role", "admin");
    const created = await admin(request(app).post("/api/v1/admin/diplomas").send(diplomaBody));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ success: true });
    expect((await admin(request(app).patch(`/api/v1/admin/diplomas/${ID}`).send({ title: "Backend" }))).status).toBe(200);
    expect((await admin(request(app).delete(`/api/v1/admin/diplomas/${ID}`))).status).toBe(200);
    const drafts = await admin(request(app).get(`/api/v1/admin/diplomas/${ID}/quizzes`));
    expect(drafts.body.data).toBe("admin-list");
    const quiz = { title: "HTML", description: "d", imageUrl: "https://x.io/a.png", category: "c", durationMinutes: 15 };
    expect((await admin(request(app).post(`/api/v1/admin/diplomas/${ID}/quizzes`).send(quiz))).status).toBe(201);
    expect((await admin(request(app).patch(`/api/v1/admin/quizzes/${ID}`).send({ isPublished: true }))).status).toBe(200);
    expect((await admin(request(app).delete(`/api/v1/admin/quizzes/${ID}`))).status).toBe(200);
  });

  it("validates before reaching controllers (400)", async () => {
    const admin = (r: request.Test) => r.set("x-role", "admin");
    expect((await admin(request(app).post("/api/v1/admin/diplomas").send({ ...diplomaBody, imageUrl: "javascript:alert(1)" }))).status).toBe(400);
    expect((await admin(request(app).patch("/api/v1/admin/diplomas/not-an-id").send({ title: "Ab" }))).status).toBe(400);
    expect((await admin(request(app).patch(`/api/v1/admin/quizzes/${ID}`).send({}))).status).toBe(400);
    expect((await request(app).get("/api/v1/diplomas?limit=1000").set("x-role", "student")).status).toBe(400);
  });
});
