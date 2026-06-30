// Curated onboarding GIFs.
//
// Maps the pure script's OnboardingGifId tokens (domain/onboarding/script.ts) to
// concrete Klipy-hosted MessageGif attachments. Kept out of the pure engine so
// that module stays URL-free and unit-testable. These are fixed Klipy CDN assets
// (not live-pulled) so the scripted onboarding is deterministic and works the
// same every run; they're rendered through MessageGifAttachments, which bakes in
// the required KLIPY watermark + "Powered by Klipy" attribution.
//
// Dimensions are intentionally omitted: fitAttachment falls back to a tidy
// square box (ATTACHMENT_FALLBACK) when a GIF carries no intrinsic size, which is
// exactly what we want for these reaction gifs.

import type { MessageGif } from "@/domain/gifs";
import type { OnboardingGifId } from "@/domain/onboarding/script";

function klipyGif(id: string, url: string): MessageGif {
  return {
    id,
    source: "klipy-gif",
    url,
    // Onboarding only displays the gif (the bot isn't really decoding frames),
    // so the still/frame sources just reuse the animated asset.
    previewUrl: url,
    frameSourceUrl: url,
    attribution: "Powered by Klipy",
    gifId: id,
  };
}

const ONBOARDING_GIFS: Record<OnboardingGifId, MessageGif> = {
  hello: klipyGif(
    "onboarding-hello",
    "https://static2.klipy.com/ii/da290b156d64898341638f3c299e7478/e4/07/GqHupES0.gif",
  ),
  excited: klipyGif(
    "onboarding-excited",
    "https://static2.klipy.com/ii/a15b48460c436e1e92c85ffc680932cc/ef/86/U3L6Lhlw.gif",
  ),
  // A smiling, happy dog — warm reaction for the moment the user shares their name.
  happy: klipyGif(
    "onboarding-happy",
    "https://static2.klipy.com/ii/935d7ab9d8c6202580a668421940ec81/92/d3/BokRn2wb.gif",
  ),
};

export function onboardingGif(id: OnboardingGifId): MessageGif {
  return ONBOARDING_GIFS[id];
}
