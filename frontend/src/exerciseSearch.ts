function searchTokens(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

interface FuzzyMatch {
  indices: number[];
  score: number;
}

function isWordCharacter(character: string | undefined): boolean {
  return Boolean(character && /[\p{L}\p{N}]/u.test(character));
}

function bestFuzzyMatch(value: string, query: string): FuzzyMatch | null {
  const source = value.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return { indices: [], score: 0 };

  let bestDirect: FuzzyMatch | null = null;
  for (
    let directStart = source.indexOf(needle);
    directStart >= 0;
    directStart = source.indexOf(needle, directStart + 1)
  ) {
    const directEnd = directStart + needle.length;
    const startsWord = !isWordCharacter(source[directStart - 1]);
    const endsWord = !isWordCharacter(source[directEnd]);
    const quality = startsWord && endsWord ? 0 : startsWord ? 12 : 28;
    const candidate = {
      indices: Array.from({ length: needle.length }, (_, index) => directStart + index),
      score: quality + directStart * 0.01,
    };
    if (bestDirect === null || candidate.score < bestDirect.score) bestDirect = candidate;
  }
  if (bestDirect) return bestDirect;

  let bestSubsequence: FuzzyMatch | null = null;
  for (
    let firstIndex = source.indexOf(needle[0]);
    firstIndex >= 0;
    firstIndex = source.indexOf(needle[0], firstIndex + 1)
  ) {
    const indices = [firstIndex];
    let sourceIndex = firstIndex + 1;
    for (const character of needle.slice(1)) {
      const matchIndex = source.indexOf(character, sourceIndex);
      if (matchIndex < 0) {
        indices.length = 0;
        break;
      }
      indices.push(matchIndex);
      sourceIndex = matchIndex + 1;
    }
    if (!indices.length) continue;
    const span = indices[indices.length - 1] - indices[0] + 1;
    const skippedCharacters = span - needle.length;
    const wordInitialCount = indices.filter((index) => !isWordCharacter(source[index - 1])).length;
    const candidate = {
      indices,
      score: 100 + skippedCharacters * 9 - wordInitialCount * 4 + firstIndex * 0.01,
    };
    if (bestSubsequence === null || candidate.score < bestSubsequence.score) {
      bestSubsequence = candidate;
    }
  }
  return bestSubsequence;
}

export function fuzzyMatchIndices(value: string, query: string): number[] | null {
  return bestFuzzyMatch(value, query)?.indices ?? null;
}

export function fuzzyScoreFields(values: string[], query: string): number | null {
  let score = 0;
  for (const token of searchTokens(query)) {
    const fieldScores = values.flatMap((value, fieldIndex) => {
      const match = bestFuzzyMatch(value, token);
      return match ? [match.score + fieldIndex * 8] : [];
    });
    if (!fieldScores.length) return null;
    score += Math.min(...fieldScores);
  }
  return score;
}

export function fuzzyMatchesFields(values: string[], query: string): boolean {
  return fuzzyScoreFields(values, query) !== null;
}

export function fuzzyHighlightIndices(value: string, query: string): number[] {
  const matches = new Set<number>();
  searchTokens(query).forEach((token) => {
    fuzzyMatchIndices(value, token)?.forEach((index) => matches.add(index));
  });
  return [...matches].sort((first, second) => first - second);
}
