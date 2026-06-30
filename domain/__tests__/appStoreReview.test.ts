const mockCanOpenURL = jest.fn();
const mockOpenURL = jest.fn();

jest.mock("react-native", () => ({
  Linking: {
    canOpenURL: (...args: unknown[]) => mockCanOpenURL(...args),
    openURL: (...args: unknown[]) => mockOpenURL(...args),
  },
}));

import {
  MEME_CHAT_APP_STORE_REVIEW_URL,
  MEME_CHAT_APP_STORE_URL,
  openAppStoreReview,
} from "../appStoreReview";

describe("openAppStoreReview", () => {
  beforeEach(() => {
    mockOpenURL.mockResolvedValue(undefined);
  });

  it("opens the write-review deep link when it's supported", async () => {
    mockCanOpenURL.mockResolvedValue(true);
    await openAppStoreReview();
    expect(mockOpenURL).toHaveBeenCalledWith(MEME_CHAT_APP_STORE_REVIEW_URL);
  });

  it("falls back to the store listing when the review link isn't supported", async () => {
    mockCanOpenURL.mockImplementation(async (url: string) => url === MEME_CHAT_APP_STORE_URL);
    await openAppStoreReview();
    expect(mockOpenURL).toHaveBeenCalledWith(MEME_CHAT_APP_STORE_URL);
    expect(mockOpenURL).not.toHaveBeenCalledWith(MEME_CHAT_APP_STORE_REVIEW_URL);
  });

  it("opens nothing when neither URL is supported", async () => {
    mockCanOpenURL.mockResolvedValue(false);
    await openAppStoreReview();
    expect(mockOpenURL).not.toHaveBeenCalled();
  });
});
