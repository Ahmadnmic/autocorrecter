// axreplace: replace a word just before the caret in the focused text field through the Accessibility API.
//
//   axreplace <tailLength> <old> <new>
//
// The caret is at the end of what the user typed; `old` sits `tailLength` characters before it. The helper reads
// the field's text, verifies that `old` is really there (searching a little around the expected spot in case the
// user kept typing), replaces exactly that range and puts the caret back where it was, shifted by the length
// difference. Nothing after the word is retyped, so it feels like the web app.
//
// Exit codes: 0 replaced, 2 no focused text element / attributes not settable, 3 text not found, 4 bad arguments.
// stdout: "ok <newCaret>" or a short reason. Works in native Cocoa fields and in Chromium/Electron apps (Chrome,
// VS Code, Slack, Claude), which implement the settable selection attributes.
import ApplicationServices
import Foundation

let args = CommandLine.arguments
guard args.count == 4, let tailLen = Int(args[1]) else {
    print("usage: axreplace <tailLength> <old> <new>")
    exit(4)
}
let oldText = args[2]
let newText = args[3]

let system = AXUIElementCreateSystemWide()
var focusedRef: CFTypeRef?
guard AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute as CFString, &focusedRef) == .success, let focusedRaw = focusedRef else {
    print("no focused element")
    exit(2)
}
let focused = focusedRaw as! AXUIElement

var settable: DarwinBoolean = false
AXUIElementIsAttributeSettable(focused, kAXSelectedTextRangeAttribute as CFString, &settable)
guard settable.boolValue else {
    print("selection not settable")
    exit(2)
}

var rangeRef: CFTypeRef?
guard AXUIElementCopyAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, &rangeRef) == .success, let rangeRaw = rangeRef else {
    print("no selection")
    exit(2)
}
var caret = CFRange(location: 0, length: 0)
guard AXValueGetValue(rangeRaw as! AXValue, .cfRange, &caret) else {
    print("bad selection")
    exit(2)
}
if caret.length != 0 {
    print("text selected")
    exit(3)
}

// Text of the field, to verify before touching anything.
var valueRef: CFTypeRef?
var text = ""
if AXUIElementCopyAttributeValue(focused, kAXValueAttribute as CFString, &valueRef) == .success, let v = valueRef as? String {
    text = v
}
let utf16 = Array(text.utf16)
let oldU = Array(oldText.utf16)
var start = caret.location - tailLen - oldU.count
var found = false
if !utf16.isEmpty {
    // Expected spot first, then a small window before it (the user may have typed since the correction was decided).
    let candidates = [start] + (1...12).map { start - $0 } + (1...4).map { start + $0 }
    for s in candidates where s >= 0 && s + oldU.count <= utf16.count {
        if Array(utf16[s..<(s + oldU.count)]) == oldU {
            // Must be a whole word: no letter directly before or after.
            let before = s > 0 ? utf16[s - 1] : 32
            let after = s + oldU.count < utf16.count ? utf16[s + oldU.count] : 32
            let isLetter: (UInt16) -> Bool = { u in
                guard let sc = Unicode.Scalar(UInt32(u)) else { return false }
                return CharacterSet.letters.contains(sc)
            }
            if !isLetter(before) && !isLetter(after) {
                start = s
                found = true
                break
            }
        }
    }
    if !found {
        print("text not found")
        exit(3)
    }
} else if start < 0 {
    print("caret too early")
    exit(3)
}

var target = CFRange(location: start, length: oldU.count)
guard let targetValue = AXValueCreate(.cfRange, &target) else {
    print("range alloc")
    exit(2)
}
guard AXUIElementSetAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, targetValue) == .success else {
    print("select failed")
    exit(2)
}
guard AXUIElementSetAttributeValue(focused, kAXSelectedTextAttribute as CFString, newText as CFTypeRef) == .success else {
    // Undo the selection so nothing is left highlighted.
    var restore = CFRange(location: caret.location, length: 0)
    if let r = AXValueCreate(.cfRange, &restore) { AXUIElementSetAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, r) }
    print("replace failed")
    exit(2)
}
let newCaret = caret.location + Array(newText.utf16).count - oldU.count
var after = CFRange(location: newCaret, length: 0)
if let r = AXValueCreate(.cfRange, &after) { AXUIElementSetAttributeValue(focused, kAXSelectedTextRangeAttribute as CFString, r) }
print("ok \(newCaret)")
exit(0)
