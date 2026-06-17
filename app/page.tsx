"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSupabaseError, hasSupabaseEnv, supabase } from "@/lib/supabase";

export default function Home() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const createRoom = async () => {
    if (!supabase || !hasSupabaseEnv) {
      setError(
        "Додай NEXT_PUBLIC_SUPABASE_URL та NEXT_PUBLIC_SUPABASE_ANON_KEY у .env.local, потім перезапусти npm run dev.",
      );
      return;
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Введи своє ім'я, щоб створити кімнату.");
      return;
    }

    setLoading(true);
    setError("");

    const { data, error: insertError } = await supabase
      .from("rooms")
      .insert({ user_1_name: trimmedName })
      .select("id")
      .single();

    setLoading(false);

    if (insertError || !data) {
      setError(
        insertError
          ? formatSupabaseError("Не вдалося створити кімнату", insertError)
          : "Не вдалося створити кімнату: Supabase не повернув ID кімнати.",
      );
      return;
    }

    window.localStorage.setItem(`foodmatch:room:${data.id}:player`, trimmedName);
    router.push(`/room/${data.id}`);
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center overflow-hidden bg-[#f4fbef] px-5 py-8">
      <section className="relative w-full max-w-md">
        <div className="absolute -left-14 -top-16 h-40 w-40 rounded-full bg-[#d9f8c8] blur-2xl" />
        <div className="absolute -bottom-16 -right-14 h-44 w-44 rounded-full bg-[#fff1ad] blur-2xl" />

        <div className="relative overflow-hidden rounded-[2.25rem] border border-white/80 bg-white/85 p-6 shadow-[0_24px_80px_rgba(55,91,35,0.16)] backdrop-blur-xl">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.65rem] bg-[#58cc02] shadow-[0_10px_0_#46a302]">
            <Sparkles className="h-9 w-9 text-white" />
          </div>

          <div className="space-y-3 text-center">
            <h1 className="text-4xl font-black tracking-tight text-[#1f2a1b]">FoodMatch</h1>
            <p className="mx-auto max-w-xs text-base font-bold leading-6 text-[#64725d]">
              Оберіть страву разом без довгих обговорень.
            </p>
          </div>

          <div className="mt-8 space-y-4">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Як тебе звати?"
              className="h-14 rounded-2xl border-2 border-[#d8efc8] bg-white px-4 text-lg font-bold shadow-inner"
            />
            {error ? <p className="text-sm font-bold text-[#ea2b2b]">{error}</p> : null}
            {!hasSupabaseEnv ? (
              <p className="rounded-2xl bg-[#fff4f4] p-3 text-sm font-bold text-[#b42318]">
                Відсутні env змінні Supabase. Скопіюй `.env.example` в `.env.local` і заповни ключі.
              </p>
            ) : null}
            <Button
              onClick={createRoom}
              disabled={loading || !hasSupabaseEnv}
              className="btn-duo-green h-14 w-full rounded-2xl text-lg disabled:opacity-60"
            >
              {loading ? <Loader2 className="animate-spin" /> : <ArrowRight className="h-5 w-5" />}
              Створити кімнату
            </Button>
          </div>

          <p className="mt-5 text-center text-xs font-bold text-[#8a9684]">
            Запроси партнера посиланням і свайпайте до першого метчу.
          </p>
        </div>
      </section>
    </main>
  );
}
