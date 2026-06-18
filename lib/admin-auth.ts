import { createHmac, timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

export const adminCookieName = "foodmatch_admin";

const sessionMaxAgeSeconds = 60 * 60 * 12;

function adminSecret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

export function adminCookieMaxAge() {
  return sessionMaxAgeSeconds;
}

export function signAdminSession() {
  const secret = adminSecret();
  if (!secret) return "";

  const expires = Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds;
  const payload = `admin:${expires}`;
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}:${signature}`;
}

export function verifyAdminSession(value: string | undefined) {
  const secret = adminSecret();
  if (!secret || !value) return false;

  const [role, expiresRaw, signature] = value.split(":");
  const expires = Number.parseInt(expiresRaw ?? "", 10);
  if (role !== "admin" || !Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000) || !signature) {
    return false;
  }

  const payload = `${role}:${expires}`;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function verifyAdminPassword(password: string) {
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedPassword) return false;

  const actualBuffer = Buffer.from(password);
  const expectedBuffer = Buffer.from(expectedPassword);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function createAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Admin Supabase env is missing. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}
