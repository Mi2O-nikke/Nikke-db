/**
 * Auto-detect characters without aim and cover animations
 * This script scans the l2d directory and generates the charactersWithoutAimAndCover array
 * 
 * Usage: node scripts/generateMissingAnimsList.js
 */

const fs = require('fs');
const path = require('path');

const L2D_PATH = path.join(__dirname, '../public/assets/l2d');

// Characters we know exist (from l2d.js data)
const getAllCharacterIds = () => {
  const l2dPath = path.join(__dirname, '../src/utils/json/l2d.js');
  const content = fs.readFileSync(l2dPath, 'utf-8');
  
  const idMatches = content.match(/'id':\s*'([^']+)'/g);
  if (!idMatches) return new Set();
  
  const ids = new Set(idMatches.map(m => m.match(/'id':\s*'([^']+)'/)[1]));
  return ids;
};

// Check if a character has a specific pose files
const checkCharacterPose = (characterId, poseType) => {
  // Examples: c010_aim/ or c010/aim/
  const possiblePaths = [
    path.join(L2D_PATH, `${characterId}_${poseType}`),
    path.join(L2D_PATH, characterId, poseType)
  ];
  
  for (const dir of possiblePaths) {
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      // Check if there are skel files
      const files = fs.readdirSync(dir);
      if (files.some(f => f.endsWith('.skel'))) {
        return true;
      }
    }
  }
  
  return false;
};

// Check if a character has skillcut (with fallback to base character)
const checkCharacterSkillcut = (characterId) => {
  // First try the character itself
  if (checkCharacterPose(characterId, 'skillcut')) {
    return true;
  }
  
  // If variant (e.g., c511_01), try base character (c511)
  const baseCharacterId = characterId.split('_')[0];
  if (baseCharacterId !== characterId) {
    if (checkCharacterPose(baseCharacterId, 'skillcut')) {
      return true;
    }
  }
  
  return false;
};

const generateList = () => {
  console.log('Scanning Live2D assets...\n');
  
  const allCharacterIds = getAllCharacterIds();
  console.log(`Found ${allCharacterIds.size} characters in l2d.js\n`);
  
  const charactersWithoutAnimations = [];
  let checkedCount = 0;
  let missingCount = 0;
  
  for (const characterId of allCharacterIds) {
    const hasAim = checkCharacterPose(characterId, 'aim');
    const hasCover = checkCharacterPose(characterId, 'cover');
    const hasSkillcut = checkCharacterSkillcut(characterId);
    
    const missingPoses = [];
    if (!hasAim) missingPoses.push('aim');
    if (!hasCover) missingPoses.push('cover');
    if (!hasSkillcut) missingPoses.push('skillcut');
    
    // If any pose is missing, add to list
    if (missingPoses.length > 0) {
      charactersWithoutAnimations.push(characterId);
      console.log(`❌ ${characterId.padEnd(20)} - aim: ${hasAim ? '✓' : '✗'}, cover: ${hasCover ? '✓' : '✗'}, skillcut: ${hasSkillcut ? '✓' : '✗'} (missing: ${missingPoses.join(', ')})`);
      missingCount++;
    }
    
    checkedCount++;
  }
  
  console.log(`\n✅ Checked ${checkedCount} characters`);
  console.log(`❌ Found ${missingCount} characters with missing animations\n`);
  
  // Generate the JavaScript code
  const jsCode = `export const charactersWithoutAimAndCover = [\n${charactersWithoutAnimations.map(c => `  '${c}'`).join(',\n')}\n];`;
  
  console.log('Generated code:\n');
  console.log(jsCode);
  
  // Optional: write to file
  const outputPath = path.join(__dirname, '../generated-missing-anims.js');
  fs.writeFileSync(outputPath, jsCode);
  console.log(`\n📁 Saved to: ${outputPath}`);
  
  return charactersWithoutAnimations;
};

try {
  generateList();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
