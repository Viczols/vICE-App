import { z } from "zod";

const Env = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(20),
  JWT_EXPIRES_IN: z.string().default("30d"),
});

export const config = Env.parse(process.env);
