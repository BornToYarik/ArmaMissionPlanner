using Microsoft.AspNetCore.StaticFiles;

// Local companion integration only. Roots are configured by the process owner,
// never by a browser request. Game assets are not part of this repository.
internal static class PlanningAssets
{
    private static readonly HashSet<string> Prefixes = ["terrain", "maps", "models", "environment", "roads", "markers"];
    public static void Map(WebApplication app)
    {
        var roots = (Environment.GetEnvironmentVariable("WOG_PLANNER_ASSETS") ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
            .Select(Path.GetFullPath).Where(Directory.Exists).ToArray();
        app.MapGet("/api/planning/status", (HttpContext context) =>
            IsLocal(context) ? Results.Ok(new { available = roots.Length > 0 }) : Results.NotFound());
        app.Use(async (context, next) =>
        {
            var path = context.Request.Path.Value?.TrimStart('/') ?? "";
            var parts = path.Split('/');
            if (!Prefixes.Contains(parts[0]) || roots.Length == 0) { await next(); return; }
            if (!IsLocal(context) || context.Request.Method is not ("GET" or "HEAD")) { context.Response.StatusCode = 403; return; }
            if (parts.Any(p => p is ".." or "." || p.Contains('\\') || p.Contains(':'))) { context.Response.StatusCode = 400; return; }
            foreach (var root in roots)
            {
                var file = Path.GetFullPath(Path.Combine(root, Path.Combine(parts)));
                if (!file.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)
                    || !File.Exists(file)) continue;
                // Do not follow a junction/symlink outside the approved asset root.
                var info = new FileInfo(file);
                bool linked = info.LinkTarget != null;
                for (var dir = info.Directory; dir != null && dir.FullName.Length >= root.Length; dir = dir.Parent)
                    linked |= dir.LinkTarget != null;
                if (linked) continue;
                var types = new FileExtensionContentTypeProvider();
                context.Response.ContentType = types.TryGetContentType(file, out var type) ? type : "application/octet-stream";
                context.Response.Headers.CacheControl = "private, no-cache";
                await context.Response.SendFileAsync(file, context.RequestAborted); return;
            }
            context.Response.StatusCode = 404;
        });
    }

    private static bool IsLocal(HttpContext context) => context.Connection.RemoteIpAddress is { } ip
        && System.Net.IPAddress.IsLoopback(ip)
        && context.Request.Host.Host is "localhost" or "127.0.0.1" or "[::1]"
        && (context.Request.Headers.Origin.Count == 0
            || context.Request.Headers.Origin.ToString() == $"{context.Request.Scheme}://{context.Request.Host}");
}
