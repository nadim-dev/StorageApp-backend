import * as z from "zod";


export const loginSchema = z.object({
  email: z.email("Please Enter a valid Email"),
  password: z.string().min(1,"password is required"),
});

export const registerSchema= z.object({
   ...loginSchema.shape,
    name:z.string().trim().min(3,"Name Must contain atleast three character").max(100,"name must be less than hundred character"),
})


export const roleSchema = z.object({
  role: z.enum(["User", "Admin", "Manager"]), // only allowed roles
});


export const updatePasswordSchema = z.object({
  currentPassword: z.string().optional(),
  newPassword: z.string()
    .min(4, "Password must be at least 4 characters")
    .max(100),
});


export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(50, "Name too long")
    .optional(),
});