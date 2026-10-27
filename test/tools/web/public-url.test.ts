import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublic } from "../../../extensions/tools/web/public-url.ts";

const lookup = vi.hoisted(() => vi.fn());

vi.mock("node:dns", () => ({
	promises: { lookup },
}));

const fetchMock = vi.fn<() => Promise<Response>>();

function okResponse(body = "ok"): Response {
	return new Response(body, { status: 200 });
}

function redirectResponse(location: string): Response {
	return new Response(null, { status: 302, headers: { location } });
}

describe("fetchPublic", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("rejects non-HTTP protocols", async () => {
		await expect(fetchPublic("file:///etc/passwd", {})).rejects.toThrow("HTTP or HTTPS");
		await expect(fetchPublic("ftp://example.com/file", {})).rejects.toThrow("HTTP or HTTPS");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("rejects localhost-style hostnames", async () => {
		for (const url of [
			"http://localhost/x",
			"http://api.localhost/x",
			"http://mine.local/x",
			"http://svc.internal/x",
		]) {
			await expect(fetchPublic(url, {})).rejects.toThrow("internal host");
		}
		expect(fetchMock).not.toHaveBeenCalled();
		expect(lookup).not.toHaveBeenCalled();
	});

	it("rejects literal private IPv4 addresses without DNS", async () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"0.0.0.0",
			"169.254.1.1",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"100.64.0.1",
		]) {
			await expect(fetchPublic(`http://${ip}/x`, {})).rejects.toThrow("internal host");
		}
		expect(fetchMock).not.toHaveBeenCalled();
		expect(lookup).not.toHaveBeenCalled();
	});

	it("rejects loopback, ULA, link-local, and mapped-private IPv6 addresses", async () => {
		for (const ip of ["::1", "::ffff:10.0.0.1", "fc00::1", "fe80::1"]) {
			await expect(fetchPublic(`http://[${ip}]/x`, {})).rejects.toThrow("internal host");
		}
		expect(fetchMock).not.toHaveBeenCalled();
		expect(lookup).not.toHaveBeenCalled();
	});

	it("allows public IP literals and fetches without DNS", async () => {
		fetchMock.mockResolvedValue(okResponse());
		lookup.mockRejectedValue(new Error("should not be called"));

		await expect(fetchPublic("http://8.8.8.8/x", {})).resolves.toBeInstanceOf(Response);
		await expect(fetchPublic("http://100.128.0.1/x", {})).resolves.toBeInstanceOf(Response);
		await expect(fetchPublic("http://[2606:4700:4700::1111]/x", {})).resolves.toBeInstanceOf(
			Response,
		);
		expect(lookup).not.toHaveBeenCalled();
	});

	it("rejects hostnames that resolve to a private address", async () => {
		lookup.mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.5", family: 4 },
		]);

		await expect(fetchPublic("http://evil.example.com/x", {})).rejects.toThrow(
			"resolves to an internal host",
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("treats DNS failure as allowed and proceeds to fetch", async () => {
		lookup.mockRejectedValue(new Error("ENOTFOUND"));
		fetchMock.mockResolvedValue(okResponse());

		await expect(fetchPublic("http://unreachable.example.com/x", {})).resolves.toBeInstanceOf(
			Response,
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("follows a 302 to a public URL", async () => {
		lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		fetchMock.mockResolvedValueOnce(redirectResponse("https://other.example.com/final"));
		fetchMock.mockResolvedValueOnce(okResponse("done"));

		const response = await fetchPublic("https://example.com/start", {});
		expect(await response.text()).toBe("done");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1]?.[0]).toBe("https://other.example.com/final");
	});

	it("resolves a relative Location against the current URL", async () => {
		lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		fetchMock.mockResolvedValueOnce(redirectResponse("/next"));
		fetchMock.mockResolvedValueOnce(okResponse());

		await fetchPublic("https://example.com/start", {});
		expect(fetchMock.mock.calls[1]?.[0]).toBe("https://example.com/next");
	});

	it("blocks a redirect to an internal host mid-flight", async () => {
		lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		fetchMock.mockResolvedValueOnce(redirectResponse("http://10.0.0.9/steal"));

		await expect(fetchPublic("https://example.com/start", {})).rejects.toThrow("internal host");
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("throws after more than 5 redirects", async () => {
		lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
		fetchMock.mockResolvedValue(redirectResponse("https://example.com/loop"));

		await expect(fetchPublic("https://example.com/start", {})).rejects.toThrow(
			"too many redirects",
		);
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});
});
