import { NextResponse, type NextRequest } from "next/server";

// Optimistic gate only: pages and actions still verify the session themselves.
export function proxy(request: NextRequest) {
  if (!request.cookies.has("nabd_session")) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
