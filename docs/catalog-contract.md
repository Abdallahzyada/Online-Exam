# Catalog contract (Diplomas and Quizzes)

Mounted once through `createCatalogRouter(auth)` in `server.ts`, under `/api/v1`.

| Endpoint | Access | Notes |
| --- | --- | --- |
| `GET /diplomas?search&page&limit` | Auth | Active diplomas. `includeInactive=true` only works for admins. |
| `GET /diplomas/:diplomaId` | Auth | Inactive diplomas are 404 for students. |
| `GET /diplomas/:diplomaId/quizzes?search&category&page&limit` | Auth | Published quizzes of an active diploma. |
| `GET /quizzes/:quizId` | Auth | Instructions modal. 404 for drafts, archived quizzes, or an inactive diploma. |
| `POST /admin/diplomas` | Admin | `title`, `description`, `imageUrl` (http/https only). |
| `PATCH /admin/diplomas/:diplomaId` | Admin | Partial update. |
| `DELETE /admin/diplomas/:diplomaId` | Admin | Safe archive: `isActive=false`, all its quizzes are unpublished. |
| `GET /admin/diplomas/:diplomaId/quizzes` | Admin | Includes drafts. |
| `POST /admin/diplomas/:diplomaId/quizzes` | Admin | Always created as a draft (BR-07). |
| `GET /admin/quizzes/:quizId` | Admin | |
| `PATCH /admin/quizzes/:quizId` | Admin | Edit fields and/or `isPublished` (publish guard BR-07). |
| `DELETE /admin/quizzes/:quizId` | Admin | Soft delete (`isArchived`): unpublished and hidden, history kept. |

## Decisions

- `diploma.quizzesCount` = number of **published** quizzes (matches what students see).
  It changes on publish, unpublish, archive and diploma archive.
- Quiz titles are unique inside a diploma, and diploma titles are unique, both case-insensitive.
  A unique-index race returns `409 CONFLICT`.
- Responses use DTOs (`id`, not `_id`). Quiz DTOs never contain answer keys.

## Hook for the Question module

`QuizService.applyQuestionDelta(quizId, questionsDelta, pointsDelta)` keeps `questionsCount` and
`totalPoints` in sync with one atomic `$inc`, and unpublishes the quiz if its last question is removed.
Call it on question create (+1, +points), delete (-1, -points) and points edit (0, difference).

## Seed

`npm run seed:catalog` creates 6 diplomas and draft quizzes (idempotent). Quizzes stay drafts
until they have questions.
