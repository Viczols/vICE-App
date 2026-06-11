import { db } from "../db";

export type UserStatus = "online" | "idle" | "dnd" | "invisible" | "offline";

export type ProfileRecord = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  avatarUrl: string | null;
  status: UserStatus;
};

function mapProfileRow(row: any): ProfileRecord {
  return {
    id: String(row.id),
    username: String(row.username ?? ""),
    displayName: String(row.display_name ?? "User"),
    role: String(row.role ?? "user"),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    status: (String(row.status ?? "online") as UserStatus),
  };
}

export async function getProfileByUserId(userId: string): Promise<ProfileRecord | null> {
  const r = await db.query(
    `SELECT id, username, display_name, role, avatar_url, status
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if ((r.rowCount ?? 0) === 0) return null;
  return mapProfileRow(r.rows[0]);
}

export async function updateProfile(
  userId: string,
  patch: { displayName?: string; avatarUrl?: string | null }
): Promise<ProfileRecord> {
  const fields: string[] = [];
  const values: any[] = [userId];
  let idx = 2;

  if (patch.displayName !== undefined) {
    fields.push(`display_name = $${idx++}`);
    values.push(patch.displayName.trim());
  }

  if (patch.avatarUrl !== undefined) {
    fields.push(`avatar_url = $${idx++}`);
    values.push(patch.avatarUrl);
  }

  if (fields.length === 0) {
    const existing = await getProfileByUserId(userId);
    if (!existing) throw new Error("USER_NOT_FOUND");
    return existing;
  }

  const r = await db.query(
    `UPDATE users
     SET ${fields.join(", ")}
     WHERE id = $1
     RETURNING id, username, display_name, role, avatar_url, status`,
    values
  );

  if ((r.rowCount ?? 0) === 0) throw new Error("USER_NOT_FOUND");
  return mapProfileRow(r.rows[0]);
}

export async function updateUserStatus(
  userId: string,
  status: UserStatus
): Promise<ProfileRecord> {
  const r = await db.query(
    `UPDATE users
     SET status = $2
     WHERE id = $1
     RETURNING id, username, display_name, role, avatar_url, status`,
    [userId, status]
  );

  if ((r.rowCount ?? 0) === 0) throw new Error("USER_NOT_FOUND");
  return mapProfileRow(r.rows[0]);
}
