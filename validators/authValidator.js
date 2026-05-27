import * as z from "zod";

export const googleLoginSchema=z.object({
  id_token: z
    .string()
    .min(10, "Invalid Google token")
});

export const githubLoginSchema = z.object({
  code: z.string().min(10, "Invalid GitHub authorization code")
});

