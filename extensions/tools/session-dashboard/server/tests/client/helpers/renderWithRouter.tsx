// tests/client/helpers/renderWithRouter.tsx
import type { ReactElement } from "react";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";

/**
 * Minimal render helper. The app uses hash routing, which works fine in
 * happy-dom without any provider — we just render the element as-is.
 */
export function renderWithRouter(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  return render(ui, options);
}
