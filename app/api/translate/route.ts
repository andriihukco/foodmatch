import translate from "google-translate-api-next";

type TranslateRequest = {
  name?: string | null;
  ingredients?: string | null;
  instructions?: string | null;
};

const maxTextLength = 6000;

type TranslateResult = string | {
  text?: string;
};

async function translateText(text: string | null | undefined) {
  const value = text?.trim();
  if (!value) return null;

  const clipped = value.slice(0, maxTextLength);
  const result = await (translate as unknown as (input: string, options: { to: string }) => Promise<TranslateResult>)(
    clipped,
    { to: "uk" },
  );

  if (typeof result === "string") return result || clipped;
  return result.text || clipped;
}

export async function POST(request: Request) {
  let payload: TranslateRequest;

  try {
    payload = (await request.json()) as TranslateRequest;
  } catch {
    return Response.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const [name, ingredients, instructions] = await Promise.all([
      translateText(payload.name),
      translateText(payload.ingredients),
      translateText(payload.instructions),
    ]);

    return Response.json({ name, ingredients, instructions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Translation failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
