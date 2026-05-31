export type RewardedAdResult = {
  rewardEarned: boolean;
  placeholder: boolean;
};

export async function showRewardedInsightAd(): Promise<RewardedAdResult> {
  return {
    rewardEarned: __DEV__,
    placeholder: true,
  };
}
