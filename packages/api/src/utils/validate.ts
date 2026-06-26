import type { Request, Response, NextFunction } from "express";
import { type ZodSchema, ZodError } from "zod";

type Target = "body" | "params" | "query";

export function validate(schema: ZodSchema, target: Target = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const errors = result.error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      }));
      res.status(400).json({ code: "VALIDATION_ERROR", error: "Validation failed", errors });
      return;
    }

    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}
