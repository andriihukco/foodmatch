import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  adminCookieMaxAge,
  adminCookieName,
  signAdminSession,
  verifyAdminPassword,
  verifyAdminSession,
} from "@/lib/admin-auth";

export async function GET() {
  const cookieStore = await cookies();
  const authenticated = verifyAdminSession(cookieStore.get(adminCookieName)?.value);
  return NextResponse.json({ authenticated });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as { password?: string } | null;
  const password = payload?.password ?? "";

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ error: "Невірний пароль." }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(adminCookieName, signAdminSession(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: adminCookieMaxAge(),
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(adminCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  });
  return response;
}
