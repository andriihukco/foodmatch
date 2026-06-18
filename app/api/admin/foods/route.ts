import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { adminCookieName, createAdminSupabaseClient, verifyAdminSession } from "@/lib/admin-auth";
import type { FoodType, MealType } from "@/lib/types";

const editableFields = ["name", "image_url", "ingredients", "instructions"] as const;

type EditableField = (typeof editableFields)[number];

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

async function assertAdmin() {
  const cookieStore = await cookies();
  return verifyAdminSession(cookieStore.get(adminCookieName)?.value);
}

function asNullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function GET(request: NextRequest) {
  if (!(await assertAdmin())) return unauthorized();

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(Number.parseInt(searchParams.get("page") ?? "1", 10), 1);
  const pageSize = Math.min(Math.max(Number.parseInt(searchParams.get("pageSize") ?? "40", 10), 1), 100);
  const type = searchParams.get("type") as FoodType | "all" | null;
  const search = searchParams.get("search")?.trim();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const supabase = createAdminSupabaseClient();
  let query = supabase
    .from("foods")
    .select("id,name,image_url,food_type,meal_type,tags,source,external_id,ingredients,instructions,created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (type && type !== "all") {
    query = query.eq("food_type", type);
  }
  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const { data, count, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ foods: data ?? [], count: count ?? 0, page, pageSize });
}

export async function PATCH(request: NextRequest) {
  if (!(await assertAdmin())) return unauthorized();

  const payload = (await request.json().catch(() => null)) as
    | {
        id?: unknown;
        name?: unknown;
        image_url?: unknown;
        ingredients?: unknown;
        instructions?: unknown;
        food_type?: unknown;
        meal_type?: unknown;
      }
    | null;

  if (!payload || typeof payload.id !== "string") {
    return NextResponse.json({ error: "Food id is required." }, { status: 400 });
  }

  const update: Partial<Record<EditableField, string | null> & { food_type: FoodType | null; meal_type: MealType | null }> = {};
  editableFields.forEach((field) => {
    if (field in payload) {
      update[field] = field === "name" ? asNullableString(payload[field]) ?? "" : asNullableString(payload[field]);
    }
  });

  if ("food_type" in payload) {
    update.food_type = asNullableString(payload.food_type) as FoodType | null;
  }
  if ("meal_type" in payload) {
    update.meal_type = asNullableString(payload.meal_type) as MealType | null;
  }

  if (!update.name && "name" in update) {
    return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
  }

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("foods")
    .update(update)
    .eq("id", payload.id)
    .select("id,name,image_url,food_type,meal_type,tags,source,external_id,ingredients,instructions,created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ food: data });
}
