import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseEnv = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseEnv ? createClient(supabaseUrl!, supabaseAnonKey!) : null;

type SupabaseError = {
  code?: string;
  message?: string;
};

export function formatSupabaseError(action: string, error: SupabaseError) {
  if (error.code === "42501") {
    return `${action}: бракує RLS policy у Supabase. Виконай оновлений supabase/schema.sql у SQL Editor.`;
  }

  if (error.code === "42P01") {
    return `${action}: таблицю не знайдено. Виконай supabase/schema.sql у Supabase SQL Editor.`;
  }

  if (error.code === "42703") {
    return `${action}: структура таблиці застаріла. Повторно виконай supabase/schema.sql.`;
  }

  return `${action}: ${error.message ?? "невідома помилка Supabase"}`;
}
