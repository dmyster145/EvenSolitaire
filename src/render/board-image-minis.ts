/**
 * G2-safe minimap renderers.
 * Reuses the existing rich 576×144 top/tableau art renderers and scales them down to 200×50.
 */
import { IMAGE_TOP_MINI, IMAGE_TABLEAU_MINI } from "./layout";
import { renderBoardTop, type TopRowViewModel } from "./board-image-top";
import { renderBoardTableau, type TableauRowViewModel } from "./board-image-tableau";
import { scalePngBytes } from "./png-utils";

export async function renderBoardTopMini(view: TopRowViewModel): Promise<number[]> {
  const png = await renderBoardTop(view);
  return await scalePngBytes(png, IMAGE_TOP_MINI.width, IMAGE_TOP_MINI.height);
}

export async function renderBoardTableauMini(view: TableauRowViewModel): Promise<number[]> {
  const png = await renderBoardTableau(view);
  return await scalePngBytes(png, IMAGE_TABLEAU_MINI.width, IMAGE_TABLEAU_MINI.height);
}
