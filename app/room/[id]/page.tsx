"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, Cherry, DoorOpen, GalleryHorizontalEnd, Heart, Languages, Link2, Loader2, Plus, RotateCcw, SlidersHorizontal, ThumbsDown, ThumbsUp, Users, X } from "lucide-react";

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
type RoomMap = Record<string, Room>;
type FilterValue = string;
type FilterValues = string[];
type SwipeDirection = SwipeAction | null;
type LastSwipe = { food: Food; action: SwipeAction } | null;
type MainTab = "swipe" | "results";
type ResultView = "matches" | "mine" | "partner";
type FilterOption = { value: string; label: string; count?: number; foodTypes?: string[]; tagsAny?: string[]; mealTypes?: string[] };
type FilterableFood = Pick<Food, "food_type" | "meal_type" | "tags">;
type FoodFilterOptions = {
  foodTypes: FilterOption[];
  dishKinds: FilterOption[];
};
type TranslatedFoodText = {
  name: string | null;
  ingredients: string | null;
  instructions: string | null;
};
type RecentMatch = {
  id: string;
  food: Food;
};

const allFilterOption: FilterOption = { value: "all", label: "Усі" };
const foodTypeFilterOptions: FilterOption[] = [
  allFilterOption,
  { value: "meals", label: "Страви", foodTypes: ["recipe", "fastfood", "product"] },
  { value: "ingredients", label: "Інгредієнти", foodTypes: ["ingredient"] },
];
const dishKindFilterOptions: FilterOption[] = [
  allFilterOption,
  {
    value: "main",
    label: "Основні",
    tagsAny: ["beef", "chicken", "goat", "lamb", "pork", "seafood", "pasta", "vegan", "vegetarian"],
    foodTypes: ["recipe", "fastfood", "product"],
  },
  { value: "dessert", label: "Десерти", tagsAny: ["dessert"] },
  { value: "snack", label: "Снеки", mealTypes: ["snack"] },
  { value: "soup", label: "Супи", tagsAny: ["soup", "soups"] },
  { value: "starter", label: "Закуски", tagsAny: ["starter"] },
  { value: "side", label: "Гарніри", tagsAny: ["side"] },
  { value: "pasta", label: "Паста", tagsAny: ["pasta"] },
  { value: "seafood", label: "Морепродукти", tagsAny: ["seafood"] },
  { value: "vegetarian", label: "Вегетаріанське", tagsAny: ["vegetarian", "vegan"] },
];
const initialFilterOptions: FoodFilterOptions = {
  foodTypes: foodTypeFilterOptions,
  dishKinds: dishKindFilterOptions,
};

const visibleFoodSources = ["themealdb-ingredient-list", "themealdb-meal-list", "josephrmartinez/recipe-dataset"];

function roomUiStorageKey(roomId: string) {
  return `foodmatch:room:${roomId}:ui`;
}

function isMainTab(value: string): value is MainTab {
  return value === "swipe" || value === "results";
}

function isResultView(value: string): value is ResultView {
  return value === "matches" || value === "mine" || value === "partner";
}

