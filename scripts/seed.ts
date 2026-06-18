import { readFile } from "node:fs/promises";

import { parse } from "csv-parse/sync";
import { config } from "dotenv";
import translate from "google-translate-api-next";

config({ path: ".env.local" });
config();

type FoodType = "recipe" | "ingredient" | "product" | "fastfood";
type MealType = "breakfast" | "lunch" | "dinner" | "snack";
type SeedSource = "json" | "recipe-dataset" | "openfoodfacts" | "themealdb" | "themealdb-ingredients" | "themealdb-meals";

type RawFood = {
  name: string;
  image_url?: string | null;
  food_type?: FoodType;
  meal_type?: MealType;
  tags?: string[];
  source?: string | null;
  external_id?: string | null;
  ingredients?: string | null;
  instructions?: string | null;
};

type RecipeDatasetRow = {
  Title?: string;
  Ingredients?: string;
  Instructions?: string;
  Image_Name?: string;
  Cleaned_Ingredients?: string;
};

type OpenFoodFactsProduct = {
  code?: string;
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  ingredients_text?: string;
  image_front_url?: string;
  categories_tags?: string[];
};

type MealDbMeal = {
  idMeal?: string;
  strMeal?: string;
  strCategory?: string;
  strArea?: string;
  strInstructions?: string;
  strMealThumb?: string;
  strTags?: string;
  [key: `strIngredient${number}`]: string | undefined;
  [key: `strMeasure${number}`]: string | undefined;
};

type MealDbIngredient = {
  idIngredient?: string;
  strIngredient?: string;
  strType?: string | null;
};

type FoodInsert = {
  name: string;
  image_url: string | null;
  food_type: FoodType;
  meal_type: MealType | null;
  tags: string[];
  source: string | null;
  external_id: string | null;
  ingredients: string | null;
  instructions: string | null;
};

const recipeDatasetUrl =
  "https://raw.githubusercontent.com/josephrmartinez/recipe-dataset/main/13k-recipes.csv";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const translationCache = new Map<string, string>();
