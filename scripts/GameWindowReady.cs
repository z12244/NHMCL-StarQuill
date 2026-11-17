using System;
using System.Diagnostics;
using System.Threading;

internal static class GameWindowReady {
    private static int Main(string[] args) {
        int pid, launcherPid;
        if (args.Length != 2 || !int.TryParse(args[0], out pid) ||
            !int.TryParse(args[1], out launcherPid)) return 2;
        try {
            using (Process game = Process.GetProcessById(pid))
            using (Process launcher = Process.GetProcessById(launcherPid)) {
                while (!game.HasExited && !launcher.HasExited) {
                    game.Refresh();
                    if (game.MainWindowHandle != IntPtr.Zero) return 0;
                    Thread.Sleep(350);
                }
            }
            return 1;
        } catch (ArgumentException) { return 1; }
          catch (InvalidOperationException) { return 1; }
          catch (System.ComponentModel.Win32Exception) { return 2; }
    }
}