function dedupeFoods(items: Food[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function shuffleFoods(items: Food[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function isFood(food: Food | undefined): food is Food {
  return Boolean(food);
}

function optionLabel(options: FilterOption[], value: string) {
  return options.find((option) => option.value === value)?.label ?? "";
}

function getFoodText(food: Food, translatedText: TranslatedFoodText | undefined) {
  return {
    name: translatedText?.name ?? food.name,
    ingredients: translatedText?.ingredients ?? food.ingredients,
    instructions: translatedText?.instructions ?? food.instructions,
  };
}

function roomCode(roomId: string) {
  return roomId.slice(0, 6).toUpperCase();
}

function roomMemberNames(room: Room | undefined) {
  if (!room) return [];
  return [room.user_1_name, room.user_2_name].filter((member): member is string => Boolean(member));
}

function roomMemberLine(room: Room | undefined, fallbackName?: string) {
  const members = roomMemberNames(room);
  if (members.length > 0) {
    return members.length === 1 ? `${members[0]} + очікуємо партнера` : members.join(" + ");
  }
  return fallbackName ? `${fallbackName} + очікуємо партнера` : "Очікуємо гравців";
}

function matchesOption(food: FilterableFood, option: FilterOption | undefined) {
  if (!option || option.value === "all") return true;
  if (option.foodTypes && (!food.food_type || !option.foodTypes.includes(food.food_type))) return false;
  if (option.mealTypes?.includes(food.meal_type ?? "")) return true;
  if (option.tagsAny?.some((tag) => (food.tags ?? []).includes(tag))) return true;
  return !option.mealTypes && !option.tagsAny;
}

function matchesAnyOption(food: FilterableFood, options: FilterOption[]) {
  if (options.length === 0) return true;
  return options.some((option) => matchesOption(food, option));
}

function FoodImage({
  src,
  alt,
  className,
  placeholderClassName,
  iconClassName = "text-5xl",
}: {
  src: string | null | undefined;
  alt: string;
  className: string;
  placeholderClassName: string;
  iconClassName?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className={placeholderClassName}>
        <span className={iconClassName}>🍽️</span>
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} />;
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
      <FoodImage
        src={food.image_url}
        alt={food.name}
        className="h-14 w-14 shrink-0 rounded-xl object-cover"
        placeholderClassName="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#fff1f3]"
        iconClassName="text-2xl"
      />
      <span className="min-w-0">
        <span className="block truncate text-base font-black text-[#351316]">{foodText.name}</span>
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
  const searchParams = useSearchParams();
  const roomId = params.id;

  const [room, setRoom] = useState<Room | null>(null);
  const [savedRooms, setSavedRooms] = useState<LocalRoom[]>([]);
  const [savedRoomDetails, setSavedRoomDetails] = useState<RoomMap>({});
  const [name, setName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [loadingRoom, setLoadingRoom] = useState(true);
  const [loadingFoods, setLoadingFoods] = useState(false);
  const [foodTypeFilter, setFoodTypeFilter] = useState<FilterValue>("all");
  const [dishKindFilters, setDishKindFilters] = useState<FilterValues>([]);
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
  const [mainTab, setMainTab] = useState<MainTab>("swipe");
  const [resultView, setResultView] = useState<ResultView>("matches");
  const [uiHydrated, setUiHydrated] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<SwipeDirection>(null);
  const [swipingFoodId, setSwipingFoodId] = useState<string | null>(null);
  const [lastSwipe, setLastSwipe] = useState<LastSwipe>(null);
  const [selectedFood, setSelectedFood] = useState<Food | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [recentMatch, setRecentMatch] = useState<RecentMatch | null>(null);
  const swipedIdsRef = useRef(new Set<string>());
  const myLikesRef = useRef<string[]>([]);
  const cardDragRef = useRef(false);

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
    return roomMemberLine(room, name);
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
        label: `Room ${roomCode(data.id)}`,
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

    const allFilterFoods: FilterableFood[] = [];
    const pageSize = 1000;

    for (let page = 0; ; page += 1) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error: filtersError } = await supabase
        .from("foods")
        .select("food_type, meal_type, tags")
        .in("source", visibleFoodSources)
        .range(from, to);

      if (filtersError || !data) {
        setError(filtersError ? formatSupabaseError("Не вдалося завантажити фільтри", filtersError) : "Не вдалося завантажити фільтри.");
        return;
      }

      allFilterFoods.push(...(data as FilterableFood[]));
      if (data.length < pageSize) break;
    }

    const foodTypeCounts = new Map<string, number>();
    const dishKindCounts = new Map<string, number>();

    allFilterFoods.forEach((food) => {
      const typedFood = food as FilterableFood;
      foodTypeFilterOptions.forEach((option) => {
        if (matchesOption(typedFood, option)) {
          foodTypeCounts.set(option.value, (foodTypeCounts.get(option.value) ?? 0) + 1);
        }
      });
      dishKindFilterOptions.forEach((option) => {
        if (matchesOption(typedFood, option)) {
          dishKindCounts.set(option.value, (dishKindCounts.get(option.value) ?? 0) + 1);
        }
      });
    });

    setFilterOptions({
      foodTypes: foodTypeFilterOptions.map((option) => ({ ...option, count: option.value === "all" ? undefined : foodTypeCounts.get(option.value) })),
      dishKinds: dishKindFilterOptions.map((option) => ({ ...option, count: option.value === "all" ? undefined : dishKindCounts.get(option.value) })),
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

  const loadSavedRoomDetails = useCallback(async (rooms: LocalRoom[]) => {
    if (!supabase || rooms.length === 0) {
      setSavedRoomDetails({});
      return;
    }

    const { data, error: roomsError } = await supabase
      .from("rooms")
      .select("*")
      .in("id", rooms.map((savedRoom) => savedRoom.id));

    if (roomsError) {
      setError(formatSupabaseError("Не вдалося завантажити список кімнат", roomsError));
      return;
    }

    const nextDetails: RoomMap = {};
    ((data ?? []) as Room[]).forEach((savedRoom) => {
      nextDetails[savedRoom.id] = savedRoom;
    });
    setSavedRoomDetails(nextDetails);
  }, []);

  const showMatch = useCallback((food: Food, source: "mine" | "partner") => {
    setMatchFood(food);
    if (source === "partner") {
      setRecentMatch({ id: `${food.id}:${Date.now()}`, food });
    }
  }, []);

  const checkPartnerLike = useCallback(async (food: Food) => {
    if (!room || !name || !supabase) return false;

    const { data, error: matchError } = await supabase
      .from("swipes")
      .select("id")
      .eq("room_id", room.id)
      .eq("food_id", food.id)
      .eq("action", "like")
      .neq("user_name", name)
      .limit(1);

    if (matchError) {
      setError(formatSupabaseError("Не вдалося перевірити метч", matchError));
      return false;
    }

    return (data ?? []).length > 0;
  }, [name, room]);

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

    const selectedFoodType = foodTypeFilterOptions.find((option) => option.value === foodTypeFilter);
    const selectedDishKinds = dishKindFilterOptions.filter((option) => dishKindFilters.includes(option.value));
    const pageSize = selectedDishKinds.length > 1 ? 120 : 36;

    let countQuery = supabase.from("foods").select("id", { count: "exact", head: true }).in("source", visibleFoodSources);
    let query = supabase.from("foods").select("*").in("source", visibleFoodSources);

    if (selectedFoodType?.foodTypes) {
      countQuery = countQuery.in("food_type", selectedFoodType.foodTypes);
      query = query.in("food_type", selectedFoodType.foodTypes);
    }
    if (selectedDishKinds.length === 1) {
      const [selectedDishKind] = selectedDishKinds;
      if (selectedDishKind.foodTypes) {
        countQuery = countQuery.in("food_type", selectedDishKind.foodTypes);
        query = query.in("food_type", selectedDishKind.foodTypes);
      }
      if (selectedDishKind.mealTypes && !selectedDishKind.tagsAny) {
        countQuery = countQuery.in("meal_type", selectedDishKind.mealTypes);
        query = query.in("meal_type", selectedDishKind.mealTypes);
      }
      if (selectedDishKind.tagsAny) {
        countQuery = countQuery.overlaps("tags", selectedDishKind.tagsAny);
        query = query.overlaps("tags", selectedDishKind.tagsAny);
      }
    } else if (selectedDishKinds.length > 1) {
      const mealTypes = [...new Set(selectedDishKinds.flatMap((option) => option.mealTypes ?? []))];
      const tagsAny = [...new Set(selectedDishKinds.flatMap((option) => option.tagsAny ?? []))];
      const orFilters = [
        mealTypes.length > 0 ? `meal_type.in.(${mealTypes.join(",")})` : "",
        tagsAny.length > 0 ? `tags.ov.{${tagsAny.join(",")}}` : "",
      ].filter(Boolean);

      if (orFilters.length > 0) {
        countQuery = countQuery.or(orFilters.join(","));
        query = query.or(orFilters.join(","));
      }
    }

    if (swipedIds.length > 0) {
      countQuery = countQuery.not("id", "in", `(${swipedIds.join(",")})`);
      query = query.not("id", "in", `(${swipedIds.join(",")})`);
    }

    const { count, error: countError } = await countQuery;
    if (countError) {
      setLoadingFoods(false);
      setError(formatSupabaseError("Не вдалося порахувати картки їжі", countError));
      return;
    }

    const availableCount = count ?? 0;
    const maxOffset = Math.max(availableCount - pageSize, 0);
    const randomOffset = maxOffset > 0 ? Math.floor(Math.random() * (maxOffset + 1)) : 0;

    const { data, error: foodsError } = await query.range(randomOffset, randomOffset + pageSize - 1);
    setLoadingFoods(false);

    if (foodsError || !data) {
      setError(foodsError ? formatSupabaseError("Не вдалося завантажити картки їжі", foodsError) : "Не вдалося завантажити картки їжі.");
      return;
    }

    const incomingFoods = shuffleFoods(dedupeFoods((data as Food[]).filter((food) => matchesAnyOption(food, selectedDishKinds)))).slice(0, 36);
    setFoods((prev) => {
      if (mode === "replace") return incomingFoods;
      return dedupeFoods([...prev, ...incomingFoods]);
    });
    mergeFoodsIntoMap(incomingFoods);
  }, [dishKindFilters, foodTypeFilter, mergeFoodsIntoMap, name, room]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshRoom();
  }, [refreshRoom]);

  useEffect(() => {
    if (!room || !name || !isKnownPlayer || searchParams.get("created") !== "1") return;
    const showOnboarding = window.setTimeout(() => {
      setOnboardingOpen(true);
      router.replace(`/room/${room.id}`);
    }, 0);

    return () => window.clearTimeout(showOnboarding);
  }, [isKnownPlayer, name, room, router, searchParams]);

  useEffect(() => {
    const restoreState = window.setTimeout(() => {
      const rawState = window.localStorage.getItem(roomUiStorageKey(roomId));
      if (rawState) {
        try {
          const savedState = JSON.parse(rawState) as {
            foodTypeFilter?: unknown;
            dishKindFilter?: unknown;
            dishKindFilters?: unknown;
            mainTab?: unknown;
            resultView?: unknown;
          };
          if (typeof savedState.foodTypeFilter === "string") {
            setFoodTypeFilter(savedState.foodTypeFilter);
          }
          if (Array.isArray(savedState.dishKindFilters)) {
            setDishKindFilters(savedState.dishKindFilters.filter((value): value is string => typeof value === "string" && value !== "all"));
          } else if (typeof savedState.dishKindFilter === "string" && savedState.dishKindFilter !== "all") {
            setDishKindFilters([savedState.dishKindFilter]);
          }
          if (typeof savedState.mainTab === "string" && isMainTab(savedState.mainTab)) {
            setMainTab(savedState.mainTab);
          }
          if (typeof savedState.resultView === "string" && isResultView(savedState.resultView)) {
            setResultView(savedState.resultView);
          }
        } catch (parseError) {
          console.warn("Unable to read saved FoodMatch room UI state.", parseError);
          window.localStorage.removeItem(roomUiStorageKey(roomId));
        }
      }
      setUiHydrated(true);
    }, 0);

    return () => window.clearTimeout(restoreState);
  }, [roomId]);

  useEffect(() => {
    if (!uiHydrated) return;
    window.localStorage.setItem(roomUiStorageKey(roomId), JSON.stringify({
      foodTypeFilter,
      dishKindFilters,
      mainTab,
      resultView,
    }));
  }, [dishKindFilters, foodTypeFilter, mainTab, resultView, roomId, uiHydrated]);

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
          if (swipe.action === "like" && myLikesRef.current.includes(swipe.food_id)) {
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
  }, [loadFoodById, loadSwipes, name, room, showMatch]);

  useEffect(() => {
    myLikesRef.current = myLikes;
  }, [myLikes]);

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
    setDishKindFilters([]);
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
      label: `Room ${roomCode(room.id)}`,
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
      label: `Room ${roomCode(data.id)}`,
    }));
    router.push(`/room/${data.id}?created=1`);
  };

  const leaveRoom = async () => {
    setLeaveConfirmOpen(false);
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
    if (!food.name && !food.ingredients && !food.instructions) return;
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
          name: food.name,
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

    if (action === "like" && (theirLikes.includes(food.id) || await checkPartnerLike(food))) {
      showMatch(food, "mine");
    }

    await loadSwipes();
    setLastSwipe({ food, action });
    if (foods.length <= 10) {
      void loadFoods("append");
    }
    setSwipingFoodId(null);
  };

  const handleCardDragEnd = (food: Food, offsetX: number, velocityX: number) => {
    window.setTimeout(() => {
      cardDragRef.current = false;
    }, 0);

    if (swipingFoodId !== null) return;
    if (offsetX > 92 || velocityX > 520) {
      void swipe(food, "like");
      return;
    }
    if (offsetX < -92 || velocityX < -520) {
      void swipe(food, "dislike");
    }
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
  const activeFoodTypeOption = filterOptions.foodTypes.find((option) => option.value === foodTypeFilter);
  const activeDishKindOptions = filterOptions.dishKinds.filter((option) => dishKindFilters.includes(option.value));
  const matchesActiveFilters = (food: Food) => {
    if (!matchesOption(food, activeFoodTypeOption)) return false;
    if (!matchesAnyOption(food, activeDishKindOptions)) return false;
    return true;
  };
  const filteredMatches = matches.filter(matchesActiveFilters);
  const myWants = myLikes;
  const theirWants = theirLikes;
  const myTasteFoods = dedupeFoods(myWants.map((foodId) => foodMap[foodId]).filter(isFood)).filter(matchesActiveFilters);
  const partnerTasteFoods = dedupeFoods(theirWants.map((foodId) => foodMap[foodId]).filter(isFood)).filter(matchesActiveFilters);
  const hasActiveFilters = foodTypeFilter !== "all" || dishKindFilters.length > 0;
  const filterSummary = [
    foodTypeFilter !== "all" ? optionLabel(filterOptions.foodTypes, foodTypeFilter) : "",
    ...dishKindFilters.map((value) => optionLabel(filterOptions.dishKinds, value)),
  ].filter(Boolean);
  const filterSummaryText = filterSummary.length > 0 ? filterSummary.join(" · ") : "Усі";
  const topCardText = topCard ? getFoodText(topCard, translatedFoods[topCard.id]) : null;
  const selectedFoodText = selectedFood ? getFoodText(selectedFood, translatedFoods[selectedFood.id]) : null;
  const matchFoodText = matchFood ? getFoodText(matchFood, translatedFoods[matchFood.id]) : null;

  return (
    <main className="mx-auto flex h-[100svh] w-full max-w-md flex-col gap-2 overflow-hidden bg-[#fff5f6] px-3 py-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] text-[#351316] sm:px-4">
      {!needsJoin ? <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e11d48] shadow-[0_3px_0_#f8cbd2]">
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
              const rooms = getLocalRooms();
              setSavedRooms(rooms);
              void loadSavedRoomDetails(rooms);
              setRoomsOpen(true);
            }}
            className="h-11 w-11 rounded-full border-2 border-[#ffd1d8] bg-white p-0 text-[#be123c] shadow-[0_3px_0_#ffe9ed]"
            aria-label="Керувати кімнатами"
          >
            <Users className="h-5 w-5" />
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setFiltersOpen(true)}
            className="relative h-11 w-11 rounded-full border-2 border-[#ffd1d8] bg-white p-0 text-[#be123c] shadow-[0_3px_0_#ffe9ed]"
            aria-label="Відкрити фільтри"
          >
            <SlidersHorizontal className="h-5 w-5" />
            {hasActiveFilters ? <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-[#ff4b4b]" /> : null}
          </Button>
        </div>
      </div> : null}
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
        <section className="relative -mx-3 -my-3 flex min-h-[100svh] w-[calc(100%+1.5rem)] items-center justify-center overflow-hidden bg-[#fff5f6] px-5 py-8">
          <div className="absolute left-1/2 top-0 h-64 w-64 -translate-x-1/2 rounded-full bg-[#ffd1d8] blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-56 w-56 rounded-full bg-[#ffe8a3] blur-3xl" />
          <div className="absolute -right-24 bottom-16 h-64 w-64 rounded-full bg-[#c7e8a7] blur-3xl" />
          <div className="relative w-full max-w-sm text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[1.7rem] bg-[#e11d48] shadow-[0_6px_0_#f8cbd2]">
              <Cherry className="h-10 w-10 text-white" />
            </div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[#9f5660]">Room {roomCode(room.id)}</p>
            <h1 className="mt-2 text-4xl font-black leading-none text-[#351316]">FoodMatch</h1>
            <p className="mx-auto mt-3 max-w-xs text-base font-extrabold leading-6 text-[#7a3a43]">
              {room.user_1_name} кличе тебе знайти страву, яку ви обоє захочете прямо зараз.
            </p>
            <div className="mt-8 rounded-[2rem] border-2 border-[#ffd1d8] bg-white/90 p-4 text-left shadow-[0_4px_0_#ffe9ed] backdrop-blur">
              <label className="text-xs font-black uppercase tracking-[0.14em] text-[#9f5660]" htmlFor="join-name">
                Як тебе записати?
              </label>
              <Input
                id="join-name"
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                placeholder="Твоє ім'я"
                className="mt-3 h-14 rounded-2xl border-2 border-[#ffd1d8] bg-white text-base font-bold"
              />
              <Button onClick={joinRoom} disabled={isJoining} className="btn-duo-primary mt-4 h-14 w-full rounded-2xl text-base">
                {isJoining ? <Loader2 className="animate-spin" /> : <Heart className="h-5 w-5 fill-white" />}
                Прийняти інвайт
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <Tabs
          value={mainTab}
          onValueChange={(value) => {
            if (isMainTab(value)) setMainTab(value);
          }}
          className="min-h-0 w-full flex-1"
        >
          <TabsContent value="swipe" className="min-h-0 space-y-3">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex w-full items-center justify-between rounded-[1.35rem] border-2 border-[#ffd1d8] bg-white px-4 py-2.5 text-left shadow-[0_3px_0_#ffe9ed]"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-black text-[#351316]">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#e11d48]" />
                <span className="truncate">{filterSummaryText}</span>
              </span>
              {hasActiveFilters ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff4b4b]" /> : null}
            </button>

            {topCard ? (
              <div className="space-y-2">
                <AnimatePresence mode="wait" onExitComplete={() => setSwipeDirection(null)}>
                  <motion.div
                    key={topCard.id}
                    drag="x"
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.28}
                    onDragStart={() => {
                      cardDragRef.current = true;
                    }}
                    onDragEnd={(_, info) => handleCardDragEnd(topCard, info.offset.x, info.velocity.x)}
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
                    onClick={() => {
                      if (cardDragRef.current) return;
                      setSelectedFood(topCard);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedFood(topCard);
                      }
                    }}
                    className="relative flex h-[clamp(300px,calc(100svh-302px),520px)] touch-pan-y cursor-grab flex-col overflow-hidden rounded-[1.8rem] border-2 border-[#ffd1d8] bg-white shadow-[0_4px_0_#ffe9ed] active:cursor-grabbing"
                  >
                    {(topCard.name || topCard.ingredients || topCard.instructions) ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={translatingFoodId === topCard.id || Boolean(translatedFoods[topCard.id])}
                        onClick={(event) => {
                          event.stopPropagation();
                          void translateFood(topCard);
                        }}
                        className="absolute right-3 top-3 z-10 h-11 w-11 rounded-full border-2 border-white/80 bg-white/95 p-0 text-[#be123c] shadow-[0_4px_14px_rgba(154,25,42,0.10)]"
                        aria-label="Перекласти картку"
                      >
                        {translatingFoodId === topCard.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Languages className="h-5 w-5" />}
                      </Button>
                    ) : null}
                    <FoodImage
                      src={topCard.image_url}
                      alt={topCard.name}
                      className="min-h-0 flex-1 object-cover"
                      placeholderClassName="flex min-h-0 flex-1 items-center justify-center bg-[#fff1f3]"
                      iconClassName="text-6xl"
                    />
                    <div className="shrink-0 space-y-1 p-3.5">
                      <h2 className="line-clamp-2 text-[1.35rem] font-black leading-tight text-[#351316]">{topCardText?.name}</h2>
                      {topCardText?.ingredients ? (
                        <p className="line-clamp-1 text-sm font-bold leading-5 text-[#7a3a43]">{topCardText.ingredients}</p>
                      ) : null}
                    </div>
                  </motion.div>
                </AnimatePresence>
                <div className="flex items-center justify-center gap-4">
                  <Button
                    disabled={!topCard || swipingFoodId !== null}
                    onClick={() => void swipe(topCard, "dislike")}
                    className="btn-duo-danger h-14 w-14 rounded-full p-0 text-2xl shadow-[0_5px_16px_rgba(255,75,75,0.12)] disabled:bg-[#b7b7b7] disabled:border-[#929292]"
                    aria-label="Не хочу"
                  >
                    <ThumbsDown className="h-7 w-7" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!lastSwipe || swipingFoodId !== null}
                    onClick={() => void undoLastSwipe()}
                    className="h-11 w-11 rounded-full border-2 border-[#ffd1d8] bg-white p-0 text-[#7a3a43] shadow-[0_3px_0_#ffe9ed] disabled:opacity-40"
                    aria-label="Назад"
                  >
                    <RotateCcw className="h-5 w-5" />
                  </Button>
                  <Button
                    disabled={!topCard || swipingFoodId !== null}
                    onClick={() => void swipe(topCard, "like")}
                    className="btn-duo-primary h-14 w-14 rounded-full p-0 text-2xl shadow-[0_5px_16px_rgba(225,29,72,0.12)] disabled:bg-[#b7b7b7] disabled:border-[#929292]"
                    aria-label="Хочу"
                  >
                    <ThumbsUp className="h-7 w-7" />
                  </Button>
                </div>
              </div>
            ) : (
              <Card className="rounded-[2rem] border-2 border-dashed border-[#badea8] bg-white shadow-[0_4px_0_#edf8e6]">
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

          <TabsContent value="results" className="min-h-0 space-y-3 overflow-y-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setFiltersOpen(true)}
              className="flex w-full items-center justify-between rounded-[1.6rem] border-2 border-[#ffd1d8] bg-white px-4 py-3 text-left shadow-[0_3px_0_#ffe9ed]"
            >
              <span className="flex min-w-0 items-center gap-2 text-sm font-black text-[#351316]">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-[#e11d48]" />
                <span className="truncate">{filterSummaryText}</span>
              </span>
              {hasActiveFilters ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff4b4b]" /> : null}
            </button>

            <div className="grid grid-cols-3 gap-2 rounded-[1.25rem] border-2 border-[#ffe4e8] bg-white p-1 shadow-[0_3px_0_#ffe9ed]">
              <Button
                variant="ghost"
                onClick={() => setResultView("matches")}
                className={`h-11 rounded-2xl px-2 text-sm font-black ${
                  resultView === "matches" ? "bg-[#e11d48] text-white" : "text-[#7a3a43]"
                }`}
              >
                Метчі
              </Button>
              <Button
                variant="ghost"
                onClick={() => setResultView("mine")}
                className={`h-11 rounded-2xl px-2 text-sm font-black ${
                  resultView === "mine" ? "bg-[#e11d48] text-white" : "text-[#7a3a43]"
                }`}
              >
                Мої Смаки
              </Button>
              <Button
                variant="ghost"
                onClick={() => setResultView("partner")}
                className={`h-11 rounded-2xl px-2 text-sm font-black ${
                  resultView === "partner" ? "bg-[#e11d48] text-white" : "text-[#7a3a43]"
                }`}
              >
                {otherName || "Партнер"}
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
                <p className="rounded-[1.35rem] border-2 border-[#ffe4e8] bg-white p-4 text-sm font-semibold text-[#6b7280] shadow-[0_3px_0_#ffe9ed]">Поки що метчів немає.</p>
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
                <p className="rounded-[1.35rem] border-2 border-[#ffe4e8] bg-white p-4 text-sm font-semibold text-[#6b7280] shadow-[0_3px_0_#ffe9ed]">Твоїх окремих смаків поки немає.</p>
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
                <p className="rounded-[1.35rem] border-2 border-[#ffe4e8] bg-white p-4 text-sm font-semibold text-[#6b7280] shadow-[0_3px_0_#ffe9ed]">Смаки партнера ще не відрізняються.</p>
              )
            ) : null}
          </TabsContent>

          <TabsList className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 mx-auto grid !h-[72px] w-[calc(100%-1.5rem)] max-w-md grid-cols-2 overflow-hidden rounded-[1.6rem] border-2 border-[#ffd1d8] bg-white/95 p-1.5 shadow-[0_4px_0_#ffe9ed] backdrop-blur">
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
        <div className="fixed left-1/2 top-[calc(0.75rem+env(safe-area-inset-top))] z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border-2 border-[#ffd1d8] bg-white px-4 py-2 text-sm font-black text-[#be123c] shadow-[0_4px_0_#ffe9ed]">
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
            className="fixed left-3 right-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[65] mx-auto max-w-md overflow-hidden rounded-[1.35rem] border-2 border-[#fecdd3] bg-white shadow-[0_8px_24px_rgba(154,25,42,0.10)]"
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#e11d48] text-white">
                <Heart className="h-5 w-5 fill-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-[#351316]">Match on {getFoodText(recentMatch.food, translatedFoods[recentMatch.food.id]).name}</p>
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
          className="bottom-0 left-0 top-auto z-50 max-h-[86vh] w-full max-w-none translate-x-0 translate-y-0 gap-5 rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-5 shadow-[0_-10px_36px_rgba(154,25,42,0.10)] sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:rounded-b-[2rem]"
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
              savedRooms.map((savedRoom) => {
                const savedRoomDetail = savedRoomDetails[savedRoom.id];
                const isActiveRoom = savedRoom.id === roomId;
                if (isActiveRoom) {
                  return (
                    <div
                      key={savedRoom.id}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-[#e11d48] bg-[#fff1f3] p-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-[#351316]">Room {roomCode(savedRoom.id)}</span>
                        <span className="block truncate text-xs font-bold text-[#9f5660]">{roomMemberLine(savedRoomDetail, savedRoom.playerName)}</span>
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={copyLink}
                          className="h-10 rounded-2xl border-2 border-[#ffd1d8] bg-white px-3 font-black text-[#be123c]"
                        >
                          {copiedLink ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                          Інвайт
                        </Button>
                        <Check className="h-5 w-5 text-[#e11d48]" />
                      </div>
                    </div>
                  );
                }

                return (
                  <button
                    key={savedRoom.id}
                    type="button"
                    onClick={() => switchRoom(savedRoom.id)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border-2 border-[#ffd1d8] bg-white p-3 text-left transition hover:bg-[#fff7f8]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-[#351316]">Room {roomCode(savedRoom.id)}</span>
                      <span className="block truncate text-xs font-bold text-[#9f5660]">{roomMemberLine(savedRoomDetail, savedRoom.playerName)}</span>
                    </span>
                    <ArrowRight className="h-5 w-5 shrink-0 text-[#be123c]" />
                  </button>
                );
              })
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
              onClick={() => setLeaveConfirmOpen(true)}
              className="h-12 rounded-2xl border-2 border-[#ffd1d8] text-base font-black text-[#be123c]"
            >
              <DoorOpen className="h-5 w-5" />
              Вийти з цієї кімнати
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={onboardingOpen} onOpenChange={setOnboardingOpen}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto z-50 w-full max-w-none translate-x-0 translate-y-0 gap-4 rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-10px_36px_rgba(154,25,42,0.10)] sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <DialogHeader>
            <div className="mx-auto h-1.5 w-12 rounded-full bg-[#ffd1d8]" />
            <DialogTitle className="pt-2 text-center text-2xl font-black text-[#351316]">Кімната готова</DialogTitle>
            <DialogDescription className="mx-auto max-w-xs text-center text-sm font-bold leading-6 text-[#7a3a43]">
              Скопіюй інвайт і надішли партнеру. Коли він зайде, ви зможете свайпати одну й ту саму добірку.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Button
              type="button"
              onClick={() => void copyLink()}
              className="btn-duo-primary h-12 rounded-2xl text-base font-black"
            >
              {copiedLink ? <Check /> : <Link2 />}
              {copiedLink ? "Посилання скопійовано" : "Скопіювати інвайт"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOnboardingOpen(false)}
              className="h-12 rounded-2xl border-2 border-[#ffd1d8] text-base font-black text-[#be123c]"
            >
              Почати свайпати
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={leaveConfirmOpen} onOpenChange={setLeaveConfirmOpen}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto z-50 w-full max-w-none translate-x-0 translate-y-0 gap-4 rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-10px_36px_rgba(154,25,42,0.10)] sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <DialogHeader>
            <div className="mx-auto h-1.5 w-12 rounded-full bg-[#ffd1d8]" />
            <DialogTitle className="pt-2 text-center text-2xl font-black text-[#351316]">Вийти з кімнати?</DialogTitle>
            <DialogDescription className="mx-auto max-w-xs text-center text-sm font-bold leading-6 text-[#7a3a43]">
              Твої свайпи в цій кімнаті очистяться на цьому кроці.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <Button
              type="button"
              onClick={() => void leaveRoom()}
              className="btn-duo-danger h-12 rounded-2xl text-base font-black"
            >
              <DoorOpen />
              Так, вийти
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLeaveConfirmOpen(false)}
              className="h-12 rounded-2xl border-2 border-[#ffd1d8] text-base font-black text-[#be123c]"
            >
              Залишитись
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto z-50 grid max-h-[calc(100svh-1rem)] w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-5 rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-5 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-10px_36px_rgba(154,25,42,0.10)] sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:rounded-b-[2rem]"
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

          <div className="min-h-0 space-y-5 overflow-y-auto pb-1 no-scrollbar">
            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#9f5660]">Що показувати</p>
              <div className="grid grid-cols-3 gap-2">
                {filterOptions.foodTypes.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    onClick={() => setFoodTypeFilter(option.value)}
                    className={`flex h-14 flex-col gap-0.5 rounded-2xl border-2 px-1.5 text-center text-xs font-black leading-none !whitespace-normal ${
                      foodTypeFilter === option.value
                        ? "border-[#9f1239] bg-[#e11d48] text-white"
                        : "border-[#ffe4e8] bg-[#fff7f8] text-[#7a3a43]"
                    }`}
                  >
                    {option.count ? (
                      <>
                        <span className="max-w-full truncate">{option.label}</span>
                        <span className="opacity-70">{option.count}</span>
                      </>
                    ) : (
                      <span className="max-w-full truncate">{option.label}</span>
                    )}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#9f5660]">Тип страви</p>
              <div className="grid grid-cols-2 gap-2">
                {filterOptions.dishKinds.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      if (option.value === "all") {
                        setDishKindFilters([]);
                        return;
                      }
                      setDishKindFilters((prev) => (
                        prev.includes(option.value)
                          ? prev.filter((value) => value !== option.value)
                          : [...prev, option.value]
                      ));
                    }}
                    className={`flex h-14 flex-col gap-0.5 rounded-2xl border-2 px-1.5 text-center text-xs font-black leading-none !whitespace-normal ${
                      (option.value === "all" ? dishKindFilters.length === 0 : dishKindFilters.includes(option.value))
                        ? "border-[#9f1239] bg-[#e11d48] text-white"
                        : "border-[#ffe4e8] bg-[#fff7f8] text-[#7a3a43]"
                    }`}
                  >
                    {option.count ? (
                      <>
                        <span className="max-w-full truncate">{option.label}</span>
                        <span className="opacity-70">{option.count}</span>
                      </>
                    ) : (
                      <span className="max-w-full truncate">{option.label}</span>
                    )}
                  </Button>
                ))}
              </div>
            </section>

          </div>

          <div className="grid grid-cols-[0.8fr_1.2fr] gap-3 border-t border-[#ffe4e8] pt-4">
            <Button type="button" variant="outline" onClick={clearFilters} className="h-12 rounded-2xl border-2 font-black">
              Скинути
            </Button>
            <Button type="button" onClick={() => setFiltersOpen(false)} className="btn-duo-primary h-12 rounded-2xl text-base font-black">
              Готово
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selectedFood)} onOpenChange={(open) => !open && setSelectedFood(null)}>
        <DialogContent
          showCloseButton={false}
          className="bottom-0 left-0 top-auto max-h-[calc(100svh-1rem)] w-full max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-b-none rounded-t-[2rem] border-2 border-[#ffd1d8] bg-white p-0 shadow-[0_-10px_36px_rgba(154,25,42,0.10)] sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:rounded-b-[2rem]"
        >
          <div className="relative">
            <div className="absolute left-1/2 top-3 z-10 h-1.5 w-12 -translate-x-1/2 rounded-full bg-white/80 shadow-sm" />
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelectedFood(null)}
              className="absolute right-3 top-3 z-10 h-10 w-10 rounded-full bg-white/90 p-0 text-[#351316] shadow-[0_4px_14px_rgba(53,19,22,0.10)]"
              aria-label="Закрити"
            >
              <X className="h-5 w-5" />
            </Button>
            <FoodImage
              src={selectedFood?.image_url}
              alt={selectedFood?.name ?? ""}
              className="h-56 w-full object-cover"
              placeholderClassName="flex h-40 items-center justify-center bg-[#fff1f3]"
              iconClassName="text-6xl"
            />
          </div>
          <div className="space-y-4 p-5">
            <DialogHeader>
              <div className="flex items-start justify-between gap-3">
                <DialogTitle className="text-left text-2xl font-black leading-tight text-[#351316]">{selectedFoodText?.name}</DialogTitle>
                {selectedFood && (selectedFood.name || selectedFood.ingredients || selectedFood.instructions) ? (
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
        <DialogContent showCloseButton={false} className="card-duo overflow-hidden bg-[#fff1f3] p-0 sm:max-w-md">
          <div className="relative min-h-80 overflow-hidden bg-[#fff1f3] px-5 pb-5 pt-8 text-center">
            {[...Array(14)].map((_, index) => (
              <motion.span
                key={`left-${index}`}
                className="absolute left-5 text-[#e11d48]/70"
                initial={{
                  opacity: 0,
                  y: -40,
                  x: (index % 3) * 18,
                  rotate: -16,
                  scale: 0.55,
                }}
                animate={{
                  opacity: [0, 1, 0.9, 0],
                  y: 300,
                  x: (index % 3) * 18 + Math.sin(index) * 18,
                  rotate: -16 + index * 6,
                  scale: [0.55, 1, 0.8],
                }}
                transition={{ duration: 2.4, delay: index * 0.08, ease: "easeInOut" }}
              >
                <Heart className="h-5 w-5 fill-current" />
              </motion.span>
            ))}
            {[...Array(14)].map((_, index) => (
              <motion.span
                key={`right-${index}`}
                className="absolute right-5 text-[#e11d48]/70"
                initial={{
                  opacity: 0,
                  y: -40,
                  x: -(index % 3) * 18,
                  rotate: 16,
                  scale: 0.55,
                }}
                animate={{
                  opacity: [0, 1, 0.9, 0],
                  y: 300,
                  x: -(index % 3) * 18 + Math.cos(index) * 18,
                  rotate: 16 - index * 6,
                  scale: [0.55, 1, 0.8],
                }}
                transition={{ duration: 2.4, delay: index * 0.08, ease: "easeInOut" }}
              >
                <Heart className="h-5 w-5 fill-current" />
              </motion.span>
            ))}
            <div className="relative z-10 mx-auto mb-5 flex items-center justify-center">
              <div className="h-24 w-24 overflow-hidden rounded-full border-4 border-white bg-white shadow-[0_8px_24px_rgba(154,25,42,0.12)]">
                <FoodImage
                  src={matchFood?.image_url}
                  alt={matchFoodText?.name ?? ""}
                  className="h-full w-full object-cover"
                  placeholderClassName="flex h-full w-full items-center justify-center bg-[#fff7f8]"
                />
              </div>
              <div className="h-1 w-9 rounded-full bg-[#e11d48]" />
              <div className="flex h-24 w-24 items-center justify-center rounded-full border-4 border-white bg-[#e11d48] text-white shadow-[0_7px_18px_rgba(154,25,42,0.12)]">
                <Heart className="h-11 w-11 fill-white" />
              </div>
            </div>
            <DialogHeader>
              <DialogTitle className="relative z-10 text-center text-4xl font-black leading-none text-[#351316]">It&apos;s a match</DialogTitle>
              <DialogDescription className="mx-auto mt-3 max-w-xs text-center text-base font-bold leading-6 text-[#7a3a43]">
                Ви обоє хочете {matchFoodText?.name}. Схоже, вечеря сама себе обрала.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="px-5 pb-5">
            <Button variant="outline" className="h-12 w-full rounded-2xl border-2 border-[#ffd1d8] bg-white/70 font-black text-[#be123c]" onClick={() => setMatchFood(null)}>
              Продовжити свайпати
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {error ? <p className="text-center text-sm font-semibold text-[#ea2b2b]">{error}</p> : null}
    </main>
  );
}
