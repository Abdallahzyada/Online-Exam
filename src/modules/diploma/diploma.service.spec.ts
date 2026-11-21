import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { DiplomaService } from "./diploma.service.js";
import { ConflictError, NotFoundError } from "../../common/errors/app-error.js";

describe("DiplomaService", () => {
  const diplomaRepo = {
    findByTitle: jest.fn<(title: string) => Promise<unknown>>(),
    create: jest.fn<(data: { title: string; description: string; imageUrl: string }) => Promise<unknown>>(),
    findById: jest.fn<(id: string) => Promise<unknown>>(),
    list: jest.fn(),
    updateById: jest.fn(),
  };
  const quizRepo = { listByDiploma: jest.fn() };
  let service: DiplomaService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DiplomaService(diplomaRepo as never, quizRepo as never);
  });

  it("creates a diploma when its title is unique", async () => {
    diplomaRepo.findByTitle.mockResolvedValue(null);
    diplomaRepo.create.mockResolvedValue({ title: "Frontend" });

    await expect(
      service.create({
        title: "Frontend",
        description: "Frontend diploma",
        imageUrl: "https://example.com/image.jpg",
      }),
    ).resolves.toEqual({ title: "Frontend" });

    expect(diplomaRepo.create).toHaveBeenCalledTimes(1);
  });

  it("rejects duplicate diploma titles", async () => {
    diplomaRepo.findByTitle.mockResolvedValue({ _id: "123" });

    await expect(
      service.create({
        title: "Frontend",
        description: "Frontend diploma",
        imageUrl: "https://example.com/image.jpg",
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(diplomaRepo.create).not.toHaveBeenCalled();
  });

  it("does not return an inactive diploma to students", async () => {
    diplomaRepo.findById.mockResolvedValue({ isActive: false });

    await expect(
      service.getById("507f1f77bcf86cd799439011"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
