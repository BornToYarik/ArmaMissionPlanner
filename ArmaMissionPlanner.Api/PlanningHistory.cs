using System.Net;
using System.Text.Json.Nodes;

// Only the fixed public replay service can be contacted, never a URL from input.
// Local studio and development server share the same history functionality.
internal static class PlanningHistory
{
    private static readonly HttpClient Client = new(new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All })
    { BaseAddress = new Uri("https://wogreplay.ru/"), Timeout = TimeSpan.FromSeconds(90) };
    private static bool Local(HttpContext c) => c.Connection.RemoteIpAddress is { } ip && IPAddress.IsLoopback(ip)
        && c.Request.Host.Host is "127.0.0.1" or "localhost" or "[::1]"
        && (c.Request.Headers.Origin.Count == 0 || c.Request.Headers.Origin.ToString() == $"{c.Request.Scheme}://{c.Request.Host}");
    private static async Task<JsonNode> Read(string path, CancellationToken ct, string? viewer = null, bool post = false)
    {
        using var request = new HttpRequestMessage(post ? HttpMethod.Post : HttpMethod.Get, path);
        if (viewer != null) request.Headers.Add("X-Replay-Viewer", viewer);
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();
        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        return (await JsonNode.ParseAsync(stream, cancellationToken: ct)) ?? throw new InvalidDataException("Пустой ответ WOG Replay");
    }
    public static void Map(WebApplication app)
    {
        app.MapGet("/api/planning/replays", async (HttpContext c, string? world) =>
        {
            if (!Local(c)) return Results.NotFound();
            try
            {
                var data = await Read("api/catalog", c.RequestAborted);
                var all = data as JsonArray ?? data["missions"] as JsonArray ?? new JsonArray();
                var missions = all.Where(m => string.Equals(m?["world"]?.ToString(), world, StringComparison.OrdinalIgnoreCase))
                    .Select(m => m!.DeepClone()).ToArray();
                c.Response.Headers.CacheControl = "no-store";
                return Results.Json(new { missions });
            }
            catch (Exception e) when (e is HttpRequestException or IOException or System.Text.Json.JsonException or TaskCanceledException)
            { return Results.Json(new { error = "WOG Replay: " + e.Message }, statusCode: 502); }
        });
        app.MapGet("/api/planning/replays/{id}", async (HttpContext c, string id) =>
        {
            if (!Local(c)) return Results.NotFound();
            if (!System.Text.RegularExpressions.Regex.IsMatch(id, "^[a-zA-Z0-9_-]{1,160}$")) return Results.BadRequest();
            var viewer = Guid.NewGuid().ToString("N");
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(c.RequestAborted);
            deadline.CancelAfter(TimeSpan.FromMinutes(10));
            var ct = deadline.Token;
            try
            {
                JsonNode state;
                while (true)
                {
                    try { state = await Read("api/replays/" + id, ct, viewer, true); break; }
                    catch (HttpRequestException e) when (e.StatusCode == HttpStatusCode.TooManyRequests)
                    { await Task.Delay(TimeSpan.FromSeconds(5), ct); }
                }
                while (state["state"]?.ToString() != "ready")
                {
                    if (state["state"]?.ToString() == "error") throw new IOException(state["error"]?.ToString() ?? "Ошибка подготовки");
                    await Task.Delay(TimeSpan.FromSeconds(3), ct);
                    state = await Read("api/replays/" + id, ct, viewer);
                }
                var manifest = await Read("data/" + id + "/manifest.json", ct);
                var count = manifest["chunks"]?.GetValue<int>() ?? 0;
                if (count is < 1 or > 200) throw new IOException("Неподдерживаемое число частей записи");
                using var limit = new SemaphoreSlim(3);
                var chunks = await Task.WhenAll(Enumerable.Range(0, count).Select(async i =>
                {
                    await limit.WaitAsync(ct);
                    try { return await Read("data/" + id + "/" + i + ".json", ct); }
                    finally { limit.Release(); }
                }));
                return Results.Json(new { manifest, chunks });
            }
            catch (Exception e) when (e is HttpRequestException or IOException or System.Text.Json.JsonException or TaskCanceledException)
            { return Results.Json(new { error = e.Message }, statusCode: 502); }
            finally
            {
                using var leaveTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                try { await Read("api/replays/" + id + "/leave", leaveTimeout.Token, viewer, true); }
                catch (Exception) { /* The viewer lease expires if disconnected. */ }
            }
        });
    }
}
