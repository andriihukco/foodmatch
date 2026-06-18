"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Cherry, DoorOpen, GalleryHorizontalEnd, Heart, Languages, Link2, Loader2, Plus, RotateCcw, SlidersHorizontal, Sparkles, ThumbsDown, ThumbsUp, Users, X } from "lucide-react";

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
import { getLocalRooms, type LocalRoom, playerStorageKey, removeLocalRoom, saveLocalRoom } from "@/lib/local-rooms";
import { formatSupabaseError, hasSupabaseEnv, supabase } from "@/lib/supabase";
import type { Food, Room, SwipeAction } from "@/lib/types";

type FoodMap = Record<string, Food>;
type FilterValue = string;
type SwipeDirection = SwipeAction | null;
type LastSwipe = { food: Food; action: SwipeAction } | null;
type FilterOption = { value: string; label: string; count?: number };
type FoodFilterOptions = {
  foodTypes: FilterOption[];
  mealTypes: FilterOption[];
  tags: FilterOption[];
};
type TranslatedFoodText = {
  ingredients: string | null;
  instructions: string | null;
};
type RecentMatch = {
  id: string;
  food: Food;
};

const allFilterOption: FilterOption = { value: "all", label: "Усі" };
const foodTypeLabels: Record<string, string> = {
  recipe: "Страви",
  ingredient: "Інгредієнти",
  product: "Продукти",
  fastfood: "Фастфуд",
};
const mealTypeLabels: Record<string, string> = {
  breakfast: "Сніданок",
  lunch: "Обід",
  dinner: "Вечеря",
  snack: "Снек",
};
const initialFilterOptions: FoodFilterOptions = {
  foodTypes: [allFilterOption],
  mealTypes: [allFilterOption],
  tags: [allFilterOption],
};

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

function optionLabel(options: FilterOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "";
}

function prettyLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function sortedOptions(values: Map<string, number>, labels: Record<string, string> = {}) {
  return [
    allFilterOption,
    ...[...values.entries()]
      .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
      .map(([value, count]) => ({
        value,
        label: labels[value] ?? prettyLabel(value),
        count,
      })),
  ];
}

function getFoodText(food: Food, translatedText: TranslatedFoodText | undefined) {
  return {
    ingredients: translatedText?.ingredients ?? food.ingredients,
    instructions: translatedText?.instructions ?? food.instructions,
  };
}

