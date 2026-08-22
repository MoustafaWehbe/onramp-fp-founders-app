import type { Request, Response, NextFunction } from "express";
import { type ZodSchema } from "zod";

type Target = "body" | "params" | "query";

export function validate(schema: ZodSchema, target: Target = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = result.error.issues.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      res.status(400).json({ code: "VALIDATION_ERROR", error: "Validation failed", errors });
      return;
    }

    if (target === "query") {
      // Express 5 turned req.query into a getter that re-parses the URL on
      // every access rather than a plain cached property, so a normal
      // assignment (or mutating the object handed back by one read) is
      // silently lost by the next read. Redefining it as an own data
      // property on this request shadows that getter for its lifetime,
      // which is the documented way to hand downstream handlers the
      // coerced/defaulted query values instead of the raw strings.
      Object.defineProperty(req, "query", { value: result.data, writable: true, enumerable: true, configurable: true });
    } else {
      (req as unknown as Record<string, unknown>)[target] = result.data;
    }
    next();
  };
}
