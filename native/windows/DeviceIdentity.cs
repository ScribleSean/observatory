using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Diagnostics;
using System.Text.Json;

namespace WorkspaceObservatory;

// In-memory material for explicit setup. Never serialize it to logs or write
// it to an unprotected temporary file. This does not install a Windows identity.
internal sealed class DeviceIdentity
{
    internal string Key { get; }
    internal string Certificate { get; }
    private DeviceIdentity(string key, string certificate) { Key = key; Certificate = certificate; }
    public override string ToString() => "Private device identity";

    internal static DeviceIdentity Generate()
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        var request = new CertificateRequest("CN=Observatory device", key, HashAlgorithmName.SHA256);
        var now = DateTimeOffset.UtcNow;
        using var certificate = request.CreateSelfSigned(now.AddMinutes(-1), now.AddDays(365));
        return new DeviceIdentity(key.ExportPkcs8PrivateKeyPem(), certificate.ExportCertificatePem());
    }

    internal static void SelfTest()
    {
        var first = Generate();
        var second = Generate();
        using var cert = X509Certificate2.CreateFromPem(first.Certificate, first.Key);
        using var key = cert.GetECDsaPrivateKey() ?? throw new InvalidOperationException("Device key missing.");
        using var publicKey = cert.GetECDsaPublicKey() ?? throw new InvalidOperationException("Device public key missing.");
        byte[] challenge = RandomNumberGenerator.GetBytes(32);
        byte[] signature = key.SignData(challenge, HashAlgorithmName.SHA256);
        if (first.Key == second.Key || key.KeySize != 256 ||
            cert.Subject != "CN=Observatory device" || cert.Issuer != cert.Subject ||
            cert.NotBefore.ToUniversalTime() > DateTime.UtcNow || cert.NotAfter.ToUniversalTime() < DateTime.UtcNow.AddDays(364) ||
            !publicKey.VerifyData(challenge, signature, HashAlgorithmName.SHA256) ||
            first.ToString().Contains("PRIVATE KEY"))
            throw new InvalidOperationException("Device identity generation failed.");
        Console.WriteLine("Device identity generation passed.");
    }

    internal static async Task BridgeSelfTest(string node)
    {
        if (!Path.IsPathFullyQualified(node) || !File.Exists(node) ||
            !string.Equals(Path.GetFileName(node), "node.exe", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Node runtime unavailable.");
        var script = Path.Combine(AppContext.BaseDirectory, "Collector", "scripts", "check-device-identity-bridge.mjs");
        if (!File.Exists(script)) throw new InvalidOperationException("Identity bridge unavailable.");
        var host = Generate();
        var guest = Generate();
        using var process = new Process { StartInfo = new(node) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = AppContext.BaseDirectory } };
        process.StartInfo.ArgumentList.Add(script);
        process.StartInfo.Environment.Remove("NODE_OPTIONS");
        process.StartInfo.Environment.Remove("NODE_EXTRA_CA_CERTS");
        process.Start();
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        try
        {
            var payload = JsonSerializer.Serialize(new { version = 1,
                host = new { version = 1, key = host.Key, cert = host.Certificate },
                guest = new { version = 1, key = guest.Key, cert = guest.Certificate } });
            await process.StandardInput.WriteAsync(payload.AsMemory(), timeout.Token);
            process.StandardInput.Close();
            await process.WaitForExitAsync(timeout.Token);
            await Task.WhenAll(output, error);
            if (process.ExitCode != 0 || (await output).Trim() != "device-identity-bridge: passed")
                throw new InvalidOperationException("Identity bridge failed.");
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync();
            throw new InvalidOperationException("Identity bridge failed.");
        }
        Console.WriteLine("Windows-generated identities passed Node TLS pairing.");
    }
}
