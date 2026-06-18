## FoodMatch MVP

FoodMatch is a Duolingo-style swipe app for choosing food together.

### Stack

- Next.js (App Router)
- Tailwind CSS + shadcn/ui
- Supabase (Postgres + Realtime)

### Quick start

1. Install dependencies:

```bash
npm install
```

2. Create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
ADMIN_PASSWORD=choose_a_strong_password
ADMIN_SESSION_SECRET=choose_a_long_random_secret
ADMIN_HOST=admin.foodmatch.food
```

3. Run SQL schema from `supabase/schema.sql` in Supabase SQL Editor. If room creation fails with an RLS/policy error, rerun the latest schema so the anon policies are applied.

4. Seed foods (optional starter data):

```bash
npm run seed
```

Import recipe cards from `josephrmartinez/recipe-dataset`:

```bash
SEED_LIMIT=250 npm run seed:recipes
```

Import random recipes from TheMealDB:

```bash
SEED_LIMIT=50 npm run seed:themealdb
```

Import meal cards from Open Food Facts:

```bash
OFF_CATEGORY_TAGS="meals" SEED_LIMIT=100 npm run seed:products
```

5. Start app:

```bash
npm run dev
```

### Admin panel

The admin editor is served on `ADMIN_HOST` (for production, point `admin.foodmatch.food` or your chosen admin subdomain at the same Vercel project). Direct `/admin` access on the regular production host redirects home.

Required server-only env:

- `SUPABASE_SERVICE_ROLE_KEY` for server-side food updates.
- `ADMIN_PASSWORD` for login.
- `ADMIN_SESSION_SECRET` for signed admin cookies.

Locally, `/admin` remains available on `localhost` for development.

### Seed script details

- Script path: `scripts/seed.ts`
- Source file: `scripts/source-foods.sample.json`
- Translation: `google-translate-api-next` for `name` and `tags`; set `SEED_TRANSLATE=false` to keep source text.
- Includes 500ms delay between translation requests for basic rate limiting
- Recipe source: `josephrmartinez/recipe-dataset` CSV with `Title`, `Ingredients`, and `Instructions`.
- Recipe source: TheMealDB `random.php`.
- Meal/product source: Open Food Facts API v2 search with `OFF_CATEGORY_TAGS=meals` by default.
- Ingredient cards: set `SEED_EXTRACT_INGREDIENTS=true` to create additional `ingredient` cards from parsed recipe/product tags.
- Check source reuse terms before shipping imported data or images.

To use your own dataset, set `SEED_SOURCE_PATH`:

```bash
SEED_SOURCE_PATH=./path/to/foods.json SEED_LIMIT=100 npm run seed
```
