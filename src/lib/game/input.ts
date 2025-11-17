export interface PointerData {
  x: number;
  y: number;
}

export const computePointerFromEvent = (
  event: PointerEvent | MouseEvent | TouchEvent,
  canvas: HTMLCanvasElement
): PointerData | null => {
  const rect = canvas.getBoundingClientRect();

  if ("touches" in event) {
    const touch = event.touches[0];
    if (!touch) return null;
    return {
      x: touch.clientX - rect.left - canvas.width / 2,
      y: touch.clientY - rect.top - canvas.height / 2,
    };
  }

  if ("clientX" in event && "clientY" in event) {
    return {
      x: event.clientX - rect.left - canvas.width / 2,
      y: event.clientY - rect.top - canvas.height / 2,
    };
  }

  return null;
};

export const preventScrollOnTouch = (event: TouchEvent) => {
  event.preventDefault();
};
