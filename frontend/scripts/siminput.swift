// Minimal CGEvent input driver for the iOS Simulator.
//
//   simctl-input click <x> <y>
//   simctl-input type  <text>
//   simctl-input key   <keycode>      # 36 = return, 48 = tab, 51 = delete
//
// Coordinates are global screen points (origin: top-left of the main display).
// Requires Accessibility permission for the invoking app.

import Foundation
import CoreGraphics

func click(x: Double, y: Double) {
    let pos = CGPoint(x: x, y: y)
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved,
            mouseCursorPosition: pos, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(60_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseDown,
            mouseCursorPosition: pos, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(60_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseUp,
            mouseCursorPosition: pos, mouseButton: .left)?.post(tap: .cghidEventTap)
}

// Typed one UTF-16 chunk at a time. Going character by character keeps the
// Simulator's text input from dropping keystrokes on fast sequences.
func type(_ text: String) {
    let src = CGEventSource(stateID: .hidSystemState)
    for ch in text {
        var utf16 = Array(String(ch).utf16)
        guard let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true),
              let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
        else { continue }
        down.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        up.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: &utf16)
        down.post(tap: .cghidEventTap)
        usleep(25_000)
        up.post(tap: .cghidEventTap)
        usleep(25_000)
    }
}

func key(_ code: CGKeyCode, flags: CGEventFlags = []) {
    let src = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: true)
    let up = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: false)
    down?.flags = flags
    up?.flags = flags
    down?.post(tap: .cghidEventTap)
    usleep(60_000)
    up?.post(tap: .cghidEventTap)
}

// The Simulator forwards the hardware keyboard by virtual keycode and ignores
// keyboardSetUnicodeString, so text has to go through real keycodes.
let KEYMAP: [Character: (CGKeyCode, Bool)] = [
    "a": (0, false), "b": (11, false), "c": (8, false), "d": (2, false),
    "e": (14, false), "f": (3, false), "g": (5, false), "h": (4, false),
    "i": (34, false), "j": (38, false), "k": (40, false), "l": (37, false),
    "m": (46, false), "n": (45, false), "o": (31, false), "p": (35, false),
    "q": (12, false), "r": (15, false), "s": (1, false), "t": (17, false),
    "u": (32, false), "v": (9, false), "w": (13, false), "x": (7, false),
    "y": (16, false), "z": (6, false),
    "0": (29, false), "1": (18, false), "2": (19, false), "3": (20, false),
    "4": (21, false), "5": (23, false), "6": (22, false), "7": (26, false),
    "8": (28, false), "9": (25, false),
    ".": (47, false), "-": (27, false), "_": (27, true), "@": (19, true),
    " ": (49, false), "/": (44, false), ":": (41, true), "+": (24, true),
]

func typeByKeycode(_ text: String) {
    for ch in text {
        let lower = Character(ch.lowercased())
        guard let (code, needsShift) = KEYMAP[lower] else { continue }
        let shift = needsShift || (ch.isUppercase && ch.isLetter)
        key(code, flags: shift ? .maskShift : [])
        usleep(80_000)
    }
}

let a = CommandLine.arguments
guard a.count >= 2 else {
    FileHandle.standardError.write("usage: simctl-input click <x> <y> | type <text> | key <code>\n".data(using: .utf8)!)
    exit(64)
}

switch a[1] {
case "click":
    guard a.count == 4, let x = Double(a[2]), let y = Double(a[3]) else { exit(64) }
    click(x: x, y: y)
case "type":
    guard a.count >= 3 else { exit(64) }
    typeByKeycode(a[2...].joined(separator: " "))
case "key":
    guard a.count == 3, let c = UInt16(a[2]) else { exit(64) }
    key(CGKeyCode(c))
case "cmd":
    guard a.count == 3, let ch = a[2].first, let (code, _) = KEYMAP[ch] else { exit(64) }
    key(code, flags: .maskCommand)
case "drag":
    // drag <x1> <y1> <x2> <y2>  — a real touch-drag, which is what RN ScrollViews follow
    guard a.count == 6, let x1 = Double(a[2]), let y1 = Double(a[3]),
          let x2 = Double(a[4]), let y2 = Double(a[5]) else { exit(64) }
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved,
            mouseCursorPosition: CGPoint(x: x1, y: y1), mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(120_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseDown,
            mouseCursorPosition: CGPoint(x: x1, y: y1), mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(120_000)
    let steps = 28
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let p = CGPoint(x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged,
                mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(12_000)
    }
    usleep(120_000)
    CGEvent(mouseEventSource: src, mouseType: .leftMouseUp,
            mouseCursorPosition: CGPoint(x: x2, y: y2), mouseButton: .left)?.post(tap: .cghidEventTap)
case "scroll":
    // scroll <x> <y> <ticks>   positive ticks scroll content up (toward the top)
    guard a.count == 5, let x = Double(a[2]), let y = Double(a[3]), let n = Int32(a[4]) else { exit(64) }
    let src = CGEventSource(stateID: .hidSystemState)
    CGEvent(mouseEventSource: src, mouseType: .mouseMoved,
            mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(80_000)
    for _ in 0..<abs(n) {
        CGEvent(scrollWheelEvent2Source: src, units: .line, wheelCount: 1,
                wheel1: n > 0 ? 3 : -3, wheel2: 0, wheel3: 0)?.post(tap: .cghidEventTap)
        usleep(60_000)
    }
default:
    exit(64)
}
