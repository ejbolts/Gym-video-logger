// A conventional stored-body-fat energy comparison, not a weight-loss prediction.
// https://pubmed.ncbi.nlm.nih.gov/17848938/
export const KCAL_PER_KG_FAT_EQUIVALENT = 7700;

export function fatEnergyEquivalent(calories: number): string {
  const grams = (calories / KCAL_PER_KG_FAT_EQUIVALENT) * 1000;
  if (grams > 0 && grams < 1) return '<1 g';
  if (grams < 1000) return `${Math.round(grams).toLocaleString()} g`;
  return `${(grams / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} kg`;
}

export function parseCardioCalories(value: string): number | null {
  if (value.trim() === '') return null;
  const calories = Number(value);
  if (!Number.isInteger(calories) || calories < 0 || calories > 100_000) {
    throw new Error('Enter whole calories between 0 and 100,000, or leave blank.');
  }
  return calories;
}
