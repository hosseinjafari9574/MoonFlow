import { MOON_TEXTURE_URL } from "@/components/focus/geometry";

/**
 * The moon's surface is a 158 KB photograph, and Focus Mode is opened by a
 * click — not by a navigation — so without this the first frame of the room
 * would paint a bare token-coloured disc and the texture would land a moment
 * later, in the middle of the arrival.
 *
 * It is warmed from the card instead: after the page has settled, once, off the
 * critical path. By the time anyone presses "Enter focus mode" the bytes are
 * decoded and the disc's first paint is already the moon. The promise is
 * swallowed on purpose: a failed fetch is a missing texture, not a broken app,
 * and the disc's own background is the same token it has always been.
 */
let warmed = false;

export function warmMoonTexture() {
  if (warmed || typeof window === "undefined") return;
  warmed = true;
  const image = new Image();
  image.decoding = "async";
  image.src = MOON_TEXTURE_URL;
  void image.decode().catch(() => {
    /* The disc falls back to `--moon-dark`; nothing else depends on this. */
  });
}
