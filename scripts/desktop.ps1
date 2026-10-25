param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference = 'Stop'
$data = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload)) | ConvertFrom-Json
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PocketInput {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
  [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public KEY ki; [FieldOffset(0)] public MOUSE mi; }
  [StructLayout(LayoutKind.Sequential)] public struct KEY { public ushort vk; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSE { public int x; public int y; public uint data; public uint flags; public uint time; public UIntPtr extra; }
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static void TypeText(string text) {
    foreach(char ch in text) {
      INPUT down = new INPUT(); down.type = 1; down.u.ki.scan = ch; down.u.ki.flags = 4;
      INPUT up = down; up.u.ki.flags = 6;
      if(SendInput(2, new INPUT[] {down, up}, Marshal.SizeOf(typeof(INPUT))) != 2) throw new Exception("Keyboard input blocked by Windows");
    }
  }
}
'@
[PocketInput]::SetProcessDPIAware() | Out-Null
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
switch ($data.action) {
  'screenshot' {
    $bitmap = New-Object Drawing.Bitmap $bounds.Width,$bounds.Height
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $stream = New-Object IO.MemoryStream
    try {
      $graphics.CopyFromScreen($bounds.Location, [Drawing.Point]::Empty, $bounds.Size)
      $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
      @{image=[Convert]::ToBase64String($stream.ToArray());width=$bounds.Width;height=$bounds.Height} | ConvertTo-Json -Compress
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $stream.Dispose() }
    exit
  }
  'click' {
    if ($data.x -lt 0 -or $data.y -lt 0 -or $data.x -ge $bounds.Width -or $data.y -ge $bounds.Height) { throw 'Coordinates outside primary screen' }
    [PocketInput]::SetCursorPos($bounds.X + [int]$data.x,$bounds.Y + [int]$data.y) | Out-Null
    if ($data.button -eq 'right') { $down=8; $up=16 } else { $down=2; $up=4 }
    [PocketInput]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
    [PocketInput]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
  }
  'type_text' { [PocketInput]::TypeText([string]$data.text) }
  'scroll' { [PocketInput]::mouse_event(2048,0,0,([int]$data.steps * 120),[UIntPtr]::Zero) }
  'press_key' {
    $keys=@{ENTER=13;TAB=9;ESC=27;BACKSPACE=8;DELETE=46;UP=38;DOWN=40;LEFT=37;RIGHT=39;WIN=91;'CTRL+A'=65;'CTRL+C'=67;'CTRL+V'=86;'CTRL+S'=83;'ALT+TAB'=9}
    if (-not $keys.ContainsKey($data.key)) { throw 'Unsupported key' }
    $modifier=0
    if ($data.key.StartsWith('CTRL+')) { $modifier=17 }
    if ($data.key.StartsWith('ALT+')) { $modifier=18 }
    if ($modifier) { [PocketInput]::keybd_event($modifier,0,0,[UIntPtr]::Zero) }
    try { [PocketInput]::keybd_event($keys[$data.key],0,0,[UIntPtr]::Zero); [PocketInput]::keybd_event($keys[$data.key],0,2,[UIntPtr]::Zero) }
    finally { if ($modifier) { [PocketInput]::keybd_event($modifier,0,2,[UIntPtr]::Zero) } }
  }
  default { throw 'Unknown desktop action' }
}
@{ok=$true} | ConvertTo-Json -Compress
