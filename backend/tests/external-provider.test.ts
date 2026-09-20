import { describe, it, expect, vi, afterEach } from "vitest";
import { ExternalProvider } from "@/lib/providers/external";

function mockFetch(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

describe("ExternalProvider", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends correct request to provider", async () => {
    const fetchMock = mockFetch({
      success: true,
      data: {
        type: "REEL",
        media: [{ url: "https://cdn.example.com/video.mp4", type: "video" }],
      },
    });
    global.fetch = fetchMock;

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await provider.resolve("https://www.instagram.com/reel/Cxyz123/");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/resolve",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-key",
        }),
        body: JSON.stringify({
          url: "https://www.instagram.com/reel/Cxyz123/",
        }),
      })
    );
  });

  it("normalizes reel response", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "reel",
        caption: "Test reel caption",
        author: { username: "testuser", display_name: "Test User" },
        thumbnail: "https://cdn.example.com/thumb.jpg",
        media: [
          {
            url: "https://cdn.example.com/video.mp4",
            type: "video",
            width: 1080,
            height: 1920,
            duration: 15,
            format: "mp4",
          },
        ],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    const result = await provider.resolve(
      "https://www.instagram.com/reel/Cxyz123/"
    );

    expect(result.type).toBe("REEL");
    expect(result.title).toBe("Test reel caption");
    expect(result.author?.username).toBe("testuser");
    expect(result.author?.displayName).toBe("Test User");
    expect(result.thumbnail).toBe("https://cdn.example.com/thumb.jpg");
    expect(result.media).toHaveLength(1);
    expect(result.media[0].url).toBe("https://cdn.example.com/video.mp4");
    expect(result.media[0].type).toBe("video");
    expect(result.media[0].width).toBe(1080);
    expect(result.media[0].height).toBe(1920);
    expect(result.media[0].duration).toBe(15);
    expect(result.media[0].format).toBe("mp4");
  });

  it("normalizes carousel response with multiple items", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [
          { url: "https://cdn.example.com/1.jpg", type: "image" },
          { url: "https://cdn.example.com/2.jpg", type: "image" },
          { url: "https://cdn.example.com/3.jpg", type: "image" },
        ],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    const result = await provider.resolve(
      "https://www.instagram.com/p/Cxyz123/"
    );

    expect(result.type).toBe("POST");
    expect(result.media).toHaveLength(3);
    expect(result.media[0].type).toBe("image");
    expect(result.media[1].type).toBe("image");
    expect(result.media[2].type).toBe("image");
  });

  it("rejects unsafe media URLs (localhost)", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [{ url: "http://localhost:3000/secret", type: "image" }],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("rejects unsafe media URLs (private IP)", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [{ url: "http://192.168.1.1/secret", type: "image" }],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("rejects unsafe media URLs (link-local)", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [{ url: "http://169.254.169.254/metadata", type: "image" }],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("rejects unsafe media URLs (cloud metadata)", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [{ url: "http://metadata.google.internal/computeMetadata/v1", type: "image" }],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("rejects javascript: media URLs", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [{ url: "javascript:alert(1)", type: "image" }],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("handles provider 401/403", async () => {
    global.fetch = mockFetch({ error: "unauthorized" }, 401);

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "bad-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("handles provider 429", async () => {
    global.fetch = mockFetch({ error: "rate limited" }, 429);

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("handles provider 404", async () => {
    global.fetch = mockFetch({ error: "not found" }, 404);

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("handles malformed JSON response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error("invalid json")),
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("handles empty media array", async () => {
    global.fetch = mockFetch({
      success: true,
      data: { type: "POST", media: [] },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("handles provider timeout", async () => {
    global.fetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new DOMException("Aborted", "AbortError")),
            50
          );
        })
    );

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    await expect(
      provider.resolve("https://www.instagram.com/p/Cxyz123/")
    ).rejects.toThrow();
  });

  it("filters out items with missing URLs", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [
          { url: "https://cdn.example.com/1.jpg", type: "image" },
          { url: "", type: "image" },
          { type: "image" },
        ],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    const result = await provider.resolve(
      "https://www.instagram.com/p/Cxyz123/"
    );
    expect(result.media).toHaveLength(1);
  });

  it("handles missing author gracefully", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [{ url: "https://cdn.example.com/1.jpg", type: "image" }],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    const result = await provider.resolve(
      "https://www.instagram.com/p/Cxyz123/"
    );
    expect(result.author).toBeNull();
  });

  it("handles missing optional fields", async () => {
    global.fetch = mockFetch({
      success: true,
      data: {
        type: "POST",
        media: [{ url: "https://cdn.example.com/1.jpg" }],
      },
    });

    const provider = new ExternalProvider(
      "https://api.example.com/resolve",
      "test-key"
    );
    const result = await provider.resolve(
      "https://www.instagram.com/p/Cxyz123/"
    );
    expect(result.media[0].width).toBeNull();
    expect(result.media[0].height).toBeNull();
    expect(result.media[0].duration).toBeNull();
    expect(result.media[0].format).toBeNull();
    expect(result.media[0].thumbnail).toBeNull();
  });
});
