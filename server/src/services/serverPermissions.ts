import { db } from "../db";

export const SERVER_PERMISSION_KEYS = [
  "administrator",
  "manage_server",
  "manage_roles",
  "manage_channels",
  "kick_members",
  "ban_members",
  "mute_members",
  "deafen_members",
  "move_members",
  "disconnect_members",
  "view_audit_log",
  "view_channel",
  "send_messages",
  "connect",
  "speak",
] as const;

export type ServerPermission = (typeof SERVER_PERMISSION_KEYS)[number];
export type PermissionMap = Record<ServerPermission, boolean>;

export type ServerRoleRecord = {
  id: string;
  serverId: string;
  name: string;
  color: string | null;
  position: number;
  permissions: Record<string, boolean>;
  isDefault: boolean;
  isManaged: boolean;
};

export type ServerMemberPermissionState = {
  serverId: string;
  userId: string;
  isOwner: boolean;
  baseRole: string | null;
  roles: ServerRoleRecord[];
  permissions: PermissionMap;
  highestRole: ServerRoleRecord | null;
  serverMuted: boolean;
  serverDeafened: boolean;
  timeoutUntil: string | null;
};

function emptyPermissions(): PermissionMap {
  return {
    administrator: false,
    manage_server: false,
    manage_roles: false,
    manage_channels: false,
    kick_members: false,
    ban_members: false,
    mute_members: false,
    deafen_members: false,
    move_members: false,
    disconnect_members: false,
    view_audit_log: false,
    view_channel: false,
    send_messages: false,
    connect: false,
    speak: false,
  };
}

function normalizePermissionObject(raw: unknown): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[String(key)] = value === true;
  }
  return out;
}

function mergePermissions(roles: ServerRoleRecord[]): PermissionMap {
  const merged = emptyPermissions();

  for (const role of roles) {
    const normalized = normalizePermissionObject(role.permissions);
    if (normalized.administrator === true) {
      for (const key of SERVER_PERMISSION_KEYS) merged[key] = true;
      return merged;
    }
    for (const key of SERVER_PERMISSION_KEYS) {
      if (normalized[key] === true) merged[key] = true;
    }
  }

  return merged;
}

export async function getServerOwnerId(serverId: string): Promise<string | null> {
  const result = await db.query(`SELECT owner_id FROM servers WHERE id = $1 LIMIT 1`, [serverId]);
  return result.rows[0]?.owner_id ? String(result.rows[0].owner_id) : null;
}