const transientStatuses = new Set([429, 500, 502, 503, 504]);
const mealDbLetters = "abcdefghijklmnopqrstuvwxyz".split("");
const ingredientUkNames: Record<string, string> = {
  apple: "Яблуко",
  apricot: "Абрикос",
  asparagus: "Спаржа",
  aubergine: "Баклажан",
  avocado: "Авокадо",
  bacon: "Бекон",
  banana: "Банан",
  basil: "Базилік",
  beef: "Яловичина",
  beetroot: "Буряк",
  bread: "Хліб",
  broccoli: "Броколі",
  butter: "Масло",
  cabbage: "Капуста",
  carrot: "Морква",
  cauliflower: "Цвітна капуста",
  celery: "Селера",
  cheese: "Сир",
  chicken: "Курка",
  chilli: "Перець чилі",
  chocolate: "Шоколад",
  coriander: "Кінза",
  cream: "Вершки",
  cucumber: "Огірок",
  duck: "Качка",
  egg: "Яйце",
  eggs: "Яйця",
  flour: "Борошно",
  garlic: "Часник",
  ginger: "Імбир",
  honey: "Мед",
  lamb: "Баранина",
  lemon: "Лимон",
  lentils: "Сочевиця",
  lettuce: "Салат",
  lime: "Лайм",
  milk: "Молоко",
  mint: "М'ята",
  mushroom: "Гриби",
  mushrooms: "Гриби",
  onion: "Цибуля",
  orange: "Апельсин",
  parsley: "Петрушка",
  pasta: "Паста",
  peas: "Горох",
  pepper: "Перець",
  pork: "Свинина",
  potato: "Картопля",
  potatoes: "Картопля",
  rice: "Рис",
  salmon: "Лосось",
  salt: "Сіль",
  sausage: "Ковбаса",
  spinach: "Шпинат",
  sugar: "Цукор",
  tomato: "Томат",
  tomatoes: "Томати",
  tuna: "Тунець",
  turkey: "Індичка",
  vinegar: "Оцет",
  water: "Вода",
  yoghurt: "Йогурт",
  yogurt: "Йогурт",
  zucchini: "Кабачок",
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTag(value: string) {
  return value
    .replace(/^en:/, "")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function cleanIngredientName(value: string) {
  return value
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(\d+\/\d+|\d+(\.\d+)?|½|¼|¾|⅓|⅔|⅛|⅜|⅝|⅞)\b/g, " ")
    .replace(/\b(cups?|tbsp|tablespoons?|tsp|teaspoons?|grams?|g|kg|lb|lbs|oz|ounces?|ml|l|pinch|dash|cloves?|large|small|medium|fresh|chopped|sliced|diced|minced|peeled|crushed|ground|optional|to serve|of)\b/gi, " ")
    .replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayIngredientName(value: string) {
  const cleaned = cleanIngredientName(value);
  const normalized = normalizeTag(cleaned);
  return ingredientUkNames[normalized] ?? titleCase(cleaned);
}

function compactTags(tags: Array<string | undefined | null>) {
  return [...new Set(tags.map((tag) => (tag ? normalizeTag(tag) : "")).filter(Boolean))].slice(0, 10);
}

async function fetchJsonWithRetry<T>(url: URL | string, init: RequestInit, label: string): Promise<T> {
  const retries = parsePositiveInt(process.env.SEED_FETCH_RETRIES, 3);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const response = await fetch(url, init);
    const contentType = response.headers.get("content-type") ?? "";

    if (response.ok && contentType.includes("application/json")) {
      return (await response.json()) as T;
    }

    const body = (await response.text()).slice(0, 180);
    lastError = new Error(`${label} response was not JSON (${response.status}): ${body}`);
    if (!transientStatuses.has(response.status) || attempt === retries) {
      break;
    }

    await sleep(1000 * (attempt + 1));
  }

  throw lastError ?? new Error(`${label} request failed.`);
}

function extractIngredientTags(value: string | undefined) {
  if (!value) return [];
  const quotedItems = [...value.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const source = quotedItems.length > 0 ? quotedItems.join(" ") : value;
  return compactTags(source.match(/[A-Za-z][A-Za-z -]{2,}/g) ?? []);
}

function ingredientListToText(ingredients: string[]) {
  return ingredients.length > 0 ? ingredients.join(", ") : null;
}

function ingredientRowsFrom(rows: FoodInsert[], limit: number): FoodInsert[] {
  const seen = new Set<string>();
  const ingredients: FoodInsert[] = [];

  for (const row of rows) {
    for (const tag of row.tags) {
      const normalized = normalizeTag(cleanIngredientName(tag));
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      ingredients.push({
        name: ingredientUkNames[normalized] ?? titleCase(normalized),
        image_url: null,
        food_type: "ingredient",
        meal_type: null,
        tags: [normalized],
        source: `${row.source ?? "unknown"}-ingredients`,
        external_id: normalized,
        ingredients: null,
        instructions: null,
      });

      if (ingredients.length >= limit) return ingredients;
    }
  }

  return ingredients;
}

async function translateUk(text: string, enabled: boolean): Promise<string> {
  const trimmed = text.trim();
  if (!enabled || !trimmed) return text;
  const cached = translationCache.get(trimmed);
  if (cached) return cached;

  try {
    const result = await (translate as unknown as (value: string, options: { to: string }) => Promise<string>)(
      trimmed,
      { to: "uk" },
    );
    const translated = result || text;
    translationCache.set(trimmed, translated);
    await sleep(350);
    return translated;
  } catch (error) {
    console.warn(`Translation failed for "${trimmed}", using source text.`, error);
    return text;
  }
}

async function translateRow(row: FoodInsert, enabled: boolean, translateTags: boolean): Promise<FoodInsert> {
  return {
    ...row,
    name: await translateUk(row.name, enabled),
    tags: await Promise.all(row.tags.map((tag) => translateUk(tag, enabled && translateTags))),
  };
}

async function readJsonRows(sourcePath: string, limit: number): Promise<FoodInsert[]> {
  const raw = await readFile(sourcePath, "utf-8");
  const parsed = JSON.parse(raw) as RawFood[];

  return parsed.slice(0, limit).map((food, index) => ({
    name: food.name,
    image_url: food.image_url ?? null,
    food_type: food.food_type ?? "recipe",
    meal_type: food.meal_type ?? "dinner",
    tags: compactTags(food.tags ?? []),
    source: food.source ?? "local-json",
    external_id: food.external_id ?? `${sourcePath}:${index}`,
    ingredients: food.ingredients ?? null,
    instructions: food.instructions ?? null,
  }));
}

async function readRecipeDatasetRows(url: string, limit: number): Promise<FoodInsert[]> {
  const response = await fetch(url, {
    headers: { "User-Agent": "FoodMatch/0.1 recipe seed script" },
  });
  if (!response.ok) {
    throw new Error(`Recipe dataset download failed: ${response.status} ${response.statusText}`);
  }

  const csv = await response.text();
  const records = parse(csv, {
    columns: true,
    bom: true,
    relax_quotes: true,
    skip_empty_lines: true,
  }) as RecipeDatasetRow[];

  return records
    .filter((row) => row.Title?.trim())
    .slice(0, limit)
    .map((row, index) => ({
      name: row.Title!.trim(),
      image_url: null,
      food_type: "recipe",
      meal_type: "dinner",
      tags: extractIngredientTags(row.Cleaned_Ingredients ?? row.Ingredients),
      source: "josephrmartinez/recipe-dataset",
      external_id: row.Image_Name || `recipe-${index}`,
      ingredients: row.Ingredients ?? null,
      instructions: row.Instructions ?? null,
    }));
}

async function readOpenFoodFactsRows(searchTerms: string[], categoryTags: string[], limit: number): Promise<FoodInsert[]> {
  const rows: FoodInsert[] = [];
  const pageSize = Math.min(50, Math.max(1, limit));
  const requests =
    categoryTags.length > 0
      ? categoryTags.map((tag) => ({ categoryTag: tag, searchTerm: "" }))
      : searchTerms.map((term) => ({ categoryTag: "", searchTerm: term }));

  for (const request of requests) {
    if (rows.length >= limit) break;
    const url = new URL("https://world.openfoodfacts.org/api/v2/search");
    if (request.categoryTag) {
      url.searchParams.set("categories_tags", request.categoryTag);
    }
    if (request.searchTerm) {
      url.searchParams.set("search_terms", request.searchTerm);
    }
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set(
      "fields",
      "code,product_name,product_name_en,generic_name,ingredients_text,image_front_url,categories_tags",
    );

    const payload = await fetchJsonWithRetry<{ products?: OpenFoodFactsProduct[] }>(url, {
      headers: { "User-Agent": "FoodMatch/0.1 product seed script" },
    }, "Open Food Facts");

    for (const product of payload.products ?? []) {
      const name = product.product_name_en || product.product_name || product.generic_name;
      if (!name || rows.length >= limit) continue;
      rows.push({
        name,
        image_url: product.image_front_url ?? null,
        food_type: "recipe",
        meal_type: "snack",
        tags: compactTags(product.categories_tags ?? [request.categoryTag || request.searchTerm]),
        source: "openfoodfacts",
        external_id: product.code ?? name,
        ingredients: product.ingredients_text ?? null,
        instructions: null,
      });
    }

    await sleep(1200);
  }

  return rows;
}

function mealDbMealToRow(meal: MealDbMeal): FoodInsert | null {
  const name = meal.strMeal?.trim();
  if (!name) return null;

  const ingredients: string[] = [];
  const ingredientTags: string[] = [];
  for (let index = 1; index <= 20; index += 1) {
    const ingredient = meal[`strIngredient${index}`]?.trim();
    const measure = meal[`strMeasure${index}`]?.trim();
    if (!ingredient) continue;
    ingredients.push(measure ? `${measure} ${ingredient}` : ingredient);
    ingredientTags.push(cleanIngredientName(ingredient));
  }

  return {
    name,
    image_url: meal.strMealThumb ?? null,
    food_type: "recipe",
    meal_type: "dinner",
    tags: compactTags([meal.strCategory, meal.strArea, ...(meal.strTags?.split(",") ?? []), ...ingredientTags]),
    source: "themealdb",
    external_id: meal.idMeal ?? name,
    ingredients: ingredientListToText(ingredients),
    instructions: meal.strInstructions ?? null,
  };
}

async function readThemealDbRows(limit: number): Promise<FoodInsert[]> {
  const rows: FoodInsert[] = [];
  const seen = new Set<string>();

  for (let attempt = 0; rows.length < limit && attempt < limit * 4; attempt += 1) {
    const payload = await fetchJsonWithRetry<{ meals?: MealDbMeal[] | null }>("https://www.themealdb.com/api/json/v1/1/random.php", {
      headers: { "User-Agent": "FoodMatch/0.1 meal seed script" },
    }, "TheMealDB");

    const row = payload.meals?.[0] ? mealDbMealToRow(payload.meals[0]) : null;
    if (row && row.external_id && !seen.has(row.external_id)) {
      seen.add(row.external_id);
      rows.push(row);
    }

    await sleep(350);
  }

  return rows;
}

async function readThemealDbIngredients(limit: number): Promise<FoodInsert[]> {
  const payload = await fetchJsonWithRetry<{ meals?: MealDbIngredient[] | null }>(
    "https://www.themealdb.com/api/json/v1/1/list.php?i=list",
    { headers: { "User-Agent": "FoodMatch/0.1 ingredient seed script" } },
    "TheMealDB ingredients",
  );

  return (payload.meals ?? [])
    .filter((ingredient) => ingredient.strIngredient?.trim())
    .slice(0, limit)
    .map((ingredient) => {
      const sourceName = ingredient.strIngredient!.trim();
      const displayName = displayIngredientName(sourceName);
      const normalized = normalizeTag(cleanIngredientName(sourceName));
      return {
        name: displayName,
        image_url: `https://www.themealdb.com/images/ingredients/${encodeURIComponent(sourceName)}.png`,
        food_type: "ingredient",
        meal_type: null,
        tags: compactTags([normalized, ingredient.strType ?? undefined]),
        source: "themealdb-ingredient-list",
        external_id: ingredient.idIngredient ?? normalized,
        ingredients: null,
        instructions: null,
      };
    });
}

async function readThemealDbMeals(limit: number): Promise<FoodInsert[]> {
  const rows: FoodInsert[] = [];
  const seen = new Set<string>();

  for (const letter of mealDbLetters) {
    if (rows.length >= limit) break;
    const payload = await fetchJsonWithRetry<{ meals?: MealDbMeal[] | null }>(
      `https://www.themealdb.com/api/json/v1/1/search.php?f=${letter}`,
      { headers: { "User-Agent": "FoodMatch/0.1 meal list seed script" } },
      "TheMealDB meal search",
    );

    for (const meal of payload.meals ?? []) {
      if (rows.length >= limit) break;
      const row = mealDbMealToRow(meal);
      if (!row || !row.external_id || seen.has(row.external_id)) continue;
      seen.add(row.external_id);
      row.source = "themealdb-meal-list";
      rows.push(row);
    }

    await sleep(250);
  }

  return rows;
}

async function insertRows(rows: FoodInsert[], batchSize: number) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
  }

  const schemaProbe = await fetch(`${supabaseUrl}/rest/v1/foods?select=source&limit=1`, {
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
    },
  });
  const supportsImportColumns = schemaProbe.ok;
  if (!supportsImportColumns) {
    console.warn("Supabase foods import columns are missing; inserting legacy food rows without source/ingredients.");
  }

  let insertableRows = rows;
  if (supportsImportColumns) {
    const existingResponse = await fetch(`${supabaseUrl}/rest/v1/foods?select=source,external_id&source=not.is.null&external_id=not.is.null&limit=20000`, {
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${supabaseAnonKey}`,
      },
    });

    if (!existingResponse.ok) {
      const body = await existingResponse.text();
      throw new Error(`Supabase duplicate check failed: ${existingResponse.status} ${body}`);
    }

    const existingRows = (await existingResponse.json()) as Array<{ source: string | null; external_id: string | null }>;
    const seenKeys = new Set(
      existingRows
        .filter((row) => row.source && row.external_id)
        .map((row) => `${row.source}:${row.external_id}`),
    );
    const skippedDuplicates: FoodInsert[] = [];

    insertableRows = rows.filter((row) => {
      if (!row.source || !row.external_id) return true;
      const key = `${row.source}:${row.external_id}`;
      if (seenKeys.has(key)) {
        skippedDuplicates.push(row);
        return false;
      }
      seenKeys.add(key);
      return true;
    });

    if (skippedDuplicates.length > 0) {
      console.log(`Skipped ${skippedDuplicates.length} duplicate foods already present in Supabase or this seed batch.`);
    }
  }

  if (insertableRows.length === 0) {
    console.log("No new foods to insert.");
    return;
  }

  for (let index = 0; index < insertableRows.length; index += batchSize) {
    const batch = insertableRows.slice(index, index + batchSize);
    const payload = supportsImportColumns
      ? batch
      : batch.map(({ name, image_url, food_type, meal_type, tags }) => ({
          name,
          image_url,
          food_type,
          meal_type,
          tags,
        }));
    const endpoint = `${supabaseUrl}/rest/v1/foods`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        authorization: `Bearer ${supabaseAnonKey}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase insert failed: ${response.status} ${body}`);
    }

    console.log(`Inserted batch ${Math.floor(index / batchSize) + 1}: ${batch.length} rows`);
  }
}

async function main() {
  const source = (process.env.SEED_SOURCE ?? "json") as SeedSource;
  const limit = parsePositiveInt(process.env.SEED_LIMIT, 100);
  const batchSize = parsePositiveInt(process.env.SEED_BATCH_SIZE, 100);
  const translateEnabled = process.env.SEED_TRANSLATE !== "false";
  const translateTags = process.env.SEED_TRANSLATE_TAGS === "true";
  const dryRun = process.env.SEED_DRY_RUN === "true";
  const sourcePath = process.env.SEED_SOURCE_PATH ?? "scripts/source-foods.sample.json";
  const extractIngredients = process.env.SEED_EXTRACT_INGREDIENTS === "true";
  const ingredientLimit = parsePositiveInt(process.env.SEED_INGREDIENT_LIMIT, Math.min(limit, 250));

  let rows: FoodInsert[];
  if (source === "recipe-dataset") {
    rows = await readRecipeDatasetRows(process.env.SEED_SOURCE_URL ?? recipeDatasetUrl, limit);
  } else if (source === "openfoodfacts") {
    const terms = (process.env.OFF_SEARCH_TERMS ?? "pasta,pizza,chicken,yogurt,cheese")
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
    const categoryTags = (process.env.OFF_CATEGORY_TAGS ?? "meals")
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
    rows = await readOpenFoodFactsRows(terms, categoryTags, limit);
  } else if (source === "themealdb") {
    rows = await readThemealDbRows(limit);
  } else if (source === "themealdb-ingredients") {
    rows = await readThemealDbIngredients(limit);
  } else if (source === "themealdb-meals") {
    rows = await readThemealDbMeals(limit);
  } else if (source === "json") {
    rows = await readJsonRows(sourcePath, limit);
  } else {
    throw new Error(`Unsupported SEED_SOURCE: ${source}`);
  }

  if (extractIngredients) {
    rows = [...rows, ...ingredientRowsFrom(rows, ingredientLimit)];
  }

  const translatedRows: FoodInsert[] = [];
  for (const row of rows) {
    translatedRows.push(await translateRow(row, translateEnabled, translateTags));
  }

  if (dryRun) {
    console.log(JSON.stringify(translatedRows.slice(0, 3), null, 2));
    console.log(`Dry run parsed ${translatedRows.length} foods from ${source}.`);
    return;
  }

  await insertRows(translatedRows, batchSize);
  console.log(`Seeded ${translatedRows.length} parsed foods from ${source}.`);
}

void main();
