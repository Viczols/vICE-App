import argon2 from "argon2";
import { db } from "../db";

export async function createUser(
  email: string,
  password: string,
  displayName: string,
  username: string
) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const r = await db.query(
    `INSERT INTO users (email, password_hash, display_name, username)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, username, display_name, role, avatar_url, status`,
    [email.toLowerCase(), passwordHash, displayName, username.toLowerCase()]
  );

  return {
    id: r.rows[0].id,
    email: r.rows[0].email,
    username: r.rows[0].username,
    displayName: r.rows[0].display_name,
    role: r.rows[0].role,
    avatarUrl: r.rows[0].avatar_url ?? null,
    status: r.rows[0].status ?? "online",
  };
}

export async function verifyUser(email: string, password: string) {
  const r = await db.query(
    `SELECT id, email, username, password_hash, display_name, role, is_banned, avatar_url, status
     FROM users
     WHERE email = $1`,
    [email.toLowerCase()]
  );

  if (r.rowCount === 0) return null;

  const u = r.rows[0];
  if (u.is_banned) return null;

  const ok = await argon2.verify(u.password_hash, password);
  if (!ok) return null;

  await db.query(`UPDATE users SET last_login_at = now() WHERE id = $1`, [u.id]);

  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    avatarUrl: u.avatar_url ?? null,
    status: u.status ?? "online",
  };
}

export function normalizeUsernameCandidate(value: string) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, 20);
}

export function isValidUsernameFormat(username: string) {
  return /^[a-z0-9._]{3,20}$/.test(username);
}

export async function isUsernameAvailable(username: string) {
  const normalized = normalizeUsernameCandidate(username);

  if (!isValidUsernameFormat(normalized)) {
    return {
      available: false,
      normalized,
      reason: "INVALID_USERNAME",
    };
  }

  const r = await db.query(
    `SELECT 1
     FROM users
     WHERE lower(username) = lower($1)
     LIMIT 1`,
    [normalized]
  );

  return {
    available: (r.rowCount ?? 0) === 0,
    normalized,
    reason: (r.rowCount ?? 0) === 0 ? null : "USERNAME_IN_USE",
  };
}

function uniquePreserveOrder(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function buildBaseSlug(displayName: string) {
  const cleaned = String(displayName ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^a-z0-9._]/g, "");

  return cleaned.slice(0, 20);
}

function clipUsername(value: string) {
  return normalizeUsernameCandidate(value).slice(0, 20);
}

function seededShuffle<T>(items: T[], seed: number) {
  const arr = [...items];
  let s = seed || 1;

  function next() {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  }

  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

export async function generateUsernameSuggestions(
  displayName: string,
  refreshSeed = 0
) {
  const baseRaw = buildBaseSlug(displayName);
  const fallbackBase = baseRaw.length >= 3 ? baseRaw : "user";
  const base = fallbackBase.slice(0, 20);

  const prefixes = [
    "",
    "real",
    "its",
    "the",
    "hey",
    "yo",
    "im",
    "iam",
    "itsme",
    "mr",
    "ms",
    "dev",
    "pro",
    "official",
    "true",
    "only",
    "just",
    "one",
    "neo",
    "ultra",
    "hyper",
    "dark",
    "light",
    "void",
    "prime",
    "alpha",
    "beta",
    "omega",
    "pixel",
    "ghost",
    "lil",
    "big",
    "super",
    "mega",
  ];

  const suffixes = [
    "",
    "1",
    "2",
    "3",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
    "17",
    "21",
    "22",
    "23",
    "24",
    "27",
    "31",
    "33",
    "37",
    "42",
    "47",
    "51",
    "58",
    "66",
    "69",
    "77",
    "88",
    "90",
    "99",
    "101",
    "247",
    "360",
    "404",
    "777",
    "999",
    "_x",
    "_tv",
    "_live",
    "_real",
    "_dev",
    "_gg",
    "_fps",
    "_hub",
    "_v",
    "_core",
    "_alt",
    "_yt",
    "_exe",
    ".x",
    ".tv",
    ".live",
    ".gg",
    ".dev",
    ".exe",
    ".lol",
    ".io",
    ".hub",
    ".zone",
    ".net",
  ];

  const separators = ["", "_", "."];
  const rawCandidates: string[] = [];

  rawCandidates.push(base);
  rawCandidates.push(clipUsername(`${base}1`));
  rawCandidates.push(clipUsername(`${base}01`));
  rawCandidates.push(clipUsername(`${base}_x`));
  rawCandidates.push(clipUsername(`${base}.dev`));
  rawCandidates.push(clipUsername(`${base}24`));
  rawCandidates.push(clipUsername(`${base}247`));
  rawCandidates.push(clipUsername(`real${base}`));
  rawCandidates.push(clipUsername(`${base}_real`));
  rawCandidates.push(clipUsername(`${base}.live`));

  for (const prefix of prefixes) {
    for (const separator of separators) {
      const left = prefix ? `${prefix}${separator}` : "";
      rawCandidates.push(clipUsername(`${left}${base}`));
    }
  }

  for (const suffix of suffixes) {
    rawCandidates.push(clipUsername(`${base}${suffix}`));
  }

  for (const prefix of prefixes) {
    for (const suffix of suffixes) {
      if (!prefix && !suffix) continue;
      rawCandidates.push(clipUsername(`${prefix}${base}${suffix}`));
      rawCandidates.push(clipUsername(`${prefix}_${base}${suffix}`));
      rawCandidates.push(clipUsername(`${prefix}.${base}${suffix}`));
    }
  }

  for (let i = 2; i <= 250; i++) {
    rawCandidates.push(clipUsername(`${base}${i}`));
    rawCandidates.push(clipUsername(`${base}_${i}`));
    rawCandidates.push(clipUsername(`${base}.${i}`));
    rawCandidates.push(clipUsername(`${base}${i}${i}`));
    rawCandidates.push(clipUsername(`${base}${i}x`));
    rawCandidates.push(clipUsername(`${base}x${i}`));
  }

  const filteredCandidates = uniquePreserveOrder(rawCandidates).filter(
    (item) => isValidUsernameFormat(item) && item.length >= 3
  );

  const shuffledCandidates = seededShuffle(
    filteredCandidates,
    Math.abs(Number(refreshSeed) || 0) + base.length + 17
  );

  const lookupPool = shuffledCandidates.slice(0, 900);

  if (lookupPool.length === 0) {
    return [];
  }

  const r = await db.query(
    `SELECT username
     FROM users
     WHERE lower(username) = ANY($1::text[])`,
    [lookupPool.map((x) => x.toLowerCase())]
  );

  const taken = new Set<string>(
    r.rows.map((row) => String(row.username).toLowerCase())
  );

  return lookupPool.filter((candidate) => !taken.has(candidate)).slice(0, 8);
}