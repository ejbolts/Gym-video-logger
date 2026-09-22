export const DEFAULT_CHART_WIDTH = 340;
export const DEFAULT_CHART_HEIGHT = 190;

export function responsiveChartWidth(
  renderedWidth: number,
  renderedHeight: number,
  minimumWidth = DEFAULT_CHART_WIDTH,
  viewBoxHeight = DEFAULT_CHART_HEIGHT,
): number {
  if (renderedWidth <= 0 || renderedHeight <= 0) return minimumWidth;
  return Math.max(minimumWidth, Math.round((renderedWidth / renderedHeight) * viewBoxHeight));
}

export function evenlySpacedChartIndexes(pointCount: number, tickCount: number): number[] {
  if (pointCount <= 0 || tickCount <= 0) return [];
  if (pointCount === 1 || tickCount === 1) return [0];

  const visibleTickCount = Math.min(pointCount, tickCount);
  return [
    ...new Set(
      Array.from({ length: visibleTickCount }, (_, index) =>
        Math.round((index / (visibleTickCount - 1)) * (pointCount - 1)),
      ),
    ),
  ];
}
