export type SupersetMovement = {
  key: string;
  supersetKey: string | null;
};

export function applySupersetSelection<T extends SupersetMovement>(
  movements: T[],
  anchorKey: string,
  partnerKeys: Iterable<string>,
  newGroupKey: string,
): T[] {
  const anchor = movements.find((movement) => movement.key === anchorKey);
  if (!anchor) return movements;

  const availableKeys = new Set(movements.map((movement) => movement.key));
  const selectedKeys = new Set(
    [...partnerKeys].filter((key) => key !== anchorKey && availableKeys.has(key)),
  );
  if (selectedKeys.size === 0) return movements;

  const previousGroupKey = anchor.supersetKey;
  const groupKey = previousGroupKey ?? newGroupKey;

  return movements.map((movement) => {
    let supersetKey = movement.supersetKey;
    if (movement.key === anchorKey || selectedKeys.has(movement.key)) {
      supersetKey = groupKey;
    } else if (previousGroupKey && movement.supersetKey === previousGroupKey) {
      supersetKey = null;
    }

    return supersetKey === movement.supersetKey ? movement : { ...movement, supersetKey };
  });
}

export function clearSuperset<T extends SupersetMovement>(movements: T[], anchorKey: string): T[] {
  const groupKey = movements.find((movement) => movement.key === anchorKey)?.supersetKey;
  if (!groupKey) return movements;

  return movements.map((movement) =>
    movement.supersetKey === groupKey ? { ...movement, supersetKey: null } : movement,
  );
}
