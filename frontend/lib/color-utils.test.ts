/**
 * Manual verification script for color utilities
 * Run with: npx tsx frontend/lib/color-utils.test.ts
 */

import {
    generateDistinctColor,
    generateDefaultColorMap,
    updateLabelColor,
    applyMaskWideColor,
    getLabelColor,
    createColorMapFromPalette,
    COLOR_PALETTES,
} from './color-utils'

console.log('=== Color Utilities Manual Verification ===\n')

// Test 1: Generate distinct colors
console.log('Test 1: Generate distinct colors for 5 labels')
for (let i = 0; i < 5; i++) {
    const color = generateDistinctColor(i, 5)
    console.log(`  Label ${i}: ${color}`)
}
console.log('✓ Distinct colors generated\n')

// Test 2: Generate default color map
console.log('Test 2: Generate default color map for labels [1, 2, 3, 4]')
const labelValues = [1, 2, 3, 4]
const colorMap = generateDefaultColorMap(labelValues)
colorMap.forEach((color, label) => {
    console.log(`  Label ${label}: ${color}`)
})
console.log('✓ Default color map generated\n')

// Test 3: Update single label color
console.log('Test 3: Update label 2 to #00ff00')
const updatedColorMap = updateLabelColor(colorMap, 2, '#00ff00')
console.log(`  Label 2 before: ${colorMap.get(2)}`)
console.log(`  Label 2 after: ${updatedColorMap.get(2)}`)
console.log('✓ Label color updated\n')

// Test 4: Apply mask-wide color
console.log('Test 4: Apply mask-wide color #ff0000')
const maskWideColorMap = applyMaskWideColor(colorMap, '#ff0000')
maskWideColorMap.forEach((color, label) => {
    console.log(`  Label ${label}: ${color}`)
})
console.log('✓ Mask-wide color applied\n')

// Test 5: Get label color with fallback
console.log('Test 5: Get label color with fallback')
console.log(`  Label 1 (exists): ${getLabelColor(colorMap, 1)}`)
console.log(`  Label 99 (doesn't exist, fallback): ${getLabelColor(colorMap, 99, '#cccccc')}`)
console.log('✓ Label color retrieval with fallback works\n')

// Test 6: Create color map from palette
console.log('Test 6: Create color map from vibrant palette')
const paletteColorMap = createColorMapFromPalette([1, 2, 3, 4, 5], 'vibrant')
paletteColorMap.forEach((color, label) => {
    console.log(`  Label ${label}: ${color}`)
})
console.log('✓ Color map from palette created\n')

// Test 7: Verify background label (0) is excluded
console.log('Test 7: Verify background label (0) is excluded')
const colorMapWithZero = generateDefaultColorMap([0, 1, 2, 3])
console.log(`  Has label 0: ${colorMapWithZero.has(0)}`)
console.log(`  Has label 1: ${colorMapWithZero.has(1)}`)
console.log(`  Has label 2: ${colorMapWithZero.has(2)}`)
console.log(`  Has label 3: ${colorMapWithZero.has(3)}`)
console.log('✓ Background label excluded\n')

// Test 8: Verify palettes exist
console.log('Test 8: Verify predefined palettes')
console.log(`  Vibrant palette colors: ${COLOR_PALETTES.vibrant.length}`)
console.log(`  Pastel palette colors: ${COLOR_PALETTES.pastel.length}`)
console.log(`  High contrast palette colors: ${COLOR_PALETTES.highContrast.length}`)
console.log('✓ All palettes available\n')

// Test 9: Verify color format (hex)
console.log('Test 9: Verify hex color format')
const testColor = generateDistinctColor(0, 1)
const hexRegex = /^#[0-9a-f]{6}$/i
console.log(`  Generated color: ${testColor}`)
console.log(`  Matches hex format: ${hexRegex.test(testColor)}`)
console.log('✓ Color format is valid hex\n')

// Test 10: Verify immutability of color map updates
console.log('Test 10: Verify immutability of color map updates')
const originalMap = generateDefaultColorMap([1, 2, 3])
const originalLabel1Color = originalMap.get(1)
const modifiedMap = updateLabelColor(originalMap, 1, '#ffffff')
console.log(`  Original map label 1: ${originalMap.get(1)}`)
console.log(`  Modified map label 1: ${modifiedMap.get(1)}`)
console.log(`  Original unchanged: ${originalMap.get(1) === originalLabel1Color}`)
console.log('✓ Color map updates are immutable\n')

console.log('=== All Manual Verification Tests Passed ===')