function FoodPreviewButton({
  food,
  translatedText,
  onClick,
}: {
  food: Food;
  translatedText?: TranslatedFoodText;
  onClick: () => void;
}) {
  const foodText = getFoodText(food, translatedText);

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border-2 border-[#e5e5e5] bg-white p-2.5 text-left transition hover:border-[#e11d48]"
    >
      {food.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={food.image_url} alt={food.name} className="h-14 w-14 shrink-0 rounded-xl object-cover" />
      ) : (
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#fff1f3] text-2xl">🍽️</div>
      )}
      <span className="min-w-0">
        <span className="block truncate text-base font-black text-[#351316]">{food.name}</span>
        {foodText.ingredients ? (
          <span className="mt-0.5 block truncate text-xs font-bold text-[#7a3a43]">{foodText.ingredients}</span>
        ) : null}
      </span>
    </button>
  );
}

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const roomId = params.id;

  const [room, setRoom] = useState<Room | null>(null);
  const [savedRooms, setSavedRooms] = useState<LocalRoom[]>([]);
  const [name, setName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [loadingFoods, setLoadingFoods] = useState(false);
  const [foodTypeFilter, setFoodTypeFilter] = useState<FilterValue>("all");
  const [mealTypeFilter, setMealTypeFilter] = useState<FilterValue>("all");
  const [tagFilter, setTagFilter] = useState<FilterValue>("all");
  const [filterOptions, setFilterOptions] = useState<FoodFilterOptions>(initialFilterOptions);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [foods, setFoods] = useState<Food[]>([]);
  const [foodMap, setFoodMap] = useState<FoodMap>({});
  const [translatedFoods, setTranslatedFoods] = useState<Record<string, TranslatedFoodText>>({});
  const [translatingFoodId, setTranslatingFoodId] = useState<string | null>(null);
  const [myLikes, setMyLikes] = useState<string[]>([]);
  const [, setMyDislikes] = useState<string[]>([]);
  const [theirLikes, setTheirLikes] = useState<string[]>([]);
  const [, setTheirDislikes] = useState<string[]>([]);
  const [matchFood, setMatchFood] = useState<Food | null>(null);
  const [error, setError] = useState("");
  const [resultView, setResultView] = useState<"matches" | "mine" | "partner">("matches");
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection>(null);
  const [swipingFoodId, setSwipingFoodId] = useState<string | null>(null);
  const [lastSwipe, setLastSwipe] = useState<LastSwipe>(null);
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [recentMatch, setRecentMatch] = useState<RecentMatch | null>(null);
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
    await Promise.resolve();

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
      setSavedRooms(saveLocalRoom({
        id: data.id,
        playerName: storedName,
        label: `${storedName}'s room`,
      }));
    }
  }, [roomId]);

  const mergeFoodsIntoMap = useCallback((items: Food[]) => {
    setFoodMap((prev) => {
      const next = { ...prev };
      items.forEach((food) => {
        next[food.id] = food;
      });
      return next;
    });
  }, []);

  const loadFilterOptions = useCallback(async () => {
    if (!supabase) return;

    const { data, error: filtersError } = await supabase
      .from("foods")
      .select("food_type, meal_type, tags")
      .in("source", visibleFoodSources)
      .limit(2000);

    if (filtersError || !data) {
      setError(filtersError ? formatSupabaseError("Не вдалося завантажити фільтри", filtersError) : "Не вдалося завантажити фільтри.");
      return;
    }

    const foodTypes = new Map<string, number>();
    const mealTypes = new Map<string, number>();
    const tags = new Map<string, number>();

    data.forEach((food) => {
      if (food.food_type) foodTypes.set(food.food_type, (foodTypes.get(food.food_type) ?? 0) + 1);
      if (food.meal_type) mealTypes.set(food.meal_type, (mealTypes.get(food.meal_type) ?? 0) + 1);
      ((food.tags ?? []) as string[]).forEach((tag) => {
        if (tag) tags.set(tag, (tags.get(tag) ?? 0) + 1);
      });
    });

    setFilterOptions({
      foodTypes: sortedOptions(foodTypes, foodTypeLabels),
      mealTypes: sortedOptions(mealTypes, mealTypeLabels),
      tags: sortedOptions(tags),
    });
  }, []);

  const loadFoodById = useCallback(async (foodId: string) => {
    if (!supabase) return null;

    const cachedFood = foodMap[foodId];
    if (cachedFood) return cachedFood;

    const { data, error: foodError } = await supabase
      .from("foods")
      .select("*")
      .eq("id", foodId)
      .single();

    if (foodError || !data) {
      setError(foodError ? formatSupabaseError("Не вдалося завантажити метч", foodError) : "Не вдалося завантажити метч.");
      return null;
    }

    const food = data as Food;
    mergeFoodsIntoMap([food]);
    return food;
  }, [foodMap, mergeFoodsIntoMap]);

  const showMatch = useCallback((food: Food, source: "mine" | "partner") => {
    setMatchFood(food);
    if (source === "partner") {
      setRecentMatch({ id: `${food.id}:${Date.now()}`, food });
    }
  }, []);

  const loadSwipes = useCallback(async () => {
    if (!room || !name || !supabase) return false;
    const { data, error: swipesError } = await supabase
      .from("swipes")
      .select("food_id, user_name, action")
      .eq("room_id", room.id);

    if (swipesError) {
      setError(formatSupabaseError("Не вдалося завантажити свайпи", swipesError));
      return false;
    }
    if (!data) return false;

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

    const foodIds = [...new Set([...meLikes, ...meDislikes, ...partnerLikes, ...partnerDislikes])];
    if (foodIds.length > 0) {
      const { data: swipedFoods, error: foodDetailsError } = await supabase
        .from("foods")
        .select("*")
        .in("id", foodIds);

      if (foodDetailsError) {
        setError(formatSupabaseError("Не вдалося завантажити деталі свайпів", foodDetailsError));
        return false;
      }

      mergeFoodsIntoMap((swipedFoods ?? []) as Food[]);
    }

    return true;
  }, [mergeFoodsIntoMap, name, room]);

  const loadFoods = useCallback(async (mode: "replace" | "append" = "replace") => {
    if (!name || !room || !supabase) return;
    setLoadingFoods(true);
    const swipedIds = [...swipedIdsRef.current];

    let query = supabase.from("foods").select("*").in("source", visibleFoodSources).order("created_at", { ascending: false }).limit(36);
    if (foodTypeFilter !== "all") {
      query = query.eq("food_type", foodTypeFilter);
    }
    if (mealTypeFilter !== "all") {
      query = query.eq("meal_type", mealTypeFilter);
    }
    if (tagFilter !== "all") {
      query = query.contains("tags", [tagFilter]);
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
    mergeFoodsIntoMap(incomingFoods);
  }, [foodTypeFilter, mealTypeFilter, mergeFoodsIntoMap, name, room, tagFilter]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRoom();
  }, [refreshRoom]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    if (!room || !name) return;
    let cancelled = false;

    const loadRoomData = async () => {
      const swipesLoaded = await loadSwipes();
      if (!cancelled && swipesLoaded) {
        await loadFoods();
      }
    };

    void loadRoomData();

    return () => {
      cancelled = true;
    };
  }, [loadFoods, loadSwipes, room, name]);

  useEffect(() => {
    if (!room || !name || !supabase) return;
    const supabaseClient = supabase;

    const channel = supabaseClient
      .channel(`room-${room.id}-swipes`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "swipes", filter: `room_id=eq.${room.id}` },
        async (payload) => {
          const swipe = payload.new as { food_id: string; user_name: string; action: SwipeAction };
          if (swipe.user_name === name) return;
          if (swipe.action === "like" && myLikes.includes(swipe.food_id)) {
            const food = await loadFoodById(swipe.food_id);
            if (food) showMatch(food, "partner");
          }
          await loadSwipes();
        },
      )
      .subscribe();

    return () => {
      void supabaseClient.removeChannel(channel);
    };
  }, [loadFoodById, loadSwipes, myLikes, name, room, showMatch]);

  useEffect(() => {
    if (!recentMatch) return;

    const timeout = window.setTimeout(() => {
      setRecentMatch(null);
    }, 4200);

    return () => window.clearTimeout(timeout);
  }, [recentMatch]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href.split("?")[0]);
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 1800);
  };

  const clearFilters = () => {
    setFoodTypeFilter("all");
    setMealTypeFilter("all");
    setTagFilter("all");
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
    setSavedRooms(saveLocalRoom({
      id: room.id,
      playerName: trimmed,
      label: `${trimmed}'s room`,
    }));
    setName(trimmed);
    await refreshRoom();
  };

  const createNewRoom = async () => {
    if (!supabase || !hasSupabaseEnv) {
      setError("Supabase не налаштовано у .env.local.");
      return;
    }

    const trimmedName = name.trim() || joinName.trim();
    if (!trimmedName) {
      setError("Введи ім'я перед створенням нової кімнати.");
      return;
    }

    setIsCreatingRoom(true);
    setError("");

    const { data, error: insertError } = await supabase
      .from("rooms")
      .insert({ user_1_name: trimmedName })
      .select("id")
      .single();

    setIsCreatingRoom(false);

    if (insertError || !data) {
      setError(
        insertError
          ? formatSupabaseError("Не вдалося створити кімнату", insertError)
          : "Не вдалося створити кімнату: Supabase не повернув ID кімнати.",
      );
      return;
    }

    setSavedRooms(saveLocalRoom({
      id: data.id,
      playerName: trimmedName,
      label: `${trimmedName}'s room`,
    }));
    router.push(`/room/${data.id}`);
  };

  const leaveRoom = async () => {
    if (supabase && room && name) {
      setError("");

      const { error: deleteError } = await supabase
        .from("swipes")
        .delete()
        .eq("room_id", room.id)
        .eq("user_name", name);

      if (deleteError) {
        setError(formatSupabaseError("Не вдалося очистити свайпи перед виходом", deleteError));
        return;
      }

      if (name === room.user_2_name) {
        const { error: roomError } = await supabase
          .from("rooms")
          .update({ user_2_name: null })
          .eq("id", room.id)
          .eq("user_2_name", name);

        if (roomError) {
          setError(formatSupabaseError("Не вдалося звільнити місце в кімнаті", roomError));
          return;
        }
      }
    }

    const rooms = removeLocalRoom(roomId);
    setSavedRooms(rooms);
    setRoomsOpen(false);

    const nextRoom = rooms[0];
    if (nextRoom) {
      router.push(`/room/${nextRoom.id}`);
      return;
    }

    router.push("/");
  };

  const switchRoom = (nextRoomId: string) => {
    setRoomsOpen(false);
    if (nextRoomId === roomId) return;
    router.push(`/room/${nextRoomId}`);
  };

  const translateFood = async (food: Food) => {
    if (!food.ingredients && !food.instructions) return;
    if (translatedFoods[food.id]) return;

    setError("");
    setTranslatingFoodId(food.id);

    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ingredients: food.ingredients,
          instructions: food.instructions,
        }),
      });
    } catch (error) {
      setTranslatingFoodId(null);
      const message = error instanceof Error ? error.message : "мережна помилка";
      setError(`Не вдалося перекласти: ${message}`);
      return;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < 1000) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000 - elapsed));
    }

    setTranslatingFoodId(null);

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(`Не вдалося перекласти: ${payload?.error ?? response.statusText}`);
      return;
    }

    const payload = (await response.json()) as TranslatedFoodText;
    setTranslatedFoods((prev) => ({
      ...prev,
      [food.id]: payload,
    }));
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
      showMatch(food, "mine");
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
        <Loader2 className="h-8 w-8 animate-spin text-[#e11d48]" />
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
    if (mealTypeFilter !== "all" && food.meal_type !== mealTypeFilter) return false;
    if (tagFilter !== "all" && !food.tags.includes(tagFilter)) return false;
    return true;
  };
  const filteredMatches = matches.filter(matchesActiveFilters);
  const myWants = myLikes;
  const theirWants = theirLikes;
  const myTasteFoods = dedupeFoods(myWants.map((foodId) => foodMap[foodId]).filter(isFood)).filter(matchesActiveFilters);
  const partnerTasteFoods = dedupeFoods(theirWants.map((foodId) => foodMap[foodId]).filter(isFood)).filter(matchesActiveFilters);
  const hasActiveFilters = foodTypeFilter !== "all" || mealTypeFilter !== "all" || tagFilter !== "all";
  const filterSummary = [
    optionLabel(filterOptions.foodTypes, foodTypeFilter),
    mealTypeFilter !== "all" ? optionLabel(filterOptions.mealTypes, mealTypeFilter) : "",
    tagFilter !== "all" ? optionLabel(filterOptions.tags, tagFilter) : "",
  ].filter(Boolean);
  const topCardText = topCard ? getFoodText(topCard, translatedFoods[topCard.id]) : null;
  const selectedFoodText = selectedFood ? getFoodText(selectedFood, translatedFoods[selectedFood.id]) : null;

  return (
    <main className="mx-auto flex min-h-[100svh] w-full max-w-md flex-col gap-3 bg-[#fff5f6] px-3 py-3 pb-[calc(6.25rem+env(safe-area-inset-bottom))] text-[#351316] sm:px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e11d48] shadow-[0_4px_0_#9f1239]">
            <Cherry className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black leading-tight text-[#351316]">FoodMatch</h1>
            <p className="truncate text-xs font-bold text-[#9f5660]">{roomStatus}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSavedRooms(getLocalRooms());
              setRoomsOpen(true);
            }}
            className="h-11 w-11 rounded-full border-2 border-[#ffd1d8] bg-white p-0 text-[#be123c] shadow-[0_4px_0_#ffd1d8]"
            aria-label="Керувати кімнатами"
          >
            <Users className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={copyLink}
            className="h-11 w-11 rounded-full border-2 border-[#ffd1d8] bg-white p-0 text-[#be123c] shadow-[0_4px_0_#ffd1d8]"
            aria-label={copiedLink ? "Посилання скопійовано" : "Скопіювати посилання"}
          >
            {copiedLink ? <Check className="h-5 w-5" /> : <Link2 className="h-5 w-5" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setFiltersOpen(true)}
            className="relative h-11 w-11 rounded-full border-2 border-[#ffd1d8] bg-white p-0 text-[#be123c] shadow-[0_4px_0_#ffd1d8]"
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
          <CardContent className="space-y-3 text-sm font-bold text-[#7a3a43]">
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
            <p className="text-sm font-bold leading-6 text-[#7a3a43]">
              Шлях до твого серця лежить через шлунок. Введи ім&apos;я і свайпайте разом, щоб знайти ваш смачний метч.
            </p>
            <Input
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="Твоє ім'я"
              className="h-12 rounded-2xl border-2"
            />
            <Button onClick={joinRoom} disabled={isJoining} className="btn-duo-primary h-12 w-full">
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
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff1f3] text-[#be123c]">
                  <Link2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-black text-[#351316]">Інвайт готовий</p>
                  <p className="text-xs font-bold leading-5 text-[#7a3a43]">
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
              className="flex w-full items-center justify-between rounded-[1.35rem] border-2 border-[#ffd1d8] bg-white px-4 py-2.5 text-left shadow-[0_4px_0_#ffd1d8]"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-black text-[#351316]">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#e11d48]" />
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
                  className="relative flex h-[clamp(390px,calc(100svh-232px),620px)] cursor-pointer flex-col overflow-hidden rounded-[1.8rem] border-2 border-[#ffd1d8] bg-white shadow-[0_8px_0_#ffd1d8]"
                >
                  {(topCard.ingredients || topCard.instructions) ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={translatingFoodId === topCard.id || Boolean(translatedFoods[topCard.id])}
                      onClick={(event) => {
                        event.stopPropagation();
                        void translateFood(topCard);
                      }}
                      className="absolute right-3 top-3 z-10 h-11 w-11 rounded-full border-2 border-white/80 bg-white/95 p-0 text-[#be123c] shadow-[0_6px_18px_rgba(53,19,22,0.18)]"
                      aria-label="Перекласти картку"
                    >
                      {translatingFoodId === topCard.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Languages className="h-5 w-5" />}
                    </Button>
                  ) : null}
                  {topCard.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={topCard.image_url} alt={topCard.name} className="min-h-0 flex-1 object-cover" />
                  ) : (
                    <div className="flex min-h-0 flex-1 items-center justify-center bg-[#fff1f3] text-6xl">🍽️</div>
                  )}
                  <div className="shrink-0 space-y-3 p-4">
                    <div className="space-y-1.5">
                      <h2 className="line-clamp-2 text-2xl font-black leading-tight text-[#351316]">{topCard.name}</h2>
                      {topCardText?.ingredients ? (
                        <p className="line-clamp-1 text-sm font-bold leading-5 text-[#7a3a43]">{topCardText.ingredients}</p>
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
                        className="h-12 w-12 rounded-full border-2 border-[#ffd1d8] bg-white p-0 text-[#7a3a43] shadow-[0_5px_0_#ffd1d8] disabled:opacity-40"
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
                        className="btn-duo-primary h-16 w-16 rounded-full p-0 text-2xl shadow-[0_8px_20px_rgba(225,29,72,0.22)] disabled:bg-[#b7b7b7] disabled:border-[#929292]"
                        aria-label="Хочу"
                      >
                        <ThumbsUp className="h-7 w-7" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            ) : (
              <Card className="rounded-[2rem] border-2 border-dashed border-[#badea8] bg-white shadow-[0_8px_0_#ffd1d8]">
                <CardContent className="space-y-3 py-10 text-center">
                  <p className="text-2xl font-black text-[#351316]">Картки закінчились</p>
                  <p className="text-sm font-bold text-[#6b7280]">
                    Зміни фільтри або додай більше страв через seed script.
                  </p>
                  <Button onClick={clearFilters} className="btn-duo-yellow h-12 w-full">
                    Показати все
                  </Button>
                  {loadingFoods ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-[#e11d48]" /> : null}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="results" className="space-y-4">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex w-full items-center justify-between rounded-[1.6rem] border-2 border-[#ffd1d8] bg-white px-4 py-3 text-left shadow-[0_4px_0_#ffd1d8]"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-black text-[#351316]">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#e11d48]" />
                <span className="truncate">{filterSummary.join(" · ")}</span>
              </span>
              {hasActiveFilters ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff4b4b]" /> : null}
            </button>

            <Card className="card-duo">
              <CardContent className="space-y-3 pt-5">
                <div className="grid grid-cols-3 gap-2 rounded-[1.25rem] border-2 border-[#ffe4e8] bg-[#fff7f8] p-1">
                  <Button
                    variant="ghost"
                    onClick={() => setResultView("matches")}
                    className={`h-11 rounded-2xl px-2 text-sm font-black ${
                      resultView === "matches" ? "bg-[#e11d48] text-white" : "text-[#7a3a43]"
                    }`}
                  >
                    Matches
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setResultView("mine")}
                    className={`h-11 rounded-2xl px-2 text-sm font-black ${
                      resultView === "mine" ? "bg-[#e11d48] text-white" : "text-[#7a3a43]"
                    }`}
                  >
                    My Смаки
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setResultView("partner")}
                    className={`h-11 rounded-2xl px-2 text-sm font-black ${
                      resultView === "partner" ? "bg-[#e11d48] text-white" : "text-[#7a3a43]"
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
                        translatedText={translatedFoods[match.id]}
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
                        translatedText={translatedFoods[food.id]}
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
                        translatedText={translatedFoods[food.id]}
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

          <TabsList className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto grid !h-[72px] w-[calc(100%-1.5rem)] max-w-md grid-cols-2 overflow-hidden rounded-[1.6rem] border-2 border-[#ffd1d8] bg-white/95 p-1.5 shadow-[0_8px_0_#ffd1d8] backdrop-blur">
            <TabsTrigger value="swipe" className="!h-full min-w-0 rounded-[1.25rem] text-base font-black data-active:bg-[#e11d48] data-active:text-white data-active:shadow-none">
              <GalleryHorizontalEnd className="h-5 w-5" />
              Свайпи
            </TabsTrigger>
            <TabsTrigger value="results" className="!h-full min-w-0 rounded-[1.25rem] text-base font-black data-active:bg-[#e11d48] data-active:text-white data-active:shadow-none">
              <Heart className="h-5 w-5" />
              Метчі
            </TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {copiedLink ? (
        <div className="fixed left-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-[#ffd1d8] bg-white px-4 py-2 text-sm font-black text-[#be123c] shadow-[0_8px_0_#ffd1d8]">
          <Check className="h-4 w-4" />
          Посилання скопійовано
        </div>
      ) : null}

      <AnimatePresence>
        {recentMatch ? (
          <motion.div
            key={recentMatch.id}
            initial={{ opacity: 0, y: -18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -18, scale: 0.98 }}
            className="fixed left-3 right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[65] mx-auto max-w-md overflow-hidden rounded-[1.35rem] border-2 border-[#fecdd3] bg-white shadow-[0_10px_30px_rgba(154,25,42,0.18)]"
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e11d48] text-white">
                <Heart className="h-5 w-5 fill-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-[#351316]">Match on {recentMatch.food.name}</p>
                <p className="truncate text-xs font-bold text-[#9f5660]">{otherName} теж хоче це</p>
              </div>
            </div>
            <motion.div
              className="h-1.5 origin-left bg-[#e11d48]"
              initial={{ scaleX: 1 }}
              animate={{ scaleX: 0 }}
              transition={{ duration: 4.2, ease: "linear" }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Dialog open={roomsOpen} onOpenChange={setRoomsOpen}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto z-50 max-h-[86vh] w-full max-w-none translate-x-0 translate-y-0 gap-5 rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-5 shadow-[0_-16px_60px_rgba(154,25,42,0.18)] sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <DialogHeader>
            <div className="mx-auto h-1.5 w-12 rounded-full bg-[#ffd1d8]" />
            <div className="flex items-center justify-between gap-3 pt-1">
              <DialogTitle className="text-2xl font-black text-[#351316]">Кімнати</DialogTitle>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setRoomsOpen(false)}
                className="h-11 w-11 rounded-full p-0 text-[#7a3a43]"
                aria-label="Закрити кімнати"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-3 overflow-y-auto">
            {savedRooms.length > 0 ? (
              savedRooms.map((savedRoom) => (
                <button
                  key={savedRoom.id}
                  type="button"
                  onClick={() => switchRoom(savedRoom.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-2xl border-2 p-3 text-left transition ${
                    savedRoom.id === roomId
                      ? "border-[#e11d48] bg-[#fff1f3]"
                      : "border-[#ffd1d8] bg-white hover:bg-[#fff7f8]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-[#351316]">{savedRoom.label}</span>
                    <span className="block truncate text-xs font-bold text-[#9f5660]">Гравець: {savedRoom.playerName}</span>
                  </span>
                  {savedRoom.id === roomId ? (
                    <Check className="h-5 w-5 shrink-0 text-[#e11d48]" />
                  ) : (
                    <ArrowRight className="h-5 w-5 shrink-0 text-[#be123c]" />
                  )}
                </button>
              ))
            ) : (
              <p className="rounded-2xl bg-[#fff7f8] p-3 text-sm font-bold leading-6 text-[#7a3a43]">
                На цьому пристрої ще немає збережених кімнат.
              </p>
            )}
          </div>

          <div className="grid gap-3 border-t border-[#ffe4e8] pt-4">
            <Button
              type="button"
              onClick={createNewRoom}
              disabled={isCreatingRoom}
              className="btn-duo-primary h-12 rounded-2xl text-base"
            >
              {isCreatingRoom ? <Loader2 className="animate-spin" /> : <Plus className="h-5 w-5" />}
              Нова кімната
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void leaveRoom()}
              className="h-12 rounded-2xl border-2 border-[#ffd1d8] text-base font-black text-[#be123c]"
            >
              <DoorOpen className="h-5 w-5" />
              Вийти з цієї кімнати
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto z-50 max-h-[86vh] w-full max-w-none translate-x-0 translate-y-0 gap-5 rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-5 shadow-[0_-16px_60px_rgba(154,25,42,0.18)] sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <DialogHeader>
            <div className="mx-auto h-1.5 w-12 rounded-full bg-[#ffd1d8]" />
            <div className="flex items-center justify-between gap-3 pt-1">
              <DialogTitle className="text-2xl font-black text-[#351316]">Фільтри</DialogTitle>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setFiltersOpen(false)}
                className="h-11 w-11 rounded-full p-0 text-[#7a3a43]"
                aria-label="Закрити фільтри"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </DialogHeader>

          <div className="space-y-5 overflow-y-auto pb-1">
            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#9f5660]">Що свайпаємо</p>
              <div className="grid grid-cols-3 gap-2">
                {filterOptions.foodTypes.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    onClick={() => setFoodTypeFilter(option.value)}
                    className={`h-12 rounded-2xl border-2 px-2 text-sm font-black ${
                      foodTypeFilter === option.value
                        ? "border-[#9f1239] bg-[#e11d48] text-white"
                        : "border-[#ffe4e8] bg-[#fff7f8] text-[#7a3a43]"
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#9f5660]">Коли їмо</p>
              <div className="grid grid-cols-2 gap-2">
                {filterOptions.mealTypes.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    onClick={() => setMealTypeFilter(option.value)}
                    className={`h-11 rounded-2xl border-2 px-2 text-sm font-black ${
                      mealTypeFilter === option.value
                        ? "border-[#9f1239] bg-[#e11d48] text-white"
                        : "border-[#ffe4e8] bg-[#fff7f8] text-[#7a3a43]"
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#9f5660]">Категорії, кухні, інгредієнти</p>
              <div className="max-h-64 overflow-y-auto rounded-2xl border-2 border-[#ffe4e8] bg-[#fff7f8] p-2">
                <div className="flex flex-wrap gap-2">
                  {filterOptions.tags.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant="ghost"
                      onClick={() => setTagFilter(option.value)}
                      className={`h-10 rounded-full border-2 px-3 text-xs font-black ${
                        tagFilter === option.value
                          ? "border-[#9f1239] bg-[#e11d48] text-white"
                          : "border-[#ffd1d8] bg-white text-[#7a3a43]"
                      }`}
                    >
                      {option.label}
                      {option.count ? <span className="ml-1 opacity-70">{option.count}</span> : null}
                    </Button>
                  ))}
                </div>
              </div>
            </section>

          </div>

          <div className="grid grid-cols-[0.8fr_1.2fr] gap-3 border-t border-[#ffe4e8] pt-4">
            <Button type="button" variant="outline" onClick={clearFilters} className="h-12 rounded-2xl border-2 font-black">
              Скинути
            </Button>
            <Button type="button" onClick={() => setFiltersOpen(false)} className="btn-duo-primary h-12 rounded-2xl text-base">
              Готово
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedFood)} onOpenChange={(open) => !open && setSelectedFood(null)}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto max-h-[calc(100svh-1rem)] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-0 shadow-[0_-16px_60px_rgba(154,25,42,0.18)] sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <div className="relative">
            <div className="absolute left-1/2 top-3 z-10 h-1.5 w-12 -translate-x-1/2 rounded-full bg-white/80 shadow-sm" />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelectedFood(null)}
              className="absolute right-3 top-3 z-10 h-10 w-10 rounded-full bg-white/90 p-0 text-[#351316] shadow-[0_4px_16px_rgba(0,0,0,0.18)]"
              aria-label="Закрити"
            >
              <X className="h-5 w-5" />
            </Button>
            {selectedFood?.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selectedFood.image_url} alt={selectedFood.name} className="h-56 w-full object-cover" />
            ) : (
              <div className="flex h-40 items-center justify-center bg-[#fff1f3] text-6xl">🍽️</div>
            )}
          </div>
          <div className="space-y-4 p-5">
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="text-left text-2xl font-black leading-tight text-[#351316]">{selectedFood?.name}</DialogTitle>
                {selectedFood && (selectedFood.ingredients || selectedFood.instructions) ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={translatingFoodId === selectedFood.id || Boolean(translatedFoods[selectedFood.id])}
                    onClick={() => void translateFood(selectedFood)}
                    className="h-10 w-10 shrink-0 rounded-full border-2 border-[#ffd1d8] p-0 text-[#be123c]"
                    aria-label="Перекласти рецепт"
                  >
                    {translatingFoodId === selectedFood.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Languages className="h-5 w-5" />}
                  </Button>
                ) : null}
              </div>
              {selectedFoodText?.ingredients ? (
                <DialogDescription className="text-left text-base font-bold leading-6 text-[#7a3a43]">
                  {selectedFoodText.ingredients}
                </DialogDescription>
              ) : null}
            </DialogHeader>
            {selectedFoodText?.instructions ? (
              <p className="rounded-2xl bg-[#fff7f8] p-3 text-sm font-semibold leading-6 text-[#7a3a43]">
                {selectedFoodText.instructions}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(matchFood)} onOpenChange={(open) => !open && setMatchFood(null)}>
        <DialogContent showCloseButton={false} className="card-duo overflow-hidden p-0 sm:max-w-md">
          <div className="relative min-h-72 overflow-hidden bg-[#fff1f3] px-5 pb-5 pt-8 text-center">
            {[...Array(18)].map((_, index) => (
              <motion.span
                key={index}
                className="absolute text-[#e11d48]"
                initial={{
                  opacity: 0,
                  x: 170,
                  y: 132,
                  rotate: 0,
                  scale: 0.4,
                }}
                animate={{
                  opacity: [0, 1, 1, 0],
                  x: 170 + Math.cos(index * 0.9) * (90 + (index % 5) * 18),
                  y: 132 + Math.sin(index * 1.2) * (78 + (index % 4) * 14),
                  rotate: index % 2 === 0 ? 26 : -24,
                  scale: [0.4, 1.1, 0.95],
                }}
                transition={{ duration: 1.8, delay: index * 0.035, ease: "easeOut" }}
              >
                <Heart className="h-5 w-5 fill-current" />
              </motion.span>
            ))}
            <div className="relative mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-[#e11d48] text-white shadow-[0_10px_0_#9f1239]">
              <Heart className="h-12 w-12 fill-white" />
              <Sparkles className="absolute -right-2 -top-2 h-8 w-8 text-[#fbbf24]" />
            </div>
            <DialogHeader>
              <DialogTitle className="text-center text-4xl font-black leading-none text-[#351316]">It&apos;s a match</DialogTitle>
              <DialogDescription className="mx-auto mt-3 max-w-xs text-center text-base font-bold leading-6 text-[#7a3a43]">
                Ви обоє хочете {matchFood?.name}. Схоже, вечеря сама себе обрала.
              </DialogDescription>
          </DialogHeader>
          </div>
          <div className="grid gap-3 bg-white p-5">
            <Button className="btn-duo-primary h-12 w-full" onClick={() => setMatchFood(null)}>
              Продовжити свайпати
            </Button>
            <Button variant="outline" className="h-12 rounded-2xl border-2 border-[#ffd1d8] font-black text-[#be123c]" onClick={() => setMatchFood(null)}>
              Закрити
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {error ? <p className="text-center text-sm font-semibold text-[#ea2b2b]">{error}</p> : null}
    </main>
  );
}
