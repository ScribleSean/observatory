using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

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
}
