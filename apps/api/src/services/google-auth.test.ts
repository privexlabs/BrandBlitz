import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redisSet: vi.fn(),
  redisGet: vi.fn(),
  redisDel: vi.fn(),
}));

vi.mock("../lib/redis", () => ({
  redis: {
    set: mocks.redisSet,
    get: mocks.redisGet,
    del: mocks.redisDel,
  },
}));

import {
  createCodeChallenge,
  createGooglePkceAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  verifyGoogleIdToken,
} from "./google-auth";

describe("google-auth PKCE", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates an S256 authorization URL and stores a short-lived verifier in Redis", async () => {
    mocks.redisSet.mockResolvedValue("OK");

    const challenge = await createGooglePkceAuthorizationUrl("/dashboard");
    const url = new URL(challenge.authorizationUrl);
    const stored = JSON.parse(mocks.redisSet.mock.calls[0][1]);

    expect(challenge.codeChallengeMethod).toBe("S256");
    expect(stored.codeVerifier).toHaveLength(43);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe(createCodeChallenge(stored.codeVerifier));
    expect(url.searchParams.get("state")).toBe(challenge.state);
    expect(mocks.redisSet).toHaveBeenCalledWith(
      `oauth:google:pkce:${challenge.state}`,
      expect.any(String),
      "EX",
      300,
      "NX"
    );
  });

  it("retrieves the verifier by state and sends it during token exchange", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id_token: "google-id-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: "google-123",
          email: "player@example.com",
          aud: "test-google-client-id",
          email_verified: "true",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    mocks.redisGet.mockResolvedValue(JSON.stringify({ codeVerifier: "a".repeat(43) }));
    mocks.redisDel.mockResolvedValue(1);

    const profile = await exchangeGoogleAuthorizationCode({
      code: "auth-code",
      state: "state-123",
    });

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("a".repeat(43));
    expect(mocks.redisGet).toHaveBeenCalledWith("oauth:google:pkce:state-123");
    expect(mocks.redisDel).toHaveBeenCalledWith("oauth:google:pkce:state-123");
    expect(profile.googleId).toBe("google-123");
  });

  it("rejects an expired or missing PKCE state before calling Google", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    mocks.redisGet.mockResolvedValue(null);

    await expect(
      exchangeGoogleAuthorizationCode({
        code: "auth-code",
        state: "expired-state",
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_OAUTH_STATE",
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.redisDel).not.toHaveBeenCalled();
  });

  it("deletes the PKCE state before exchanging the Google authorization code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id_token: "google-id-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sub: "google-123",
          email: "player@example.com",
          aud: "test-google-client-id",
          email_verified: "true",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);
    mocks.redisGet.mockResolvedValue(JSON.stringify({ codeVerifier: "b".repeat(43) }));
    mocks.redisDel.mockResolvedValue(1);

    await exchangeGoogleAuthorizationCode({
      code: "auth-code",
      state: "state-123",
    });

    expect(mocks.redisDel.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0]
    );
  });

  it("rejects a failed Google token exchange response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "invalid_grant" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.redisGet.mockResolvedValue(JSON.stringify({ codeVerifier: "c".repeat(43) }));
    mocks.redisDel.mockResolvedValue(1);

    await expect(
      exchangeGoogleAuthorizationCode({
        code: "bad-code",
        state: "state-123",
      })
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_GOOGLE_CODE",
    });
  });
});

describe("verifyGoogleIdToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a verified Google profile for a valid tokeninfo response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sub: "google-123",
        email: "player@example.com",
        aud: "test-google-client-id",
        email_verified: "true",
        name: "Player One",
        picture: "https://example.com/avatar.png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const profile = await verifyGoogleIdToken("valid-id-token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/tokeninfo?id_token=valid-id-token"
    );
    expect(profile).toEqual({
      googleId: "google-123",
      email: "player@example.com",
      name: "Player One",
      avatarUrl: "https://example.com/avatar.png",
    });
  });

  it("rejects a tokeninfo response with the wrong audience", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: "google-123",
          email: "player@example.com",
          aud: "another-client-id",
          email_verified: "true",
        }),
      })
    );

    await expect(verifyGoogleIdToken("wrong-audience-token")).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_GOOGLE_TOKEN",
    });
  });

  it("rejects a tokeninfo response with an unverified email", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sub: "google-123",
          email: "player@example.com",
          aud: "test-google-client-id",
          email_verified: "false",
        }),
      })
    );

    await expect(verifyGoogleIdToken("unverified-email-token")).rejects.toMatchObject({
      statusCode: 401,
      code: "UNVERIFIED_GOOGLE_EMAIL",
    });
  });

  it("rejects a non-OK tokeninfo response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "invalid_token" }),
      })
    );

    await expect(verifyGoogleIdToken("bad-id-token")).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_GOOGLE_TOKEN",
    });
  });
});
