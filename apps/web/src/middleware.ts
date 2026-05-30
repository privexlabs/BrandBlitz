import { NextRequest, NextResponse } from "next/server";

const REF_COOKIE_NAME = "ref";
const REF_TTL_SECONDS = 30 * 24 * 60 * 60;

function normalizeCode(code: string): string | null {
  const value = code.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(value) ? value : null;
}

export function middleware(request: NextRequest): NextResponse {
  const referralCode = request.nextUrl.searchParams.get("ref");
  if (!referralCode) {
    return NextResponse.next();
  }

  const normalizedCode = normalizeCode(referralCode);
  if (!normalizedCode) {
    return NextResponse.next();
  }

  const response = NextResponse.next();
  response.cookies.set(REF_COOKIE_NAME, normalizedCode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: REF_TTL_SECONDS,
    secure: request.nextUrl.protocol === "https:",
  });

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
