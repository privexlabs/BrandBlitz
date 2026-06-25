import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

const REVALIDATION_SECRET = process.env.REVALIDATION_SECRET;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.secret !== REVALIDATION_SECRET) {
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }

    if (Array.isArray(body.paths)) {
      for (const path of body.paths) {
        if (typeof path === "string") {
          revalidatePath(path);
        }
      }
    }

    if (Array.isArray(body.tags)) {
      for (const tag of body.tags) {
        if (typeof tag === "string") {
          revalidateTag(tag);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
