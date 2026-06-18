import { NextRequest, NextResponse } from "next/server";

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isAdminHost(hostname: string) {
  const configuredHost = process.env.ADMIN_HOST?.toLowerCase();
  if (configuredHost && hostname === configuredHost) return true;
  return hostname.startsWith("admin.");
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  const pathname = request.nextUrl.pathname;
  const adminHost = isAdminHost(host);
  const localHost = isLocalHost(host);

  if (adminHost && pathname === "/") {
    return NextResponse.rewrite(new URL("/admin", request.url));
  }

  if (adminHost && !pathname.startsWith("/admin") && !pathname.startsWith("/api/admin")) {
    return NextResponse.rewrite(new URL("/admin", request.url));
  }

  if ((pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) && !adminHost && !localHost) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
