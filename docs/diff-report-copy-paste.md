# Diff Report: Copy & Paste into Affinity Publisher

The diff report (Admin Console > Diff Reports) compares a book's content between two git refs and shows changes side by side. The right column displays clean formatted text ready to copy and paste back into Affinity Publisher.

## The Problem

Affinity Publisher only reads **RTF** from the clipboard for styled text. Web browsers only put **HTML** on the clipboard. When you copy bold/italic text from the diff report and paste directly into Affinity, the formatting is lost.

## The Solution

A **Copy** button on each change writes the formatted HTML to the clipboard, then triggers a macOS Shortcut called **ClipboardToRTF** that converts the clipboard from HTML to RTF. After the Shortcut runs, pasting into Affinity preserves bold, italic, and superscript formatting.

The text pastes as **red, 6pt Times New Roman** so it's easy to spot which text was pasted from the diff report. Restyle it in Affinity after placing it.

## Mac Setup (One Time)

### 1. Open the Shortcuts App

Open **Shortcuts** (search for it in Spotlight or find it in Applications).

### 2. Create a New Shortcut

- Click the **+** button at the top to create a new shortcut
- Name it exactly: **ClipboardToRTF**

### 3. Add a "Run Shell Script" Action

- In the search bar on the right side, type **Run Shell Script**
- Drag **Run Shell Script** into the shortcut

### 4. Configure the Action

- **Shell**: `/bin/bash`
- **Input**: Nothing (leave default)
- **Run as administrator**: unchecked
- Delete the default `echo "Hello World"` text and paste this script:

```bash
cat > /tmp/gethtml.applescript << 'EOF'
use framework "AppKit"
set pb to current application's NSPasteboard's generalPasteboard()
return (pb's stringForType:"public.html") as text
EOF
osascript /tmp/gethtml.applescript > /tmp/clip_raw.html 2>/dev/null
if [ -s /tmp/clip_raw.html ]; then
    echo '<html><body style="font-family: Times New Roman; font-size: 6pt; color: red;">' > /tmp/clip.html
    cat /tmp/clip_raw.html >> /tmp/clip.html
    echo '</body></html>' >> /tmp/clip.html
    textutil -convert rtf /tmp/clip.html -stdout | pbcopy
fi
rm -f /tmp/gethtml.applescript /tmp/clip_raw.html /tmp/clip.html
```

### 5. Close the Shortcut

It auto-saves. The setup is complete.

## How It Works

1. The script reads the **HTML** from the clipboard (including `<b>`, `<i>`, `<sup>` tags)
2. Wraps it in a `<body>` tag with Times New Roman 6pt red styling
3. Uses macOS `textutil` to convert the HTML to **RTF**
4. Puts the RTF back on the clipboard via `pbcopy`

## Workflow

1. Go to **Admin Console > Diff Reports**
2. Select the book, "from" tag, and "to" ref, then click **Generate Report**
3. Find the change you need — use the sidebar navigation and heading breadcrumbs
4. Click the **Copy** button on the right side of the change
5. The Shortcuts app briefly flashes (converting HTML to RTF)
6. Switch to Affinity Publisher and **Cmd+V** to paste
7. The text appears in red 6pt — restyle it to match the document

## Verifying the Shortcut Works

To confirm RTF is on the clipboard after the Shortcut runs, open **Terminal** and run:

```bash
osascript -e 'clipboard info'
```

You should see `«class RTF »` in the output. If you only see `«class HTML»` and `«class utf8»`, the Shortcut did not run or did not convert successfully.

## Troubleshooting

- **Nothing on clipboard after clicking Copy**: Make sure you're on HTTPS (the live site, not localhost). The Clipboard API requires a secure context.
- **Shortcut doesn't trigger**: The browser opens `shortcuts://run-shortcut?name=ClipboardToRTF`. If the Shortcut has a different name (even a trailing space), it won't match. Check the exact name in the Shortcuts app.
- **Formatting still lost in Affinity**: Run the Terminal verification command above. If RTF is present but Affinity still drops formatting, try Edit > Paste Special in Affinity.
- **Text is the wrong font/size**: Edit the `font-family`, `font-size`, and `color` values in the `<body>` style tag in the script. Current: Times New Roman, 6pt, red.
