import { load, save } from "./helpers.js";
export function start(handler: () => void) {
  load();
  save();
  handler();
}
