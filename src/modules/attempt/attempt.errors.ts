import { AppError } from '../../common/errors/app-error.js';

// Codes named by the requirements. The shared public-error allow-list must
// contain them for the code (not only the status) to reach clients.
export class AttemptExpiredError extends AppError {
  constructor() { super(400, 'ATTEMPT_EXPIRED', 'The attempt time limit has passed'); }
}
export class AttemptAlreadySubmittedError extends AppError {
  constructor() { super(409, 'ATTEMPT_ALREADY_SUBMITTED', 'The attempt has already been submitted'); }
}
export class AttemptNotSubmittedError extends AppError {
  constructor() { super(403, 'ATTEMPT_NOT_SUBMITTED', 'The attempt has not been submitted yet'); }
}
export class QuizNotAvailableError extends AppError {
  constructor() { super(409, 'CONFLICT', 'The quiz cannot be started'); }
}
