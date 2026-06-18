"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Cherry, ImageUp, Loader2, LogOut, Save, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Food, FoodType } from "@/lib/types";

type AdminFood = Food & {
  created_at: string;
};

type AdminFoodsResponse = {
  foods: AdminFood[];
  count: number;
  page: number;
  pageSize: number;
  error?: string;
};

type DraftFood = Pick<AdminFood, "id" | "name" | "image_url" | "ingredients" | "instructions" | "food_type" | "meal_type">;

const pageSize = 40;

function emptyDraft(): DraftFood {
  return {
    id: "",
    name: "",
    image_url: null,
    ingredients: null,
    instructions: null,
    food_type: null,
    meal_type: null,
  };
}

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [password, setPassword] = useState("");
  const [foods, setFoods] = useState<AdminFood[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState<FoodType | "all">("all");
  const [selectedFood, setSelectedFood] = useState<AdminFood | null>(null);
  const [draft, setDraft] = useState<DraftFood>(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const totalPages = useMemo(() => Math.max(Math.ceil(count / pageSize), 1), [count]);

  const loadFoods = async (nextPage = page) => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(pageSize),
      type,
    });
    if (search.trim()) params.set("search", search.trim());

    const response = await fetch(`/api/admin/foods?${params.toString()}`);
    const payload = (await response.json().catch(() => null)) as AdminFoodsResponse | null;
    setLoading(false);

    if (!response.ok || !payload) {
      setError(payload?.error ?? "Не вдалося завантажити каталог.");
      if (response.status === 401) setAuthenticated(false);
      return;
    }

    setFoods(payload.foods);
    setCount(payload.count);
    setPage(payload.page);
  };

  useEffect(() => {
    const checkSession = async () => {
      const response = await fetch("/api/admin/session");
      const payload = (await response.json().catch(() => null)) as { authenticated?: boolean } | null;
      setAuthenticated(Boolean(payload?.authenticated));
      setCheckingSession(false);
    };

    void checkSession();
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    const load = window.setTimeout(() => {
      void loadFoods(1);
    }, 0);

    return () => window.clearTimeout(load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, type]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error ?? "Не вдалося увійти.");
      return;
    }

    setPassword("");
    setAuthenticated(true);
  };

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false);
    setFoods([]);
    setSelectedFood(null);
  };

  const selectFood = (food: AdminFood) => {
    setSelectedFood(food);
    setDraft({
      id: food.id,
      name: food.name,
      image_url: food.image_url,
      ingredients: food.ingredients,
      instructions: food.instructions,
      food_type: food.food_type,
      meal_type: food.meal_type,
    });
  };

  const saveFood = async () => {
    setSaving(true);
    setError("");

    const response = await fetch("/api/admin/foods", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft),
    });
    const payload = (await response.json().catch(() => null)) as { food?: AdminFood; error?: string } | null;
    setSaving(false);

    if (!response.ok || !payload?.food) {
      setError(payload?.error ?? "Не вдалося зберегти.");
      return;
    }

    setSelectedFood(payload.food);
    setFoods((prev) => prev.map((food) => (food.id === payload.food?.id ? payload.food : food)));
  };

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff5f6] text-[#be123c]">
        <Loader2 className="animate-spin" />
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff5f6] px-5 text-[#351316]">
        <form onSubmit={login} className="w-full max-w-sm rounded-[2rem] border-2 border-[#ffd1d8] bg-white p-5 shadow-[0_4px_0_#ffe9ed]">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-[#e11d48] shadow-[0_4px_0_#f8cbd2]">
            <Cherry className="text-white" />
          </div>
          <h1 className="text-center text-3xl font-black">FoodMatch Admin</h1>
          <div className="mt-6 space-y-3">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Admin password"
              className="h-12 rounded-2xl border-2 border-[#ffd1d8] font-bold"
            />
            {error ? <p className="text-sm font-bold text-[#b42318]">{error}</p> : null}
            <Button disabled={loading} className="btn-duo-primary h-12 w-full rounded-2xl text-base font-black">
              {loading ? <Loader2 className="animate-spin" /> : null}
              Увійти
            </Button>
          </div>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff5f6] text-[#351316]">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-4">
        <header className="flex items-center justify-between gap-3 border-b-2 border-[#ffd1d8] pb-4">
          <div>
            <h1 className="text-3xl font-black">FoodMatch Admin</h1>
            <p className="text-sm font-bold text-[#9f5660]">Meals, ingredients, images and recipe text.</p>
          </div>
          <Button variant="outline" onClick={() => void logout()} className="h-11 rounded-2xl border-2 border-[#ffd1d8] font-black text-[#be123c]">
            <LogOut />
            Вийти
          </Button>
        </header>

        <section className="grid min-h-0 flex-1 gap-4 py-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
          <div className="min-h-0 rounded-[1.4rem] border-2 border-[#ffd1d8] bg-white p-3 shadow-[0_3px_0_#ffe9ed]">
            <div className="grid gap-2 pb-3 md:grid-cols-[1fr_auto_auto]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9f5660]" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void loadFoods(1);
                  }}
                  placeholder="Search by name"
                  className="h-11 rounded-2xl border-2 border-[#ffd1d8] pl-11 font-bold"
                />
              </div>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as FoodType | "all")}
                className="h-11 rounded-2xl border-2 border-[#ffd1d8] bg-white px-3 text-sm font-black text-[#7a3a43]"
              >
                <option value="all">All</option>
                <option value="recipe">Meals</option>
                <option value="ingredient">Ingredients</option>
                <option value="product">Products</option>
                <option value="fastfood">Fastfood</option>
              </select>
              <Button onClick={() => void loadFoods(1)} disabled={loading} className="btn-duo-primary h-11 rounded-2xl font-black">
                {loading ? <Loader2 className="animate-spin" /> : <Search />}
                Знайти
              </Button>
            </div>

            {error ? <p className="mb-3 rounded-2xl bg-[#fff1f3] p-3 text-sm font-bold text-[#b42318]">{error}</p> : null}

            <div className="max-h-[calc(100svh-15rem)] overflow-y-auto rounded-2xl border border-[#ffe4e8]">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 bg-[#fff7f8] text-xs uppercase tracking-[0.12em] text-[#9f5660]">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Image</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {foods.map((food) => (
                    <tr
                      key={food.id}
                      onClick={() => selectFood(food)}
                      className={`cursor-pointer border-t border-[#ffe4e8] hover:bg-[#fff7f8] ${selectedFood?.id === food.id ? "bg-[#fff1f3]" : ""}`}
                    >
                      <td className="max-w-xs truncate px-3 py-2 font-black">{food.name}</td>
                      <td className="px-3 py-2 font-bold text-[#7a3a43]">{food.food_type}</td>
                      <td className="px-3 py-2">
                        {food.image_url ? <span className="font-black text-[#15803d]">yes</span> : <span className="font-black text-[#b42318]">no</span>}
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2 text-xs font-bold text-[#9f5660]">{food.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <Button variant="outline" disabled={page <= 1 || loading} onClick={() => void loadFoods(page - 1)} className="h-10 rounded-2xl border-2 font-black">
                Previous
              </Button>
              <p className="text-sm font-black text-[#7a3a43]">
                Page {page} / {totalPages} · {count} rows
              </p>
              <Button variant="outline" disabled={page >= totalPages || loading} onClick={() => void loadFoods(page + 1)} className="h-10 rounded-2xl border-2 font-black">
                Next
              </Button>
            </div>
          </div>

          <aside className="min-h-0 rounded-[1.4rem] border-2 border-[#ffd1d8] bg-white p-4 shadow-[0_3px_0_#ffe9ed]">
            {selectedFood ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="min-w-0 truncate text-2xl font-black">{selectedFood.name}</h2>
                  <Button onClick={() => void saveFood()} disabled={saving} className="btn-duo-primary h-11 rounded-2xl font-black">
                    {saving ? <Loader2 className="animate-spin" /> : <Save />}
                    Save
                  </Button>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-[#9f5660]">Name</span>
                  <Input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} className="h-11 rounded-2xl border-2 font-bold" />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-[#9f5660]">Image URL</span>
                  <div className="flex gap-2">
                    <Input
                      value={draft.image_url ?? ""}
                      onChange={(event) => setDraft((prev) => ({ ...prev, image_url: event.target.value }))}
                      className="h-11 rounded-2xl border-2 font-bold"
                    />
                    <Button variant="outline" className="h-11 rounded-2xl border-2 px-3 text-[#be123c]" aria-label="Image URL">
                      <ImageUp />
                    </Button>
                  </div>
                </label>

                {draft.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.image_url} alt={draft.name} className="h-44 w-full rounded-2xl object-cover" />
                ) : (
                  <div className="flex h-44 items-center justify-center rounded-2xl bg-[#fff1f3] text-5xl">🍽️</div>
                )}

                <label className="block space-y-1">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-[#9f5660]">Ingredients</span>
                  <textarea
                    value={draft.ingredients ?? ""}
                    onChange={(event) => setDraft((prev) => ({ ...prev, ingredients: event.target.value }))}
                    className="min-h-28 w-full rounded-2xl border-2 border-[#ffd1d8] bg-white p-3 text-sm font-bold outline-none focus:border-[#e11d48]"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-black uppercase tracking-[0.12em] text-[#9f5660]">Instructions</span>
                  <textarea
                    value={draft.instructions ?? ""}
                    onChange={(event) => setDraft((prev) => ({ ...prev, instructions: event.target.value }))}
                    className="min-h-40 w-full rounded-2xl border-2 border-[#ffd1d8] bg-white p-3 text-sm font-bold outline-none focus:border-[#e11d48]"
                  />
                </label>
              </div>
            ) : (
              <div className="flex h-full min-h-80 items-center justify-center rounded-2xl bg-[#fff7f8] p-5 text-center text-sm font-bold leading-6 text-[#7a3a43]">
                Select a meal or ingredient to edit details and images.
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
