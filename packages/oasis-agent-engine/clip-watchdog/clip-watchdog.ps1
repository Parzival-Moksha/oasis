# Oasis clip watchdog (Windows): gives back a mouse that a browser left confined.
#
# Chromium confines the cursor (user32 ClipCursor) to the page while the page holds pointer lock, and hides the
# cursor. The owner found the confinement left behind (2026-11-17: the cursor stuck in a rectangle shaped like the
# Brave window, even in other apps, until a window was minimized and restored). This loop releases such a leftover:
# a clip that came from a browser window (it matches a browser window's content area, or appeared while a browser
# was in front) is released when the cursor is visible (no page is mouse-looking: pointer lock hides it) or another
# app is in front, for 0.75 s in a row. Clips other apps set are left alone. Every confine and release is logged
# (stdout and %TEMP%\oasis-clip-watchdog.log), to learn which step leaves it behind.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File clip-watchdog.ps1 [-PeriodMs 250] [-AnyClip]
# -AnyClip (tests): treat every clip as a browser's. One watchdog at a time (a named mutex): a second one exits.

param([int]$PeriodMs = 250, [switch]$AnyClip)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

public static class OasisClipWatchdog {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool GetClipCursor(out RECT r);
  [DllImport("user32.dll")] static extern bool ClipCursor(IntPtr r);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetCursorInfo(ref CURSORINFO ci);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);

  static readonly string[] Browsers = { "brave", "chrome", "msedge", "chromium", "vivaldi", "opera", "firefox" };
  static readonly Dictionary<uint, string> Names = new Dictionary<uint, string>();
  static string log;

  static string ProcessName(uint pid) {
    string name;
    if (Names.TryGetValue(pid, out name)) return name;
    try { name = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant(); } catch { name = "?"; }
    if (Names.Count > 500) Names.Clear();
    Names[pid] = name;
    return name;
  }
  static string Foreground() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return ProcessName(pid); }
  static bool IsBrowser(string name) { return Array.IndexOf(Browsers, name) >= 0; }
  static bool Near(int a, int b) { return Math.Abs(a - b) <= 3; }

  /** The clip is a browser window's content area (where Chromium puts it for pointer lock). */
  static bool MatchesBrowserWindow(RECT clip) {
    bool found = false;
    EnumWindows((h, l) => {
      if (found || !IsWindowVisible(h)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!IsBrowser(ProcessName(pid))) return true;
      RECT c; if (!GetClientRect(h, out c)) return true;
      POINT p = new POINT(); if (!ClientToScreen(h, ref p)) return true;
      if (Near(clip.Left, p.X) && Near(clip.Top, p.Y) && Near(clip.Right, p.X + c.Right) && Near(clip.Bottom, p.Y + c.Bottom)) found = true;
      return true;
    }, IntPtr.Zero);
    return found;
  }

  static void Write(string s) {
    string line = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + s;
    Console.WriteLine(line);
    try { File.AppendAllText(log, line + Environment.NewLine); } catch { }
  }

  static string Show(RECT r) { return r.Left + "," + r.Top + "-" + r.Right + "," + r.Bottom; }

  public static void Run(string logPath, int periodMs, bool anyClip) {
    log = logPath;
    bool created;
    Mutex mutex = new Mutex(true, "Local\\OasisClipWatchdog", out created);
    if (!created) { Console.WriteLine("another clip watchdog is running"); return; }
    Write("watchdog on (" + periodMs + " ms" + (anyClip ? ", any clip" : "") + ")");
    bool clipped = false, fromBrowser = false;
    int stale = 0;
    while (true) {
      RECT r;
      GetClipCursor(out r);
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
      bool now = !(r.Left <= vx && r.Top <= vy && r.Right >= vx + vw && r.Bottom >= vy + vh);
      string fg = Foreground();
      CURSORINFO ci = new CURSORINFO(); ci.cbSize = Marshal.SizeOf(typeof(CURSORINFO)); GetCursorInfo(ref ci);
      bool visible = (ci.flags & 1) != 0 && ci.hCursor != IntPtr.Zero;
      if (now && !clipped) {
        fromBrowser = anyClip || IsBrowser(fg) || MatchesBrowserWindow(r);
        stale = 0;
        Write("clip set " + Show(r) + " of " + vw + "x" + vh + " fg=" + fg + " cursor=" + (visible ? "visible" : "hidden") + (fromBrowser ? " (browser)" : " (another app's: left alone)"));
      } else if (!now && clipped) {
        Write("clip released by its owner, fg=" + fg);
      }
      clipped = now;
      if (now && fromBrowser) {
        // Mouse-look hides the cursor and keeps the browser in front: anything else is a leftover.
        bool leftover = visible || !IsBrowser(fg);
        stale = leftover ? stale + 1 : 0;
        if (stale * periodMs >= 750) {
          ClipCursor(IntPtr.Zero);
          Write("RELEASED a leftover clip " + Show(r) + " (fg=" + fg + ", cursor " + (visible ? "visible" : "hidden") + ")");
          clipped = false;
          stale = 0;
        }
      }
      Thread.Sleep(periodMs);
    }
  }
}
'@

[OasisClipWatchdog]::Run((Join-Path $env:TEMP 'oasis-clip-watchdog.log'), $PeriodMs, [bool]$AnyClip)
