export type FoodType = "recipe" | "ingredient" | "product" | "fastfood";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type SwipeAction = "like" | "dislike";

export interface Food {
  id: string;
  name: string;
  image_url: string | null;
  food_type: FoodType | null;
  meal_type: MealType | null;
  tags: string[];
  source: string | null;
  external_id: string | null;
  ingredients: string | null;
  instructions: string | null;
}

export interface Room {
  id: string;
  user_1_name: string;
  user_2_name: string | null;
  created_at: string;
}

export interface Swipe {
  id: number;
  room_id: string;
  user_name: string;
  food_id: string;
  action: SwipeAction;
  created_at: string;
}
