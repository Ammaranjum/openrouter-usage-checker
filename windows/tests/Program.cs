using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using OpenRouterUsage;

static void Check(bool passed, string name)
{
    if (!passed) throw new Exception("FAIL: " + name);
    Console.WriteLine("PASS: " + name);
}

var root = Path.Combine(Path.GetTempPath(), "openrouter-windows-check-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(root);
string path = Path.Combine(root, "usage-history.json");
const string keyA = "synthetic-key-a";
const string keyB = "synthetic-key-b";
try
{
    var handler = new FakeHandler((request, cancellation) =>
    {
        Check(request.RequestUri!.AbsoluteUri == "https://openrouter.ai/api/v1/key", "Only the documented endpoint is requested");
        Check(new AuthenticationHeaderValue("Bearer", keyA).Equals(request.Headers.Authorization), "Bearer authentication is sent");
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("""{"data":{"label":"demo","limit":10,"limit_remaining":4.5,"usage":5.5,"usage_daily":0.123456,"usage_weekly":1.25,"usage_monthly":4.5}}""", Encoding.UTF8, "application/json")
        };
        response.Headers.Date = DateTimeOffset.Parse("2026-10-27T23:59:59Z");
        return Task.FromResult(response);
    });
    using var http = new HttpClient(handler);
    var observation = await new OpenRouterClient(http).FetchAsync(keyA, CancellationToken.None);
    Check(observation.Data.UsageDaily == 0.123456m && observation.Data.UsageWeekly == 1.25m, "Parse daily and weekly USD values precisely");
    Check(observation.ObservedAt.Day == 27, "Use server timestamp for UTC day assignment");
    Check(UsageFiles.PanelText(observation.Data) == "$4.50 left", "Display remaining instead of daily spending");
    var uncapped = new UsageData(null, null, null, null, 25.5m, null, null, null);
    Check(UsageFiles.PanelText(uncapped) == "Remaining unavailable", "Never substitute used spending for remaining");
    Check(UsageFiles.PanelText(uncapped with { LimitRemaining = 1.25m }) == "$1.25 left", "Capped fallback clearly says left");
    Check(UsageFiles.PanelText(uncapped with { UsageDaily = 0 }) == "Remaining unavailable", "Daily zero must not appear as remaining");
    Check(UsageFiles.PanelText(uncapped with { LimitRemaining = 0, UsageDaily = 99 }) == "$0.00 left", "Keep a genuine zero remaining balance");
    var now = DateTimeOffset.Parse("2026-10-28T10:00:00Z");
    Check(UsageFiles.UpdatedText(null, now) == "Not updated yet", "Missing update never claims fresh data");
    Check(UsageFiles.UpdatedText(now.AddMinutes(1), now) == "Updated just now", "Future clock skew never produces negative age");
    Check(UsageFiles.UpdatedText(now.AddSeconds(-59), now) == "Updated just now" &&
        UsageFiles.UpdatedText(now.AddSeconds(-60), now) == "Updated 1 min ago" &&
        UsageFiles.UpdatedText(now.AddMinutes(-11), now) == "Updated 11 min ago" &&
        UsageFiles.UpdatedText(now.AddHours(-1), now) == "Updated 1 hr ago", "Relative timestamp boundaries are correct");
    Check(!UsageFiles.UpdatedText(now.AddDays(-2), now).Contains("ago"), "Old updates show their full date");
    UsageFiles.Record(path, keyA, observation);
    UsageFiles.Record(path, keyA, observation with { Data = observation.Data with { UsageDaily = 0.5m }, ObservedAt = DateTimeOffset.Parse("2026-10-27T23:59:59.500Z") });
    var days = UsageFiles.ReadHistory(path).Keys[UsageFiles.KeyId(keyA)].Days;
    Check(days.Count == 1 && days["2026-10-27"].UsageUsd == 0.5m, "Repeated polls replace, rather than add to, the daily total");
    Check(days["2026-10-27"].FirstObservedAt == "2026-10-27T23:59:59.000Z", "Preserve first observation timestamp");
    UsageFiles.Record(path, keyA, observation);
    Check(UsageFiles.ReadHistory(path).Keys[UsageFiles.KeyId(keyA)].Days["2026-10-27"].UsageUsd == 0.5m, "Ignore older observations");
    UsageFiles.Record(path, keyA, observation with { Data = observation.Data with { UsageDaily = 0 }, ObservedAt = DateTimeOffset.Parse("2026-10-28T00:00:01Z") });
    UsageFiles.Record(path, keyA, observation with { ObservedAt = DateTimeOffset.Parse("2026-10-30T01:00:00+05:00") });
    UsageFiles.Record(path, keyB, observation with { Data = observation.Data with { UsageDaily = 9 } });
    var history = UsageFiles.ReadHistory(path);
    Check(history.Keys.Count == 2 && history.Keys[UsageFiles.KeyId(keyB)].Days["2026-10-27"].UsageUsd == 9, "Keep API-key histories separate");
    days = history.Keys[UsageFiles.KeyId(keyA)].Days;
    Check(days["2026-10-28"].UsageUsd == 0 && days["2026-10-29"].UsageUsd == 0.123456m, "UTC rollover preserves zero and decimal precision");
    Check(!days.ContainsKey("2026-10-30"), "Do not invent a record for an unobserved UTC day");
    var longHistory = new UsageHistory();
    var longKeyHistory = new KeyHistory();
    longHistory.Keys[UsageFiles.KeyId(keyA)] = longKeyHistory;
    var latest = new DateOnly(2026, 10, 28);
    for (int i = 0; i < 90; i++)
        longKeyHistory.Days[latest.AddDays(-i).ToString("yyyy-MM-dd")] = days["2026-10-27"];
    var recent = UsageFiles.RecentDays(longHistory, keyA).ToArray();
    Check(recent.Length == 7 && recent[0].Key == "2026-10-28" && recent[^1].Key == "2026-10-22",
        "Three months of history show only seven newest days in the menu");
    Check(longKeyHistory.Days.Count == 90 && !UsageFiles.RecentDays(longHistory, keyB).Any(),
        "Recent menu retains full history and excludes other keys");
    string text = File.ReadAllText(path);
    Check(!text.Contains(keyA) && !text.Contains(keyB), "Do not save plaintext API keys in history");
    using (var json = JsonDocument.Parse(text))
        Check(json.RootElement.GetProperty("keys").GetProperty(UsageFiles.KeyId(keyA)).GetProperty("days")
            .GetProperty("2026-10-27").TryGetProperty("usage_usd", out _), "Use the same JSON schema as Linux");
    UsageFiles.Record(path, keyA, observation with { Data = observation.Data with { UsageDaily = null } });
    UsageFiles.Record(path, keyA, observation with { Data = observation.Data with { UsageDaily = -1 } });
    Check(File.ReadAllText(path) == text, "Missing/negative daily values cannot overwrite valid records");
    File.WriteAllText(path, "{broken");
    try { UsageFiles.Record(path, keyA, observation); throw new Exception("Damaged file should be rejected"); }
    catch (JsonException) { Check(File.ReadAllText(path) == "{broken", "Preserve damaged history"); }
    foreach (string invalid in new[] { "{}", "null", "[]", """{"version":2,"timezone":"UTC","keys":{}}""" })
    {
        File.WriteAllText(path, invalid);
        try { UsageFiles.Record(path, keyA, observation); throw new Exception("Unknown schema should be rejected"); }
        catch (InvalidDataException) { Check(File.ReadAllText(path) == invalid, "Preserve unrecognized history schemas"); }
    }
    handler.Reply = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Unauthorized));
    try { await new OpenRouterClient(http).FetchAsync(keyA, CancellationToken.None); throw new Exception("401 must fail"); }
    catch (HttpRequestException e) { Check(e.Message.Contains("401") && !e.Message.Contains(keyA), "Report rejected keys without exposing them"); }
    handler.Reply = (_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") });
    try { await new OpenRouterClient(http).FetchAsync(keyA, CancellationToken.None); throw new Exception("Missing data must fail"); }
    catch (InvalidDataException) { Check(true, "Reject responses with no data"); }
    handler.Reply = async (_, token) => { await Task.Delay(10000, token); return new(HttpStatusCode.OK); };
    using var cancellation = new CancellationTokenSource();
    cancellation.Cancel();
    try { await new OpenRouterClient(http).FetchAsync(keyA, cancellation.Token); throw new Exception("Cancelled request must stop"); }
    catch (OperationCanceledException) { Check(true, "Cancelled requests stop promptly"); }
    Check(Directory.GetFiles(root, "*.tmp").Length == 0, "Atomic writes leave no temporary files");
    Console.WriteLine("ALL CORE CHECKS PASSED");
}
finally { Directory.Delete(root, true); }

sealed class FakeHandler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> reply) : HttpMessageHandler
{
    public Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> Reply = reply;
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => Reply(request, cancellationToken);
}