export async function getDefaultServerRoleId(serverId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT id
       FROM server_roles
      WHERE server_id = $1
        AND is_default = true
      ORDER BY position DESC, created_at ASC
      LIMIT 1`,
    [serverId]
  );
  return result.rows[0]?.id ? String(result.rows[0].id) : null;
}

export async function getServerRoleById(serverId: string, roleId: string): Promise<ServerRoleRecord | null> {
  const result = await db.query(
    `SELECT id, server_id, name, color, position, permissions, is_default, is_managed
       FROM server_roles
      WHERE server_id = $1 AND id = $2
      LIMIT 1`,
    [serverId, roleId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    serverId: String(row.server_id),
    name: String(row.name),
    color: row.color ? String(row.color) : null,
    position: Number(row.position ?? 0),
    permissions: normalizePermissionObject(row.permissions),
    isDefault: row.is_default === true,
    isManaged: row.is_managed === true,
  };
}

export async function getServerMemberPermissionState(
  serverId: string,
  userId: string
): Promise<ServerMemberPermissionState | null> {
  const memberResult = await db.query(
    `SELECT sm.server_id, sm.user_id, sm.role, sm.server_muted, sm.server_deafened, sm.timeout_until, s.owner_id
       FROM server_members sm
       JOIN servers s ON s.id = sm.server_id
      WHERE sm.server_id = $1 AND sm.user_id = $2
      LIMIT 1`,
    [serverId, userId]
  );

  if ((memberResult.rowCount ?? 0) === 0) return null;

  const memberRow = memberResult.rows[0];
  const isOwner = String(memberRow.owner_id ?? "") === userId;

  const roleResult = await db.query(
    `SELECT sr.id, sr.server_id, sr.name, sr.color, sr.position, sr.permissions, sr.is_default, sr.is_managed
       FROM server_member_roles smr
       JOIN server_roles sr ON sr.id = smr.role_id
      WHERE smr.server_id = $1 AND smr.user_id = $2
      ORDER BY sr.position DESC, sr.created_at ASC`,
    [serverId, userId]
  );

  const roles: ServerRoleRecord[] = roleResult.rows.map((row) => ({
    id: String(row.id),
    serverId: String(row.server_id),
    name: String(row.name),
    color: row.color ? String(row.color) : null,
    position: Number(row.position ?? 0),
    permissions: normalizePermissionObject(row.permissions),
    isDefault: row.is_default === true,
    isManaged: row.is_managed === true,
  }));

  const permissions = isOwner
    ? SERVER_PERMISSION_KEYS.reduce((acc, key) => {
        acc[key] = true;
        return acc;
      }, emptyPermissions())
    : mergePermissions(roles);

  return {
    serverId,
    userId,
    isOwner,
    baseRole: memberRow.role ? String(memberRow.role) : null,
    roles,
    permissions,
    highestRole: roles[0] ?? null,
    serverMuted: memberRow.server_muted === true,
    serverDeafened: memberRow.server_deafened === true,
    timeoutUntil: memberRow.timeout_until ? String(memberRow.timeout_until) : null,
  };
}

export async function hasServerPermission(
  serverId: string,
  userId: string,
  permission: ServerPermission
): Promise<boolean> {
  const state = await getServerMemberPermissionState(serverId, userId);
  if (!state) return false;
  if (state.isOwner) return true;
  return state.permissions.administrator === true || state.permissions[permission] === true;
}

export async function requireServerPermission(
  serverId: string,
  userId: string,
  permission: ServerPermission
): Promise<ServerMemberPermissionState | null> {
  const state = await getServerMemberPermissionState(serverId, userId);
  if (!state) return null;
  if (state.isOwner) return state;
  if (state.permissions.administrator === true) return state;
  if (state.permissions[permission] === true) return state;
  return null;
}

export async function getUserHighestServerRole(serverId: string, userId: string): Promise<ServerRoleRecord | null> {
  const state = await getServerMemberPermissionState(serverId, userId);
  return state?.highestRole ?? null;
}

export async function canActOnTargetUser(
  serverId: string,
  actorUserId: string,
  targetUserId: string
): Promise<boolean> {
  if (!actorUserId || !targetUserId) return false;
  if (actorUserId === targetUserId) return false;

  const ownerId = await getServerOwnerId(serverId);
  if (!ownerId) return false;
  if (targetUserId === ownerId) return false;
  if (actorUserId === ownerId) return true;

  const actorHighestRole = await getUserHighestServerRole(serverId, actorUserId);
  const targetHighestRole = await getUserHighestServerRole(serverId, targetUserId);
  if (!actorHighestRole) return false;
  if (!targetHighestRole) return true;
  return actorHighestRole.position > targetHighestRole.position;
}

export async function getVisibleServerMembersWithRoles(serverId: string) {
  const result = await db.query(
    `SELECT
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.status,
        sm.role,
        sm.server_muted,
        sm.server_deafened,
        sm.timeout_until,
        COALESCE(
          json_agg(
            json_build_object(
              'id', sr.id,
              'name', sr.name,
              'color', sr.color,
              'position', sr.position,
              'isDefault', sr.is_default,
              'isManaged', sr.is_managed
            )
            ORDER BY sr.position DESC, sr.created_at ASC
          ) FILTER (WHERE sr.id IS NOT NULL),
          '[]'::json
        ) AS roles
      FROM server_members sm
      JOIN users u ON u.id = sm.user_id
      LEFT JOIN server_member_roles smr ON smr.server_id = sm.server_id AND smr.user_id = sm.user_id
      LEFT JOIN server_roles sr ON sr.id = smr.role_id
      WHERE sm.server_id = $1
      GROUP BY u.id, u.username, u.display_name, u.avatar_url, u.status, sm.role, sm.server_muted, sm.server_deafened, sm.timeout_until
      ORDER BY lower(u.display_name) ASC`,
    [serverId]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    username: row.username ? String(row.username) : null,
    displayName: String(row.display_name ?? "User"),
    avatarUrl: row.avatar_url ? String(row.avatar_url) : null,
    status: String(row.status ?? "offline"),
    role: row.role ? String(row.role) : "member",
    serverMuted: row.server_muted === true,
    serverDeafened: row.server_deafened === true,
    timeoutUntil: row.timeout_until ? String(row.timeout_until) : null,
    roles: Array.isArray(row.roles) ? row.roles : [],
  }));
}
