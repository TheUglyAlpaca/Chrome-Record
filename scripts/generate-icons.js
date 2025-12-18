// Script to generate recording icons for the Chrome extension
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, '../public/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Function to create a recording icon (red circle)
function createRecordingIcon(size) {
  const png = new PNG({ width: size, height: size });
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size * 0.4; // Circle takes up 80% of the icon
  const radiusSquared = radius * radius;
  
  // Background color (dark gray/black)
  const bgColor = { r: 30, g: 30, b: 30 };
  // Recording circle color (bright red)
  const recordColor = { r: 255, g: 59, b: 48 }; // iOS-style red
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      
      // Calculate distance from center
      const dx = x - centerX;
      const dy = y - centerY;
      const distanceSquared = dx * dx + dy * dy;
      
      // Draw circle with slight anti-aliasing
      if (distanceSquared <= radiusSquared) {
        // Inside circle - draw red
        const distance = Math.sqrt(distanceSquared);
        if (distance <= radius - 1) {
          // Solid red
          png.data[idx] = recordColor.r;
          png.data[idx + 1] = recordColor.g;
          png.data[idx + 2] = recordColor.b;
          png.data[idx + 3] = 255;
        } else {
          // Anti-aliasing edge
          const alpha = Math.max(0, Math.min(255, (radius - distance) * 255));
          png.data[idx] = recordColor.r;
          png.data[idx + 1] = recordColor.g;
          png.data[idx + 2] = recordColor.b;
          png.data[idx + 3] = alpha;
        }
      } else {
        // Outside circle - draw background
        png.data[idx] = bgColor.r;
        png.data[idx + 1] = bgColor.g;
        png.data[idx + 2] = bgColor.b;
        png.data[idx + 3] = 255;
      }
    }
  }
  
  return png;
}

// Generate icons for different sizes
const sizes = [16, 48, 128];

sizes.forEach((size) => {
  const png = createRecordingIcon(size);
  const filename = path.join(iconsDir, `icon${size}.png`);
  
  png.pack().pipe(fs.createWriteStream(filename));
  console.log(`Created ${filename} (${size}x${size})`);
});

console.log('\n✅ Recording icons generated successfully!');
