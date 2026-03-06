# Extension Icons

This directory should contain the following icon files:
- icon16.png (16x16 pixels)
- icon48.png (48x48 pixels)
- icon128.png (128x128 pixels)

These icons are used for the browser extension in different contexts:
- 16px: Favicon and browser toolbar
- 48px: Extension management page
- 128px: Chrome Web Store and installation

For now, placeholder icons should be created. You can:
1. Use an online icon generator
2. Create simple PNG files with image editing software
3. Use a tool like `convert` from ImageMagick to generate placeholders

Example ImageMagick command to create placeholder icons:
```bash
convert -size 16x16 xc:#4285f4 icon16.png
convert -size 48x48 xc:#4285f4 icon48.png
convert -size 128x128 xc:#4285f4 icon128.png
```
