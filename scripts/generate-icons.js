// Script to generate recording icons for the Chrome extension
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Source SVG file
const sourceIcon = path.join(iconsDir, 'audioicon.svg');

if (!fs.existsSync(sourceIcon)) {
  console.error('❌ Error: public/icons/audioicon.svg not found!');
  process.exit(1);
}

// Generate icons for different sizes
const sizes = [16, 48, 128];

async function generateIcons() {
  try {
    // Read SVG content and force white color
    let svgContent = fs.readFileSync(sourceIcon, 'utf8');
    // Replace black fill with white
    svgContent = svgContent.replace(/fill="#000000"/g, 'fill="#ffffff"');

    const svgBuffer = Buffer.from(svgContent);

    for (const size of sizes) {
      const filename = path.join(iconsDir, `icon${size}.png`);

      // Render at higher density first to ensure crisp edges when trimming/resizing
      // Then trim transparent whitespace to maximize content size
      // Finally resize to fit in the target square container
      await sharp(svgBuffer, { density: 300 })
        .trim() // Remove surrounding whitespace
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toFile(filename);

      console.log(`Created ${filename} (${size}x${size})`);
    }
    console.log('\n✅ Recording icons generated (white & maximized)!');
  } catch (error) {
    console.error('Error generating icons:', error);
    process.exit(1);
  }
}

generateIcons();
