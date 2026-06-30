export type InterstitialAdResult = {
  shown: boolean;
  placeholder: boolean;
};

export async function showInterstitialAd(): Promise<InterstitialAdResult> {
  return {
    shown: false,
    placeholder: true,
  };
}
