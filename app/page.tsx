"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Cherry, ChevronDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getLocalRooms, saveLocalRoom, type LocalRoom } from "@/lib/local-rooms";
import { formatSupabaseError, hasSupabaseEnv, supabase } from "@/lib/supabase";

function roomCode(roomId: string) {
  return roomId.slice(0, 6).toUpperCase();
}

export default function Home() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [savedRooms, setSavedRooms] = useState<LocalRoom[]>([]);
  const [roomsExpanded, setRoomsExpanded] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const loadSavedRooms = window.setTimeout(() => {
      setSavedRooms(getLocalRooms());
    }, 0);

    return () => window.clearTimeout(loadSavedRooms);
  }, []);

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

    saveLocalRoom({
      id: data.id,
      playerName: trimmedName,
      label: `Room ${data.id.slice(0, 6).toUpperCase()}`,
    });
    router.push(`/room/${data.id}?created=1`);
  };

  return (
    <main className="flex min-h-screen w-full items-center justify-center overflow-y-auto bg-[#fff5f6] px-5 py-8 text-[#351316]">
      <section className="relative w-full max-w-md">
        <div className="absolute -left-14 -top-16 h-40 w-40 rounded-full bg-[#ffd1d8] blur-2xl" />
        <div className="absolute -bottom-16 -right-14 h-44 w-44 rounded-full bg-[#ffe3b3] blur-2xl" />

        <div className="relative overflow-hidden rounded-[2.25rem] border border-white/80 bg-white/90 p-6 shadow-[0_18px_54px_rgba(154,25,42,0.10)] backdrop-blur-xl">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[1.65rem] bg-[#e11d48] shadow-[0_5px_0_#f8cbd2]">
            <Cherry className="h-9 w-9 text-white" />
          </div>

          <div className="space-y-3 text-center">
            <h1 className="text-4xl font-black tracking-tight text-[#351316]">FoodMatch</h1>
            <p className="mx-auto max-w-xs text-base font-bold leading-6 text-[#7a3a43]">
              Шлях до твого серця лежить через шлунок. Створіть кімнату і знайдіть страву, яка подобається обом.
            </p>
          </div>

          <div className="mt-8 space-y-4">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Твоє ім'я"
              className="h-14 rounded-2xl border-2 border-[#ffd1d8] bg-white px-4 text-lg font-bold shadow-inner"
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
              className="btn-duo-primary h-14 w-full rounded-2xl text-lg disabled:opacity-60"
            >
              {loading ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              Створити інвайт
            </Button>
          </div>

          <p className="mt-5 text-center text-xs font-bold text-[#9f5660]">
            Надішли посилання своїй людині і свайпайте до першого смачного метчу.
          </p>
        </div>

        {savedRooms.length > 0 ? (
          <div className="relative mt-3 overflow-hidden rounded-[1.6rem] border-2 border-[#ffd1d8] bg-white/90 shadow-[0_4px_0_#ffe9ed] backdrop-blur-xl">
            <button
              type="button"
              onClick={() => setRoomsExpanded((expanded) => !expanded)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              aria-expanded={roomsExpanded}
            >
              <span className="text-sm font-black uppercase tracking-[0.14em] text-[#9f5660]">Мої кімнати</span>
              <ChevronDown className={`text-[#be123c] transition-transform ${roomsExpanded ? "rotate-180" : ""}`} />
            </button>
            {roomsExpanded ? (
              <div className="space-y-2 border-t border-[#ffe4e8] p-3">
                {savedRooms.map((savedRoom) => (
                  <button
                    key={savedRoom.id}
                    type="button"
                    onClick={() => router.push(`/room/${savedRoom.id}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-[#ffe4e8] bg-white px-3 py-2.5 text-left transition hover:border-[#e11d48]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-[#351316]">Room {roomCode(savedRoom.id)}</span>
                      <span className="block truncate text-xs font-bold text-[#9f5660]">Ти: {savedRoom.playerName}</span>
                    </span>
                    <ArrowRight className="text-[#be123c]" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
