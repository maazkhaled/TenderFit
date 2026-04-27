import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { NotAuthError, NotFoundError } from "./errors";

export { requireSession } from "./auth";

type Handler<T> = (req: Request, ctx: T) => Promise<Response> | Response;

export function apiHandler<T = unknown>(handler: Handler<T>) {
  return async (req: Request, ctx: T): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "invalid_body", issues: err.issues },
          { status: 400 },
        );
      }
      if (err instanceof NotAuthError) {
        return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
      }
      if (err instanceof NotFoundError) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      console.error("[apiHandler] unhandled error", err);
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    }
  };
}

export async function parseJson<T>(
  req: Request,
  schema: { parse: (v: unknown) => T },
): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  return schema.parse(body);
}
