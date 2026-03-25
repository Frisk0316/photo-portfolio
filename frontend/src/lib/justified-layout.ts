export interface PhotoInput {
  id: string | number;
  aspectRatio: number;
  [key: string]: unknown;
}

export interface LayoutItem extends PhotoInput {
  displayWidth: number;
  displayHeight: number;
}

export function computeJustifiedLayout(
  photos: PhotoInput[],
  containerWidth: number,
  targetRowHeight: number = 280,
  spacing: number = 6
): LayoutItem[][] {
  if (!photos.length || containerWidth <= 0) return [];

  const rows: LayoutItem[][] = [];
  let currentRow: PhotoInput[] = [];
  let currentRowWidth = 0;

  const getScaledWidth = (photo: PhotoInput) =>
    Math.max(photo.aspectRatio * targetRowHeight, 20);

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    const scaledWidth = getScaledWidth(photo);
    currentRow.push(photo);
    currentRowWidth += scaledWidth;

    const totalSpacing = spacing * (currentRow.length - 1);
    const availableWidth = containerWidth - totalSpacing;

    const isLastPhoto = i === photos.length - 1;

    if (currentRowWidth >= availableWidth || isLastPhoto) {
      const isLastRow = isLastPhoto && currentRowWidth < availableWidth;

      let rowHeight: number;
      if (isLastRow) {
        rowHeight = targetRowHeight;
      } else {
        const ratio = availableWidth / currentRowWidth;
        rowHeight = Math.round(targetRowHeight * ratio);
      }

      const rowItems: LayoutItem[] = currentRow.map((p) => {
        const sw = getScaledWidth(p);
        const ratio = isLastRow ? 1 : availableWidth / currentRowWidth;
        return {
          ...p,
          displayWidth: Math.round(sw * ratio),
          displayHeight: rowHeight,
        };
      });

      rows.push(rowItems);
      currentRow = [];
      currentRowWidth = 0;
    }
  }

  return rows;
}
