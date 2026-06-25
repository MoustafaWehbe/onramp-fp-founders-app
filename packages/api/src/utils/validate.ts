import type { Request, Response, NextFunction } from "express";
import Joi from "joi";

type Target = "body" | "params" | "query";

export function validate(schema: Joi.Schema, target: Target = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { error, value } = schema.validate(req[target], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map((d: Joi.ValidationErrorItem) => ({
        field: d.path.join("."),
        message: d.message.replace(/['"]/g, ""),
      }));
      res.status(422).json({ error: "Validation failed", errors });
      return;
    }

    (req as unknown as Record<string, unknown>)[target] = value;
    next();
  };
}
