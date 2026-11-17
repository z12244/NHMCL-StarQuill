using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

internal static class UserStorageKey {
    private static int Main(string[] args) {
        if (args.Length == 1 && args[0] == "--legacy") {
            try {
                using (var bytes = new MemoryStream()) {
                    using (var input = Console.OpenStandardInput()) input.CopyTo(bytes);
                    byte[] key = ProtectedData.Unprotect(bytes.ToArray(), null, DataProtectionScope.CurrentUser);
                    if (key.Length != 32) return 3;
                    using (var output = Console.OpenStandardOutput()) output.Write(key, 0, key.Length);
                    Array.Clear(key, 0, key.Length);
                }
                return 0;
            } catch { return 1; }
        }
        if (args.Length != 1) return 2;
        try {
            string dir = Path.GetFullPath(args[0]);
            string file = Path.Combine(dir, "user.key");
            byte[] entropy = Encoding.UTF8.GetBytes("NHMCL-StarQuill/WindowsUserStorage/v1");
            if (!File.Exists(file)) {
                byte[] key = new byte[32];
                using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(key);
                string pending = Path.Combine(dir, Guid.NewGuid().ToString("N") + ".tmp");
                try {
                    File.WriteAllBytes(pending, ProtectedData.Protect(key, entropy, DataProtectionScope.CurrentUser));
                    try { File.Move(pending, file); }
                    catch (IOException) { if (!File.Exists(file)) throw; }
                } finally { Array.Clear(key, 0, key.Length); File.Delete(pending); }
            }
            byte[] decoded = ProtectedData.Unprotect(File.ReadAllBytes(file), entropy, DataProtectionScope.CurrentUser);
            if (decoded.Length != 32) return 3;
            using (Stream output = Console.OpenStandardOutput()) output.Write(decoded, 0, decoded.Length);
            Array.Clear(decoded, 0, decoded.Length);
            return 0;
        } catch { return 1; }
    }
}
