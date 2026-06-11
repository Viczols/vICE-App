import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  createUser,
  verifyUser,
  isUsernameAvailable,
  generateUsernameSuggestions,
  normalizeUsernameCandidate,
  isValidUsernameFormat,
} from "./service";
import { db } from "../db";
import { createGeneralAuditLog } from "../services/auditLogService";

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get("/check-username", async (req, reply) => {
    const query = z
      .object({
        username: z.string().optional().default(""),
      })
      .parse(req.query);

    const normalized = normalizeUsernameCandidate(query.username);

    if (!normalized) {
      return reply.code(400).send({
        available: false,
        normalized,
        reason: "USERNAME_REQUIRED",
      });
    }

    if (!isValidUsernameFormat(normalized)) {
      return reply.send({
        available: false,
        normalized,
        reason: "INVALID_USERNAME",
      });
    }

    const result = await isUsernameAvailable(normalized);
    return result;
  });

  app.get("/username-suggestions", async (req) => {
    const query = z
      .object({
        displayName: z.string().optional().default(""),
        refresh: z.coerce.number().optional().default(0),
      })
      .parse(req.query);

    const suggestions = await generateUsernameSuggestions(
      query.displayName,
      query.refresh
    );

    return {
      suggestions,
    };
  });

  app.post("/signup", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        displayName: z.string().min(2).max(24),
        username: z
          .string()
          .min(3)
          .max(20)
          .regex(/^[a-zA-Z0-9_.]+$/, "INVALID_USERNAME"),
      })
      .parse(req.body);

    try {
      const user = await createUser(
        body.email,
        body.password,
        body.displayName,
        body.username
      );

      await createGeneralAuditLog({
        eventType: "user_signup",
        actorUserId: user.id,
        actorIp: (req as any).ip ?? null,
        details: {
          username: user.username,
          email: user.email,
        },
      });

      const token = app.jwt.sign({
        sub: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        displayName: user.displayName,
      });

      return {
        token,
        user: {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          avatarUrl: user.avatarUrl,
          status: user.status,
        },
      };
    } catch (e: any) {
      const msg = String(e?.message || "").toLowerCase();

      if (msg.includes("email")) {
        return reply.code(409).send({ error: "EMAIL_IN_USE" });
      }

      if (msg.includes("username")) {
        return reply.code(409).send({ error: "USERNAME_IN_USE" });
      }

      throw e;
    }
  });

  app.post("/login", async (req, reply) => {
    const body = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
      })
      .parse(req.body);

    const user = await verifyUser(body.email, body.password);
    if (!user) {
      return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
    }

    await createGeneralAuditLog({
      eventType: "user_login",
      actorUserId: user.id,
      actorIp: (req as any).ip ?? null,
      details: {
        username: user.username,
        email: user.email,
      },
    });

    const token = app.jwt.sign({
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
    });

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        avatarUrl: user.avatarUrl,
        status: user.status,
      },
    };
  });

  app.get("/me", { preHandler: [app.auth] }, async (req, reply) => {
    const user = req.user as {
      sub: string;
      email: string;
      username?: string;
      role: string;
      displayName?: string;
    };

    const r = await db.query(
      `SELECT id, username, display_name, role, avatar_url, status
       FROM users
       WHERE id = $1`,
      [user.sub]
    );

    if ((r.rowCount ?? 0) === 0) {
      return reply.code(404).send({ error: "USER_NOT_FOUND" });
    }

    return {
      id: r.rows[0].id,
      username: r.rows[0].username ?? "",
      displayName: r.rows[0].display_name ?? "User",
      role: r.rows[0].role,
      avatarUrl: r.rows[0].avatar_url ?? null,
      status: r.rows[0].status ?? "online",
    };
  });
};
