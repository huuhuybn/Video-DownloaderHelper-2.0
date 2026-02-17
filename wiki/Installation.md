# 🔧 Installation

---

## From Browser Store

### Chrome
1. Visit the extension's Chrome Web Store page
2. Click **"Add to Chrome"** → **"Add extension"**
3. Pin the icon via the puzzle 🧩 menu

### Firefox
1. Visit the extension's Firefox Add-ons page
2. Click **"Add to Firefox"** → **"Add"**

### Edge
1. Visit the extension's Edge Add-ons page
2. Click **"Get"** → **"Add extension"**

---

## Manual Install (Developer Mode)

### Chrome / Edge / Brave

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
```

1. Go to `chrome://extensions/` (or `edge://extensions/`)
2. Enable **Developer mode**
3. Click **"Load unpacked"**
4. Select the extension folder

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **"Load Temporary Add-on..."**
3. Select the `manifest.json` file

> ⚠️ Temporary add-ons are removed when Firefox restarts.

---

## ✅ Verify

1. Go to any page with a video
2. Play the video
3. Icon should turn colored (🟡🔴🔵)
4. Click it → see detected media → download

---

## 🔄 Updating

Extensions auto-update via the browser store. For manual update:

`chrome://extensions/` → Developer mode → **Update**

---

## 🗑️ Uninstalling

Right-click the icon → **"Remove from Chrome"** (or go to `chrome://extensions/` → Remove)
