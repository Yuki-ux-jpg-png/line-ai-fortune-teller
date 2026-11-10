import crypto from "node:crypto";
import { query, withTransaction } from "./db.js";
import { WebError } from "./web-auth.js";
export const webCodePattern = /^KB-[A-F0-9]{32}$/;
const hash = (code: string) =>
  crypto.createHash("sha256").update(code).digest("hex");
export async function webIdentity(id: string): Promise<string | null> {
  await query(
    "INSERT INTO web_identities(web_user_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [id],
  );
  const r = await query<{ canonical_user_id: string | null }>(
    "SELECT canonical_user_id FROM web_identities WHERE web_user_id=$1",
    [id],
  );
  return r.rows[0]?.canonical_user_id ?? null;
}
export async function startWebIdentity(id: string): Promise<void> {
  await withTransaction(async (c) => {
    await c.query(
      "INSERT INTO web_identities(web_user_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [id],
    );
    const r = await c.query(
      "SELECT canonical_user_id FROM web_identities WHERE web_user_id=$1 FOR UPDATE",
      [id],
    );
    if (r.rows[0]?.canonical_user_id) return;
    const canonical = `web:${id}`;
    await c.query(
      "INSERT INTO users(line_user_id) VALUES ($1) ON CONFLICT DO NOTHING",
      [canonical],
    );
    await c.query(
      "UPDATE web_identities SET canonical_user_id=$2 WHERE web_user_id=$1",
      [id, canonical],
    );
    await c.query("DELETE FROM web_link_requests WHERE web_user_id=$1", [id]);
  });
}
export async function createWebLink(id: string): Promise<string> {
  await webIdentity(id);
  const code = `KB-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
  await withTransaction(async (c) => {
    const r = await c.query(
      "SELECT canonical_user_id FROM web_identities WHERE web_user_id=$1 FOR UPDATE",
      [id],
    );
    if (r.rows[0]?.canonical_user_id)
      throw new WebError(
        409,
        "利用開始後の連携変更は、履歴と利用枠の確認が必要です。運営へご相談ください。",
      );
    await c.query("DELETE FROM web_link_requests WHERE web_user_id=$1", [id]);
    await c.query(
      "INSERT INTO web_link_requests(token_hash,web_user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')",
      [hash(code), id],
    );
  });
  return code;
}
/** Called only after LINE webhook signature verification. A message alone is not consent. */
export async function prepareWebLink(
  code: string,
  lineId: string,
): Promise<boolean> {
  if (!webCodePattern.test(code) || !/^U[a-f0-9]{32}$/i.test(lineId))
    return false;
  const r = await query(
    `UPDATE web_link_requests SET candidate_line_id=$2
    WHERE token_hash=$1 AND expires_at>now() AND (candidate_line_id IS NULL OR candidate_line_id=$2)
    RETURNING web_user_id`,
    [hash(code), lineId],
  );
  return Boolean(r.rowCount);
}
/** Immutable mapping: no entitlement merging, old consultation changes, or account reassignment. */
export async function approveWebLink(
  code: string,
  lineId: string,
): Promise<boolean> {
  if (!webCodePattern.test(code)) return false;
  return withTransaction(async (c) => {
    const link = await c.query(
      `SELECT web_user_id FROM web_link_requests
      WHERE token_hash=$1 AND candidate_line_id=$2 AND expires_at>now() FOR UPDATE`,
      [hash(code), lineId],
    );
    const id = link.rows[0]?.web_user_id;
    if (!id) return false;
    const identity = await c.query(
      "SELECT canonical_user_id FROM web_identities WHERE web_user_id=$1 FOR UPDATE",
      [id],
    );
    if (identity.rows[0]?.canonical_user_id) return false;
    await c.query(
      "INSERT INTO users(line_user_id) VALUES($1) ON CONFLICT DO NOTHING",
      [lineId],
    );
    await c.query(
      "SELECT line_user_id FROM users WHERE line_user_id=$1 FOR UPDATE",
      [lineId],
    );
    const used = await c.query(
      "SELECT 1 FROM web_identities WHERE canonical_user_id=$1",
      [lineId],
    );
    if (used.rowCount) return false;
    await c.query(
      "UPDATE web_identities SET canonical_user_id=$2 WHERE web_user_id=$1",
      [id, lineId],
    );
    await c.query("DELETE FROM web_link_requests WHERE web_user_id=$1", [id]);
    return true;
  });
}
export async function webRateLimit(
  id: string,
  bucket: string,
  limit: number,
): Promise<void> {
  const r = await query<{ attempts: number }>(
    `INSERT INTO web_request_limits(web_user_id,bucket,period,attempts)
    VALUES($1,$2,date_trunc('hour',now()),1)
    ON CONFLICT(web_user_id,bucket,period) DO UPDATE SET attempts=web_request_limits.attempts+1
    RETURNING attempts`,
    [id, bucket],
  );
  if ((r.rows[0]?.attempts ?? limit + 1) > limit)
    throw new WebError(
      429,
      "利用回数の上限に達しました。時間をおいてお試しください。",
    );
}
