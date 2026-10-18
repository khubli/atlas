// Rename a place where you notice it (an itinerary stop, a map pin), in place:
// the name turns into a text field; Enter or leaving it saves, Escape cancels.

import { mutate } from "../data/client.js";
import { toast } from "./util.js";

export function renameInline(target, placeId, current) {
  const input = document.createElement("input");
  input.className = "inline-edit";
  input.value = current || "";
  input.placeholder = "Name this place";
  input.setAttribute("aria-label", "Place name");
  target.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (!save || !name || name === current) {
      input.replaceWith(target);
      return;
    }
    await mutate("setLabel", placeId, { name });
    toast(`Renamed to "${name}"`, "ok");
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/** Wire every [data-rename] button inside root: data-rename = place ID, data-current = shown name. */
export function wireRename(root) {
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rename]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    const target = b.closest("[data-rename-target]") || b;
    renameInline(target, b.dataset.rename, b.dataset.current);
  }, true); // capture: Leaflet popups stop clicks from bubbling
}
