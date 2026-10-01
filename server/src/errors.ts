import type { Context } from "hono";

export class ApiError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (message: string, code = "bad_request", extra?: Record<string, unknown>) =>
  new ApiError(400, code, message, extra);
export const unauthorized = (message = "Authentication required") =>
  new ApiError(401, "unauthorized", message);
export const forbidden = (message = "You do not have permission to do that", code = "forbidden") =>
  new ApiError(403, code, message);
export const notFound = (message = "Not found") => new ApiError(404, "not_found", message);
export const conflict = (
  message: string,
  extra?: Record<string, unknown>,
) => new ApiError(409, "conflict", message, extra);

export function errorBody(err: ApiError): Record<string, unknown> {
  return { error: { code: err.code, message: err.message, ...(err.extra ?? {}) } };
}

export function respondError(c: Context, err: ApiError) {
  c.status(err.status as 400);
  return c.json(errorBody(err));
}
