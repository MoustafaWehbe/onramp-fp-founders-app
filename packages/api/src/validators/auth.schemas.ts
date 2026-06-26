import { z } from "zod";

export const registerInitiateSchema = z.object({
  first_name: z
    .string()
    .min(2, "First name must be at least 2 characters")
    .max(50, "First name must be at most 50 characters")
    .transform((v) => v.trim()),
  last_name: z
    .string()
    .min(2, "Last name must be at least 2 characters")
    .max(50, "Last name must be at most 50 characters")
    .transform((v) => v.trim()),
  email: z
    .string()
    .email("Invalid email address")
    .transform((v) => v.trim().toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const registerResendSchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .transform((v) => v.trim().toLowerCase()),
});

export const registerVerifySchema = z.object({
  email: z
    .string()
    .email("Invalid email address")
    .transform((v) => v.trim().toLowerCase()),
  otp: z
    .string()
    .length(6, "OTP must be 6 digits")
    .regex(/^\d{6}$/, "OTP must be 6 numeric digits"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInitiateInput = z.infer<typeof registerInitiateSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
