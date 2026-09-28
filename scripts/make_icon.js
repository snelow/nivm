// Generates transparent icon assets (icon.png, blob_icon.png, blob_icon.svg, and static/icons/*)
// using Puppeteer and Pillow with the Pure White Voice Mode Orb design.
//
// Usage:
// node make_icon.js

const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

(async () => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>nivm</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            html, body {
                width: 512px;
                height: 512px;
                background: transparent;
                display: flex;
                align-items: center;
                justify-content: center;
                overflow: hidden;
            }
            .orb-container {
                position: relative;
                width: 360px;
                height: 360px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            /* Luminous White Halo */
            .orb-glow {
                position: absolute;
                width: 440px;
                height: 440px;
                border-radius: 50%;
                background: radial-gradient(circle, rgba(255, 255, 255, 0.75) 0%, rgba(248, 250, 252, 0.42) 32%, rgba(226, 232, 240, 0.15) 55%, transparent 75%);
                filter: blur(44px);
                opacity: 0.9;
            }
            /* Floating Translucent Celestial Ring */
            .orb-rings {
                position: absolute;
                width: 340px;
                height: 340px;
                border-radius: 46% 54% 50% 50% / 55% 45% 55% 45%;
                border: 3.5px solid rgba(255, 255, 255, 0.88);
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.28), transparent 70%);
                box-shadow: 0 0 32px rgba(255, 255, 255, 0.45);
                z-index: 1;
            }
            /* Pure White Voice Mode Sphere Core */
            .orb-core {
                position: relative;
                width: 230px;
                height: 230px;
                border-radius: 50%;
                background: radial-gradient(
                    circle at 35% 35%,
                    #ffffff 0%,
                    rgba(255, 255, 255, 0.98) 28%,
                    #f8fafc 48%,
                    #e2e8f0 68%,
                    #475569 90%,
                    #0f172a 100%
                );
                box-shadow: 
                    0 0 35px rgba(255, 255, 255, 0.98),
                    0 0 75px rgba(255, 255, 255, 0.5),
                    inset -12px -12px 30px rgba(15, 23, 42, 0.65);
                z-index: 2;
            }
        </style>
    </head>
    <body>
        <div class="orb-container">
            <div class="orb-glow"></div>
            <div class="orb-rings"></div>
            <div class="orb-core"></div>
        </div>
    </body>
    </html>
    `;

    const projectRoot = path.resolve(__dirname, "..");
    const outDir = path.join(projectRoot, "assets");
    const iconsDir = path.join(projectRoot, "static", "icons");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

    console.log("Rendering pure white voice orb icon...");
    const browser = await puppeteer.launch({ 
        headless: "new", 
        args: ["--no-sandbox", "--disable-setuid-sandbox"] 
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await new Promise(r => setTimeout(r, 600));

    const pngBuffer = await page.screenshot({ omitBackground: true });
    
    const icon1024Path = path.join(outDir, "blob_icon.png");
    fs.writeFileSync(icon1024Path, pngBuffer);
    fs.writeFileSync(path.join(outDir, "icon.png"), pngBuffer);

    // Also update SVG with embedded pixel-perfect PNG
    const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">\n  <image width="512" height="512" href="data:image/png;base64,${pngBuffer.toString("base64")}" />\n</svg>\n`;
    fs.writeFileSync(path.join(outDir, "blob_icon.svg"), svgContent, "utf8");

    await browser.close();
    console.log("Assets saved to assets/.");

    // Resize into app icons using Python Pillow
    console.log("Resizing icons for static/icons/...");
    execSync(`python3 - << 'EOF'
import os
from PIL import Image

project_root = r"${projectRoot}"
src_path = os.path.join(project_root, 'assets', 'blob_icon.png')
im = Image.open(src_path)

targets = {
    os.path.join(project_root, 'static/icons/icon-512.png'): (512, 512),
    os.path.join(project_root, 'static/icons/icon-maskable-512.png'): (512, 512),
    os.path.join(project_root, 'static/icons/icon-192.png'): (192, 192),
    os.path.join(project_root, 'static/icons/icon-maskable-192.png'): (192, 192),
    os.path.join(project_root, 'static/icons/apple-touch-icon.png'): (180, 180),
    os.path.join(project_root, 'static/icons/favicon.png'): (64, 64),
    os.path.join(project_root, 'static/icons/favicon-32.png'): (32, 32),
    os.path.join(project_root, 'static/icons/favicon-16.png'): (16, 16),
}

for dest, (w, h) in targets.items():
    resized = im.resize((w, h), Image.Resampling.LANCZOS)
    resized.save(dest, format='PNG', optimize=True)
    print(f"Generated {dest} ({w}x{h})")

# Generate .ico with multiple embedded sizes
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
im.save(os.path.join(project_root, 'static/icons/favicon.ico'), format='ICO', sizes=ico_sizes)
im.save(os.path.join(project_root, 'static/favicon.ico'), format='ICO', sizes=ico_sizes)
print("Generated static/icons/favicon.ico and static/favicon.ico")
EOF
    `, { stdio: "inherit" });

    console.log("Done.");
})();
