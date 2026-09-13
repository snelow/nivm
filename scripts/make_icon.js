// Generates transparent icon assets (icon.png, blob_icon.png, blob_icon.svg, and static/icons/*)
// using Puppeteer and Pillow.
//
// Palette:
// #22c55e (green), #f59e0b (amber), #f97316 (orange), #f43f5e (rose), #a855f7 (purple), #38bdf8 (cyan)
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
                width: 340px;
                height: 340px;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            /* Outer chromatic glow */
            .orb-glow {
                position: absolute;
                inset: -42px;
                border-radius: 50%;
                background: conic-gradient(
                    from 0deg,
                    #22c55e,
                    #f59e0b,
                    #f97316,
                    #f43f5e,
                    #a855f7,
                    #22c55e
                );
                filter: blur(55px);
                opacity: 0.92;
            }
            /* Outer fluid blob ring */
            .orb-ring {
                position: absolute;
                inset: -14px;
                border-radius: 46% 54% 50% 50% / 55% 45% 55% 45%;
                border: 3px solid rgba(255, 255, 255, 0.8);
                background: linear-gradient(135deg, rgba(255, 255, 255, 0.45), transparent 60%);
                box-shadow: 0 0 25px rgba(255, 255, 255, 0.35);
                z-index: 1;
            }
            /* Inner plasma core */
            .orb-core {
                position: relative;
                width: 320px;
                height: 320px;
                border-radius: 50%;
                overflow: hidden;
                background: #080612;
                box-shadow: 
                    inset 0 0 24px rgba(255, 255, 255, 0.3),
                    inset 0 0 50px rgba(168, 85, 247, 0.35),
                    0 0 45px rgba(255, 255, 255, 0.35);
                z-index: 2;
            }
            .plasma-layer {
                position: absolute;
                inset: 0;
                border-radius: 50%;
                overflow: hidden;
                filter: contrast(115%) saturate(125%);
            }
            .plasma-bg {
                position: absolute;
                inset: 0;
                background: radial-gradient(circle at 50% 50%, #110d24 0%, #080612 85%, #04030a 100%);
            }
            .blob {
                position: absolute;
                border-radius: 50%;
                mix-blend-mode: screen;
                pointer-events: none;
            }
            /* Top-right violet */
            .blob-violet {
                top: -20px;
                right: -20px;
                width: 230px;
                height: 220px;
                border-radius: 48% 52% 62% 38% / 45% 58% 42% 55%;
                background: radial-gradient(circle at 45% 45%, #c084fc 0%, #a855f7 40%, rgba(147, 51, 234, 0.3) 75%, transparent 100%);
                filter: blur(28px);
            }
            /* Bottom-right rose */
            .blob-rose {
                bottom: -25px;
                right: 15px;
                width: 220px;
                height: 210px;
                border-radius: 56% 44% 42% 58% / 48% 62% 38% 52%;
                background: radial-gradient(circle at 50% 48%, #fb7185 0%, #f43f5e 45%, rgba(225, 29, 72, 0.35) 75%, transparent 100%);
                filter: blur(26px);
            }
            /* Bottom-left orange */
            .blob-orange {
                bottom: -15px;
                left: -10px;
                width: 210px;
                height: 200px;
                border-radius: 62% 38% 55% 45% / 48% 54% 46% 52%;
                background: radial-gradient(circle at 48% 45%, #fbbf24 0%, #f59e0b 35%, #f97316 65%, transparent 100%);
                filter: blur(24px);
            }
            /* Top-left green */
            .blob-green {
                top: -15px;
                left: -15px;
                width: 215px;
                height: 215px;
                border-radius: 46% 54% 48% 52% / 54% 46% 54% 46%;
                background: radial-gradient(circle at 50% 45%, #34d399 0%, #22c55e 48%, rgba(16, 185, 129, 0.35) 75%, transparent 100%);
                filter: blur(25px);
            }
            /* Top-center cyan */
            .blob-cyan {
                top: 25px;
                left: 55px;
                width: 170px;
                height: 160px;
                border-radius: 54% 46% 62% 38% / 42% 60% 40% 58%;
                background: radial-gradient(circle at 50% 50%, #38bdf8 0%, #06b6d4 45%, rgba(2, 132, 199, 0.25) 75%, transparent 100%);
                filter: blur(22px);
            }
            /* Center swirl */
            .blob-swirl {
                top: 50%;
                left: 50%;
                width: 270px;
                height: 150px;
                margin-top: -75px;
                margin-left: -135px;
                border-radius: 42% 58% 52% 48% / 60% 38% 62% 40%;
                transform: rotate(-28deg);
                background: linear-gradient(135deg, 
                    rgba(34, 197, 94, 0.9) 0%, 
                    rgba(56, 189, 248, 0.95) 26%, 
                    rgba(168, 85, 247, 0.95) 55%, 
                    rgba(244, 63, 94, 0.9) 82%, 
                    rgba(245, 158, 11, 0.85) 100%
                );
                filter: blur(18px);
                mix-blend-mode: screen;
                opacity: 0.95;
            }
            /* Center core glow */
            .blob-core-nucleus {
                top: 50%;
                left: 50%;
                width: 110px;
                height: 110px;
                margin-top: -55px;
                margin-left: -55px;
                border-radius: 50%;
                background: radial-gradient(circle, 
                    rgba(255, 255, 255, 1) 0%, 
                    rgba(255, 255, 255, 0.9) 22%, 
                    rgba(240, 249, 255, 0.55) 45%, 
                    rgba(192, 132, 252, 0.3) 68%, 
                    transparent 100%
                );
                filter: blur(7px);
                mix-blend-mode: screen;
            }
            /* Glass specular highlight */
            .glass-specular {
                position: absolute;
                top: 10px;
                left: 15%;
                width: 70%;
                height: 44%;
                border-radius: 50%;
                background: radial-gradient(ellipse at 50% 22%, 
                    rgba(255, 255, 255, 0.7) 0%, 
                    rgba(255, 255, 255, 0.22) 36%, 
                    rgba(255, 255, 255, 0.04) 58%, 
                    transparent 72%
                );
                filter: blur(2px);
                pointer-events: none;
                z-index: 5;
            }
            /* Inner rim */
            .glass-rim {
                position: absolute;
                inset: 0;
                border-radius: 50%;
                border: 1.5px solid rgba(255, 255, 255, 0.45);
                box-shadow: 
                    inset 0 1px 2px rgba(255, 255, 255, 0.7),
                    inset 0 -2px 10px rgba(0, 0, 0, 0.4);
                pointer-events: none;
                z-index: 6;
            }
        </style>
    </head>
    <body>
        <div class="orb-container">
            <div class="orb-glow"></div>
            <div class="orb-ring"></div>
            <div class="orb-core">
                <div class="plasma-layer">
                    <div class="plasma-bg"></div>
                    <div class="blob blob-violet"></div>
                    <div class="blob blob-rose"></div>
                    <div class="blob blob-orange"></div>
                    <div class="blob blob-green"></div>
                    <div class="blob blob-cyan"></div>
                    <div class="blob-swirl"></div>
                    <div class="blob-core-nucleus"></div>
                </div>
                <div class="glass-specular"></div>
                <div class="glass-rim"></div>
            </div>
        </div>
    </body>
    </html>
    `;

    const projectRoot = path.resolve(__dirname, "..");
    const outDir = path.join(projectRoot, "assets");
    const iconsDir = path.join(projectRoot, "static", "icons");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

    console.log("Rendering voice orb icon...");
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
