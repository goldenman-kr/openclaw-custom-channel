import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type UserRole = "admin" | "user";

export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
  disabledAt?: string;
}

export interface PublicUserRecord {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
}

export interface AuthSessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
}


interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
  disabled_at: string | null;
}

interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}


export class AuthStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    const resolvedPath = resolve(dbPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new Database(resolvedPath);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  createUser(input: { id?: string; username: string; displayName?: string; password: string; role?: UserRole; now?: string }): PublicUserRecord {
    const now = input.now ?? new Date().toISOString();
    const id = input.id ?? `usr_${randomUUID()}`;
    const username = normalizeUsername(input.username);
    const displayName = input.displayName?.trim() || username;
    this.db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
       VALUES (@id, @username, @displayName, @passwordHash, @role, @now)`,
    ).run({ id, username, displayName, passwordHash: hashPassword(input.password), role: input.role ?? "user", now });
    const user = this.getUserById(id);
    if (!user) {
      throw new Error("Failed to create user.");
    }
    return publicUser(user);
  }

  ensureUser(input: { id?: string; username: string; displayName?: string; password: string; role?: UserRole; now?: string }): PublicUserRecord {
    const username = normalizeUsername(input.username);
    const existing = this.getUserByUsername(username);
    if (!existing) {
      return this.createUser({ ...input, username });
    }

    const displayName = input.displayName?.trim() || existing.displayName || username;
    this.db.prepare(
      `UPDATE users
       SET display_name = @displayName,
           password_hash = @passwordHash,
           role = @role,
           disabled_at = NULL
       WHERE id = @id`,
    ).run({
      id: existing.id,
      displayName,
      passwordHash: hashPassword(input.password),
      role: input.role ?? existing.role,
    });

    const user = this.getUserById(existing.id);
    if (!user) {
      throw new Error("Failed to ensure user.");
    }
    return publicUser(user);
  }

  listUsers(): PublicUserRecord[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY created_at ASC, username ASC").all() as UserRow[];
    return rows.map(mapUser).map(publicUser);
  }

  getUserById(id: string): UserRecord | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  getUserByUsername(username: string): UserRecord | null {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(normalizeUsername(username)) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  verifyPassword(username: string, password: string): UserRecord | null {
    const user = this.getUserByUsername(username);
    if (!user || user.disabledAt || !verifyPassword(password, user.passwordHash)) {
      return null;
    }
    return user;
  }

  resetPassword(username: string, password: string): boolean {
    const result = this.db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(hashPassword(password), normalizeUsername(username));
    return result.changes > 0;
  }

  disableUser(username: string, now = new Date().toISOString()): boolean {
    const result = this.db.prepare("UPDATE users SET disabled_at = ? WHERE username = ?").run(now, normalizeUsername(username));
    return result.changes > 0;
  }

  enableUser(username: string): boolean {
    const result = this.db.prepare("UPDATE users SET disabled_at = NULL WHERE username = ?").run(normalizeUsername(username));
    return result.changes > 0;
  }

  createSession(userId: string, input: { ttlMs?: number; now?: Date } = {}): { session: AuthSessionRecord; token: string } {
    const nowDate = input.now ?? new Date();
    const createdAt = nowDate.toISOString();
    const expiresAt = new Date(nowDate.getTime() + (input.ttlMs ?? 30 * 24 * 60 * 60 * 1000)).toISOString();
    const token = randomBytes(32).toString("base64url");
    const session = {
      id: `sess_${randomUUID()}`,
      userId,
      tokenHash: hashToken(token),
      createdAt,
      expiresAt,
    };
    this.db.prepare(
      `INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
       VALUES (@id, @userId, @tokenHash, @createdAt, @expiresAt)`,
    ).run(session);
    return { session, token };
  }

  getSessionByToken(token: string, now = new Date()): { session: AuthSessionRecord; user: UserRecord } | null {
    const tokenHash = hashToken(token);
    const row = this.db.prepare("SELECT * FROM auth_sessions WHERE token_hash = ?").get(tokenHash) as AuthSessionRow | undefined;
    if (!row) {
      return null;
    }
    const session = mapSession(row);
    if (session.revokedAt || Date.parse(session.expiresAt) <= now.getTime()) {
      return null;
    }
    const user = this.getUserById(session.userId);
    if (!user || user.disabledAt) {
      return null;
    }
    return { session, user };
  }

  revokeSessionByToken(token: string, now = new Date().toISOString()): boolean {
    const result = this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL").run(now, hashToken(token));
    return result.changes > 0;
  }


  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        disabled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );


      CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);
  }
}

export function publicUser(user: UserRecord): PublicUserRecord {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
  };
}

export function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{1,62}$/.test(normalized)) {
    throw new Error("Username must be 2-63 chars and contain only lowercase letters, numbers, '.', '_' or '-'.");
  }
  return normalized;
}

function hashPassword(password: string): string {
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  const salt = randomBytes(16).toString("base64url");
  const key = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString("base64url");
  return `scrypt$N=16384,r=8,p=1$${salt}$${key}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "scrypt") {
    return false;
  }
  const [, , salt, key] = parts;
  const expected = Buffer.from(key, "base64url");
  const actual = scryptSync(password, salt, expected.length, { N: 16384, r: 8, p: 1 });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    passwordHash: row.password_hash,
    role: row.role,
    createdAt: row.created_at,
    ...(row.disabled_at ? { disabledAt: row.disabled_at } : {}),
  };
}

function mapSession(row: AuthSessionRow): AuthSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
  };
}

