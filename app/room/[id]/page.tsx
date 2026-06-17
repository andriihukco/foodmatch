"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Check, GalleryHorizontalEnd, Heart, Link2, Loader2, RotateCcw, SlidersHorizontal, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatSupabaseError, hasSupabaseEnv, supabase } from "@/lib/supabase";
import type { Food, Room, SwipeAction } from "@/lib/types";

type FoodMap = Record<string, Food>;
type FoodTypeFilter = "all" | "recipe" | "ingredient";
type SwipeDirection = SwipeAction | null;
type LastSwipe = { food: Food; action: SwipeAction } | null;

const foodTypeOptions: Array<{ value: FoodTypeFilter; label: string }> = [
  { value: "all", label: "Усі" },
  { value: "recipe", label: "Страви" },
  { value: "ingredient", label: "Інгредієнти" },
];

const visibleFoodSources = ["themealdb-ingredient-list", "themealdb-meal-list"];

function dedupeFoods(items: Food[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isFood(food: Food | undefined): food is Food {
  return Boolean(food);
}

function optionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T) {
  return options.find((option) => option.value === value)?.label ?? "";
}

function playerStorageKey(roomId: string) {
  return `foodmatch:room:${roomId}:player`;
}

function FoodPreviewButton({ food, onClick }: { food: Food; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border-2 border-[#e5e5e5] bg-white p-2.5 text-left transition hover:border-[#58cc02]"
    >
      {food.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={food.image_url} alt={food.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#eaf8df] text-2xl">🍽️</div>
      )}
      <span className="min-w-0">
        <span className="block truncate text-base font-black text-[#25321f]">{food.name}</span>
        {food.ingredients ? (
          <span className="mt-0.5 block truncate text-xs font-bold text-[#64725d]">{food.ingredients}</span>
        ) : null}
      </span>
    </button>
  );
}

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const roomId = params.id;

  const [room, setRoom] = useState<Room | null>(null);
  const [name, setName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [loadingFoods, setLoadingFoods] = useState(false);
  const [foodTypeFilter, setFoodTypeFilter] = useState<FoodTypeFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [foods, setFoods] = useState<Food[]>([]);
  const [foodMap, setFoodMap] = useState<FoodMap>({});
  const [myLikes, setMyLikes] = useState<string[]>([]);
  const [myDislikes, setMyDislikes] = useState<string[]>([]);
  const [theirLikes, setTheirLikes] = useState<string[]>([]);
  const [theirDislikes, setTheirDislikes] = useState<string[]>([]);
  const [matchFood, setMatchFood] = useState<Food | null>(null);
  const [error, setError] = useState("");
  const [resultView, setResultView] = useState<"matches" | "mine" | "partner">("matches");
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection>(null);
  const [swipingFoodId, setSwipingFoodId] = useState<string | null>(null);
  const [lastSwipe, setLastSwipe] = useState<LastSwipe>(null);
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const swipedIdsRef = useRef(new Set<string>());

  const isKnownPlayer = useMemo(() => {
    if (!room || !name) return false;
    return name === room.user_1_name || name === room.user_2_name;
  }, [room, name]);

  const otherName = useMemo(() => {
    if (!room) return "";
    if (name === room.user_1_name) return room.user_2_name ?? "партнер";
    return room.user_1_name;
  }, [name, room]);

  const roomStatus = useMemo(() => {
    if (!room || !name) return "Шлях до серця лежить через шлунок";
    if (room.user_2_name === null) return "Запроси свою людину";
    return `Ти: ${name}`;
  }, [name, room]);

  const refreshRoom = useCallback(async () => {
    if (!supabase) {
      setLoadingRoom(false);
      setError("Відсутні Supabase env змінні. Додай їх у .env.local.");
      return;
    }
    setLoadingRoom(true);
    const { data, error: roomError } = await supabase.from("rooms").select("*").eq("id", roomId).single();
    setLoadingRoom(false);
    if (roomError || !data) {
      setError(roomError ? formatSupabaseError("Не вдалося завантажити кімнату", roomError) : "Кімнату не знайдено.");
      return;
    }
    setRoom(data as Room);
    const storedName = window.localStorage.getItem(playerStorageKey(roomId)) ?? "";
    if (storedName && (storedName === data.user_1_name || storedName === data.user_2_name)) {
      setName(storedName);
    }
  }, [roomId]);

  const loadSwipes = useCallback(async () => {
    if (!room || !name || !supabase) return;
    const { data, error: swipesError } = await supabase
      .from("swipes")
      .select("food_id, user_name, action")
      .eq("room_id", room.id);

    if (swipesError) {
      setError(formatSupabaseError("Не вдалося завантажити свайпи", swipesError));
      return;
    }
    if (!data) return;

    const meLikes: string[] = [];
    const meDislikes: string[] = [];
    const partnerLikes: string[] = [];
    const partnerDislikes: string[] = [];

    data.forEach((swipe) => {
      if (swipe.user_name === name) {
        if (swipe.action === "like") meLikes.push(swipe.food_id);
        if (swipe.action === "dislike") meDislikes.push(swipe.food_id);
      } else {
        if (swipe.action === "like") partnerLikes.push(swipe.food_id);
        if (swipe.action === "dislike") partnerDislikes.push(swipe.food_id);
      }
    });

    setMyLikes(meLikes);
    setMyDislikes(meDislikes);
    setTheirLikes(partnerLikes);
    setTheirDislikes(partnerDislikes);
    swipedIdsRef.current = new Set([...meLikes, ...meDislikes]);
  }, [name, room]);

  const loadFoods = useCallback(async (mode: "replace" | "append" = "replace") => {
    if (!name || !room || !supabase) return;
    setLoadingFoods(true);
    const swipedIds = [...swipedIdsRef.current];

    let query = supabase.from("foods").select("*").in("source", visibleFoodSources).order("created_at", { ascending: false }).limit(36);
    if (foodTypeFilter !== "all") {
      query = query.eq("food_type", foodTypeFilter);
    }

    if (swipedIds.length > 0) {
      query = query.not("id", "in", `(${swipedIds.join(",")})`);
    }

    const { data, error: foodsError } = await query;
    setLoadingFoods(false);

    if (foodsError || !data) {
      setError(foodsError ? formatSupabaseError("Не вдалося завантажити картки їжі", foodsError) : "Не вдалося завантажити картки їжі.");
      return;
    }

    const incomingFoods = dedupeFoods(data as Food[]);
    setFoods((prev) => {
      if (mode === "replace") return incomingFoods;
      return dedupeFoods([...prev, ...incomingFoods]);
    });
    setFoodMap((prev) => {
      const next = { ...prev };
      incomingFoods.forEach((food) => {
        next[food.id] = food;
      });
      return next;
    });
  }, [foodTypeFilter, name, room]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRoom();
  }, [refreshRoom]);

  useEffect(() => {
    if (!room || !name || !supabase) return;
    const supabaseClient = supabase;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSwipes();

    const channel = supabaseClient
      .channel(`room-${room.id}-swipes`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "swipes", filter: `room_id=eq.${room.id}` },
        async (payload) => {
          const swipe = payload.new as { food_id: string; user_name: string; action: SwipeAction };
          if (swipe.user_name === name) return;
          if (swipe.action === "like" && myLikes.includes(swipe.food_id) && foodMap[swipe.food_id]) {
            setMatchFood(foodMap[swipe.food_id]);
          }
          await loadSwipes();
        },
      )
      .subscribe();

    return () => {
      void supabaseClient.removeChannel(channel);
    };
  }, [foodMap, loadSwipes, myLikes, name, room]);

  useEffect(() => {
    if (!room || !name) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFoods();
  }, [loadFoods, room, name]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href.split("?")[0]);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1800);
  };

  const clearFilters = () => {
    setFoodTypeFilter("all");
  };

  const joinRoom = async () => {
    if (!supabase) {
      setError("Supabase не налаштовано у .env.local.");
      return;
    }
    const trimmed = joinName.trim();
    if (!trimmed || !room) return;
    if (trimmed === room.user_1_name || trimmed === room.user_2_name) {
      setError("Це ім'я вже використовується в цій кімнаті.");
      return;
    }
    setIsJoining(true);
    const { error: updateError } = await supabase
      .from("rooms")
      .update({ user_2_name: trimmed })
      .eq("id", room.id)
      .is("user_2_name", null);
    setIsJoining(false);
    if (updateError) {
      setError(formatSupabaseError("Не вдалося приєднатись", updateError));
      return;
    }
    window.localStorage.setItem(playerStorageKey(room.id), trimmed);
    setName(trimmed);
    await refreshRoom();
  };

  const swipe = async (food: Food, action: SwipeAction) => {
    if (!room || !name || !supabase || swipingFoodId) return;
    setError("");
    setSwipeDirection(action);
    setSwipingFoodId(food.id);
    swipedIdsRef.current.add(food.id);
    setFoods((prev) => prev.filter((item) => item.id !== food.id));
    if (action === "like") {
      setMyLikes((prev) => (prev.includes(food.id) ? prev : [...prev, food.id]));
    } else {
      setMyDislikes((prev) => (prev.includes(food.id) ? prev : [...prev, food.id]));
    }

    const { error: swipeError } = await supabase
      .from("swipes")
      .insert({ room_id: room.id, user_name: name, food_id: food.id, action });
    if (swipeError) {
      swipedIdsRef.current.delete(food.id);
      setFoods((prev) => (prev.some((item) => item.id === food.id) ? prev : [food, ...prev]));
      if (action === "like") {
        setMyLikes((prev) => prev.filter((foodId) => foodId !== food.id));
      } else {
        setMyDislikes((prev) => prev.filter((foodId) => foodId !== food.id));
      }
      setSwipingFoodId(null);
      setSwipeDirection(null);
      setError(formatSupabaseError("Не вдалося зберегти свайп", swipeError));
      return;
    }

    if (action === "like" && theirLikes.includes(food.id)) {
      setMatchFood(food);
    }

    await loadSwipes();
    setLastSwipe({ food, action });
    if (foods.length <= 10) {
      void loadFoods("append");
    }
    setSwipingFoodId(null);
  };

  const undoLastSwipe = async () => {
    if (!lastSwipe || !room || !name || !supabase || swipingFoodId) return;
    const { food, action } = lastSwipe;
    setError("");
    setSwipingFoodId(food.id);

    const { error: undoError } = await supabase
      .from("swipes")
      .delete()
      .eq("room_id", room.id)
      .eq("user_name", name)
      .eq("food_id", food.id);

    if (undoError) {
      setSwipingFoodId(null);
      setError(formatSupabaseError("Не вдалося скасувати свайп", undoError));
      return;
    }

    swipedIdsRef.current.delete(food.id);
    setFoods((prev) => dedupeFoods([food, ...prev]));
    if (action === "like") {
      setMyLikes((prev) => prev.filter((foodId) => foodId !== food.id));
    } else {
      setMyDislikes((prev) => prev.filter((foodId) => foodId !== food.id));
    }
    setLastSwipe(null);
    await loadSwipes();
    setSwipingFoodId(null);
  };

  if (loadingRoom) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#58cc02]" />
      </main>
    );
  }

  if (!room) {
    return <main className="p-8 text-center text-lg font-bold">{error || "Кімната недоступна."}</main>;
  }

  if (!hasSupabaseEnv) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center p-6">
        <Card className="card-duo w-full">
          <CardHeader>
            <CardTitle className="text-2xl font-black">Потрібно налаштувати Supabase</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm font-semibold text-[#4b5563]">
            <p>1. Скопіюй `.env.example` у `.env.local`.</p>
            <p>2. Додай `NEXT_PUBLIC_SUPABASE_URL` і `NEXT_PUBLIC_SUPABASE_ANON_KEY`.</p>
            <p>3. Перезапусти dev сервер: `npm run dev`.</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const needsJoin = !isKnownPlayer && room.user_2_name === null;
  const needsLocalSession = !isKnownPlayer && room.user_2_name !== null;
  const topCard = foods[0];
  const matches = dedupeFoods(myLikes.filter((foodId) => theirLikes.includes(foodId)).map((foodId) => foodMap[foodId]).filter(isFood));
  const matchesActiveFilters = (food: Food) => {
    if (foodTypeFilter !== "all" && food.food_type !== foodTypeFilter) return false;
    return true;
  };
  const filteredMatches = matches.filter(matchesActiveFilters);
  const myWants = myLikes.filter((foodId) => theirDislikes.includes(foodId) || !theirLikes.includes(foodId));
  const theirWants = theirLikes.filter((foodId) => myDislikes.includes(foodId));
  const myTasteFoods = dedupeFoods(myWants.map((foodId) => foodMap[foodId]).filter(isFood)).filter(matchesActiveFilters);
  const partnerTasteFoods = dedupeFoods(theirWants.map((foodId) => foodMap[foodId]).filter(isFood)).filter(matchesActiveFilters);
  const hasActiveFilters = foodTypeFilter !== "all";
  const filterSummary = [
    optionLabel(foodTypeOptions, foodTypeFilter),
  ].filter(Boolean);

  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col gap-3 bg-[#f4fbef] px-3 py-3 pb-[calc(6.25rem+env(safe-area-inset-bottom))] text-[#25321f] sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#58cc02] shadow-[0_4px_0_#46a302]">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black leading-tight text-[#25321f]">FoodMatch</h1>
            <p className="truncate text-xs font-bold text-[#6f7b68]">{roomStatus}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={copyLink}
            className="h-11 w-11 rounded-full border-2 border-[#d8efc8] bg-white p-0 text-[#58a700] shadow-[0_4px_0_#d8efc8]"
            aria-label={copiedLink ? "Посилання скопійовано" : "Скопіювати посилання"}
          >
            {copiedLink ? <Check className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setFiltersOpen(true)}
            className="relative h-11 w-11 rounded-full border-2 border-[#d8efc8] bg-white p-0 text-[#58a700] shadow-[0_4px_0_#d8efc8]"
            aria-label="Відкрити фільтри"
          >
            <SlidersHorizontal className="h-5 w-5" />
            {hasActiveFilters ? <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-[#ff4b4b]" /> : null}
          </Button>
        </div>
      </div>
      {needsLocalSession ? (
        <Card className="card-duo">
          <CardHeader>
            <CardTitle className="text-xl font-black">Ця кімната вже для двох</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm font-bold text-[#64725d]">
            <p>Посилання саме по собі більше не відкриває чужу сесію. Зайди з пристрою, де створювалась або приєднувалась ця кімната.</p>
            <p>Попроси партнера створити нову кімнату, якщо треба почати заново.</p>
          </CardContent>
        </Card>
      ) : needsJoin ? (
        <Card className="card-duo">
          <CardHeader>
            <CardTitle className="text-xl font-black">Тебе запросили на FoodMatch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm font-bold leading-6 text-[#64725d]">
              Шлях до твого серця лежить через шлунок. Введи ім&apos;я і свайпайте разом, щоб знайти ваш смачний метч.
            </p>
            <Input
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="Твоє ім'я"
              className="h-12 rounded-2xl border-2"
            />
            <Button onClick={joinRoom} disabled={isJoining} className="btn-duo-green h-12 w-full">
              {isJoining ? <Loader2 className="animate-spin" /> : null}
              Прийняти інвайт
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="swipe" className="w-full">
          {room.user_2_name === null ? (
            <Card className="card-duo">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e7f8dc] text-[#58a700]">
                  <Link2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#25321f]">Інвайт готовий</p>
                  <p className="text-xs font-bold leading-5 text-[#64725d]">
                    Надішли посилання своїй людині. Коли вона приєднається, ваші свайпи перетворяться на метчі.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : null}
          <TabsContent value="swipe" className="space-y-4">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex w-full items-center justify-between rounded-[1.35rem] border-2 border-[#d8efc8] bg-white px-4 py-2.5 text-left shadow-[0_4px_0_#d8efc8]"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-black text-[#25321f]">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#58cc02]" />
                <span className="truncate">{filterSummary.join(" · ")}</span>
              </span>
              {hasActiveFilters ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff4b4b]" /> : null}
            </button>

            {topCard ? (
              <AnimatePresence mode="wait" onExitComplete={() => setSwipeDirection(null)}>
                <motion.div
                  key={topCard.id}
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, x: 0, rotate: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    x: swipeDirection === null ? 0 : swipeDirection === "like" ? 420 : -420,
                    rotate: swipeDirection === null ? 0 : swipeDirection === "like" ? 16 : -16,
                    scale: 0.94,
                  }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedFood(topCard)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedFood(topCard);
                    }
                  }}
                  className="flex h-[clamp(390px,calc(100svh-232px),620px)] cursor-pointer flex-col overflow-hidden rounded-[1.8rem] border-2 border-[#d8efc8] bg-white shadow-[0_8px_0_#d8efc8]"
                >
                  {topCard.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={topCard.image_url} alt={topCard.name} className="min-h-0 flex-1 object-cover" />
                  ) : (
                    <div className="flex min-h-0 flex-1 items-center justify-center bg-[#eaf8df] text-6xl">🍽️</div>
                  )}
                  <div className="shrink-0 space-y-3 p-4">
                    <div className="space-y-1.5">
                      <h2 className="line-clamp-2 text-2xl font-black leading-tight text-[#25321f]">{topCard.name}</h2>
                      {topCard.ingredients ? (
                        <p className="line-clamp-1 text-sm font-bold leading-5 text-[#64725d]">{topCard.ingredients}</p>
                      ) : null}
                    </div>
                    <div className="flex items-center justify-center gap-4 pt-1">
                      <Button
                        disabled={!topCard || swipingFoodId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void swipe(topCard, "dislike");
                        }}
                        className="btn-duo-danger h-16 w-16 rounded-full p-0 text-2xl shadow-[0_8px_20px_rgba(255,75,75,0.22)] disabled:bg-[#b7b7b7] disabled:border-[#929292]"
                        aria-label="Не хочу"
                      >
                        <ThumbsDown className="h-7 w-7" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={!lastSwipe || swipingFoodId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void undoLastSwipe();
                        }}
                        className="h-12 w-12 rounded-full border-2 border-[#d8efc8] bg-white p-0 text-[#52624a] shadow-[0_5px_0_#d8efc8] disabled:opacity-40"
                        aria-label="Назад"
                      >
                        <RotateCcw className="h-5 w-5" />
                      </Button>
                      <Button
                        disabled={!topCard || swipingFoodId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void swipe(topCard, "like");
                        }}
                        className="btn-duo-green h-16 w-16 rounded-full p-0 text-2xl shadow-[0_8px_20px_rgba(88,204,2,0.22)] disabled:bg-[#b7b7b7] disabled:border-[#929292]"
                        aria-label="Хочу"
                      >
                        <ThumbsUp className="h-7 w-7" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            ) : (
              <Card className="rounded-[2rem] border-2 border-dashed border-[#badea8] bg-white shadow-[0_8px_0_#d8efc8]">
                <CardContent className="space-y-3 py-10 text-center">
                  <p className="text-2xl font-black text-[#25321f]">Картки закінчились</p>
                  <p className="text-sm font-bold text-[#6b7280]">
                    Зміни фільтри або додай більше страв через seed script.
                  </p>
                  <Button onClick={clearFilters} className="btn-duo-yellow h-12 w-full">
                    Показати все
                  </Button>
                  {loadingFoods ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#58cc02]" /> : null}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="results" className="space-y-4">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex w-full items-center justify-between rounded-[1.6rem] border-2 border-[#d8efc8] bg-white px-4 py-3 text-left shadow-[0_4px_0_#d8efc8]"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-black text-[#25321f]">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#58cc02]" />
                <span className="truncate">{filterSummary.join(" · ")}</span>
              </span>
              {hasActiveFilters ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff4b4b]" /> : null}
            </button>

            <Card className="card-duo">
              <CardContent className="space-y-3 pt-5">
                <div className="grid grid-cols-3 gap-2 rounded-[1.25rem] border-2 border-[#e1efd9] bg-[#f6fbf2] p-1">
                  <Button
                    variant="ghost"
                    onClick={() => setResultView("matches")}
                    className={`h-11 rounded-2xl px-2 text-sm font-black ${
                      resultView === "matches" ? "bg-[#58cc02] text-white" : "text-[#52624a]"
                    }`}
                  >
                    Matches
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setResultView("mine")}
                    className={`h-11 rounded-2xl px-2 text-sm font-black ${
                      resultView === "mine" ? "bg-[#58cc02] text-white" : "text-[#52624a]"
                    }`}
                  >
                    My Смаки
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setResultView("partner")}
                    className={`h-11 rounded-2xl px-2 text-sm font-black ${
                      resultView === "partner" ? "bg-[#58cc02] text-white" : "text-[#52624a]"
                    }`}
                  >
                    {otherName}&apos;s Смаки
                  </Button>
                </div>

                {resultView === "matches" ? (
                  filteredMatches.length > 0 ? (
                    filteredMatches.map((match) => (
                      <FoodPreviewButton
                        key={match.id}
                        food={match}
                        onClick={() => setSelectedFood(match)}
                      />
                    ))
                  ) : (
                    <p className="text-sm font-semibold text-[#6b7280]">Поки що метчів немає.</p>
                  )
                ) : null}

                {resultView === "mine" ? (
                  myTasteFoods.length > 0 ? (
                    myTasteFoods.map((food) => (
                      <FoodPreviewButton
                        key={food.id}
                        food={food}
                        onClick={() => setSelectedFood(food)}
                      />
                    ))
                  ) : (
                    <p className="text-sm font-semibold text-[#6b7280]">Твоїх окремих смаків поки немає.</p>
                  )
                ) : null}

                {resultView === "partner" ? (
                  partnerTasteFoods.length > 0 ? (
                    partnerTasteFoods.map((food) => (
                      <FoodPreviewButton
                        key={food.id}
                        food={food}
                        onClick={() => setSelectedFood(food)}
                      />
                    ))
                  ) : (
                    <p className="text-sm font-semibold text-[#6b7280]">Смаки партнера ще не відрізняються.</p>
                  )
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsList className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto grid !h-[72px] w-[calc(100%-1.5rem)] max-w-md grid-cols-2 overflow-hidden rounded-[1.6rem] border-2 border-[#d8efc8] bg-white/95 p-1.5 shadow-[0_8px_0_#d8efc8] backdrop-blur">
            <TabsTrigger value="swipe" className="!h-full min-w-0 rounded-[1.25rem] text-base font-black data-active:bg-[#58cc02] data-active:text-white data-active:shadow-none">
              <GalleryHorizontalEnd className="h-5 w-5" />
              Свайпи
            </TabsTrigger>
            <TabsTrigger value="results" className="!h-full min-w-0 rounded-[1.25rem] text-base font-black data-active:bg-[#58cc02] data-active:text-white data-active:shadow-none">
              <Heart className="h-5 w-5" />
              Метчі
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {copiedLink ? (
        <div className="fixed left-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-[#d8efc8] bg-white px-4 py-2 text-sm font-black text-[#3c8700] shadow-[0_8px_0_#d8efc8]">
          <Check className="h-4 w-4" />
          Посилання скопійовано
        </div>
      ) : null}

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto z-50 max-h-[86vh] w-full max-w-none translate-x-0 translate-y-0 gap-5 rounded-b-none rounded-t-[2rem] border-2 border-[#d8efc8] bg-white p-5 shadow-[0_-16px_60px_rgba(55,91,35,0.18)] sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <DialogHeader>
            <div className="mx-auto h-1.5 w-12 rounded-full bg-[#d8efc8]" />
            <div className="flex items-center justify-between gap-3 pt-1">
              <DialogTitle className="text-2xl font-black text-[#25321f]">Фільтри</DialogTitle>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFiltersOpen(false)}
                className="h-11 w-11 rounded-full p-0 text-[#52624a]"
                aria-label="Закрити фільтри"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto pb-1">
            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#6f7b68]">Що свайпаємо</p>
              <div className="grid grid-cols-3 gap-2">
                {foodTypeOptions.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    onClick={() => setFoodTypeFilter(option.value)}
                    className={`h-12 rounded-2xl border-2 px-2 text-sm font-black ${
                      foodTypeFilter === option.value
                        ? "border-[#46a302] bg-[#58cc02] text-white"
                        : "border-[#e1efd9] bg-[#f6fbf2] text-[#52624a]"
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </section>

          </div>

          <div className="grid grid-cols-[0.8fr_1.2fr] gap-3 border-t border-[#e1efd9] pt-4">
            <Button type="button" variant="outline" onClick={clearFilters} className="h-12 rounded-2xl border-2 font-black">
              Скинути
            </Button>
            <Button type="button" onClick={() => setFiltersOpen(false)} className="btn-duo-green h-12 rounded-2xl text-base">
              Готово
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedFood)} onOpenChange={(open) => !open && setSelectedFood(null)}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto max-h-[calc(100svh-1rem)] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-[2rem] border-2 border-[#d8efc8] bg-white p-0 shadow-[0_-16px_60px_rgba(55,91,35,0.18)] sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <div className="relative">
            <div className="absolute left-1/2 top-3 z-10 h-1.5 w-12 -translate-x-1/2 rounded-full bg-white/80 shadow-sm" />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelectedFood(null)}
              className="absolute right-3 top-3 z-10 h-10 w-10 rounded-full bg-white/90 p-0 text-[#25321f] shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
              aria-label="Закрити"
            >
              <X className="h-5 w-5" />
            </Button>
            {selectedFood?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedFood.image_url} alt={selectedFood.name} className="h-56 w-full object-cover" />
            ) : (
              <div className="flex h-40 items-center justify-center bg-[#eaf8df] text-6xl">🍽️</div>
            )}
          </div>
          <div className="space-y-4 p-5">
            <DialogHeader>
              <DialogTitle className="text-left text-2xl font-black leading-tight text-[#25321f]">{selectedFood?.name}</DialogTitle>
              {selectedFood?.ingredients ? (
                <DialogDescription className="text-left text-base font-bold leading-6 text-[#64725d]">
                  {selectedFood.ingredients}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            {selectedFood?.instructions ? (
              <p className="rounded-2xl bg-[#f6fbf2] p-3 text-sm font-semibold leading-6 text-[#52624a]">
                {selectedFood.instructions}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(matchFood)} onOpenChange={(open) => !open && setMatchFood(null)}>
        <DialogContent className="card-duo sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">Опа! Метч! 🍕</DialogTitle>
            <DialogDescription className="text-base font-semibold text-[#4b5563]">
              Ви обоє хочете {matchFood?.name}.
            </DialogDescription>
          </DialogHeader>
          <Button className="btn-duo-yellow h-12 w-full" onClick={() => setMatchFood(null)}>
            Продовжити свайпати
          </Button>
        </DialogContent>
      </Dialog>

      {error ? <p className="text-center text-sm font-semibold text-[#ea2b2b]">{error}</p> : null}
    </main>
  );
}
