import { z } from "zod";
import { userRoleSchema } from "./enums.js";

export const passwordSchema = z
  .string()
  .min(10, "密码至少 10 位")
  .max(200)
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
    message: "密码需同时包含字母与数字"
  });

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
    password: passwordSchema,
    name: z.string().trim().min(1).max(120),
    role: userRoleSchema.optional()
  })
  .strict();
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email("邮箱格式不正确"),
    password: z.string().min(1, "密码必填")
  })
  .strict();
export type LoginInput = z.infer<typeof loginSchema>;

export const refreshSchema = z
  .object({
    refresh_token: z.string().min(10, "refresh_token 必填")
  })
  .strict();
export type RefreshInput = z.infer<typeof refreshSchema>;
