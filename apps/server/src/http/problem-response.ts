import { ERROR_CODES, PROBLEM_CONTENT_TYPE, type Problem, problemTypeUri } from '@crm/shared';
import { DomainError } from '../platform/errors/domain-error.ts';

export function toProblem(error: unknown, requestId: string | undefined): Problem {
  if (error instanceof DomainError) {
    return {
      type: problemTypeUri(error.code),
      title: error.message,
      status: error.status,
      code: error.code,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      ...(error.errors === undefined ? {} : { errors: error.errors }),
      ...(error.meta === undefined ? {} : { meta: error.meta }),
      ...(requestId === undefined ? {} : { requestId }),
    };
  }
  // Unknown errors: never leak internals (stack, SQL, paths) to the client.
  return {
    type: problemTypeUri(ERROR_CODES.INTERNAL_ERROR),
    title: 'Something went wrong',
    status: 500,
    code: ERROR_CODES.INTERNAL_ERROR,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

export function problemResponse(problem: Problem): Response {
  return new Response(JSON.stringify(problem), {
    status: problem.status,
    headers: { 'content-type': PROBLEM_CONTENT_TYPE, 'x-request-id': problem.requestId ?? '' },
  });
}
